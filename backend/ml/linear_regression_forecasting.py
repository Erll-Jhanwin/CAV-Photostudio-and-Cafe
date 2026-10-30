"""Daily least-squares forecasts over existing POS, inventory and booking records.

Implementation assumption: observations are calendar-day totals (missing days are
zero), and the requested horizon is calendar days, defaulting to seven. The model
uses a single time feature and an ordinary least-squares line, clipped at zero.
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal, InvalidOperation
import math

from django.db import transaction
from django.utils import timezone

from booking.models import Booking
from forecasting.models import ForecastRun
from inventory.models import Product
from payment.models import Payment
from pos.models import Order

MODEL_VERSION = 'least-squares-linear-v1'
DEFAULT_HORIZON_DAYS = 7
MIN_TRAIN_DAYS = 14


def _number(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError, InvalidOperation):
        return default


def _daily_series(values, start, end):
    count = (end - start).days + 1
    return [float(values.get(start + timedelta(days=i), 0.0)) for i in range(count)]


def least_squares_predict(values, steps):
    """Fit y=a+bx with centered OLS; return nonnegative forecasts."""
    n = len(values)
    if n < MIN_TRAIN_DAYS:
        return []
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    denominator = sum((x - x_mean) ** 2 for x in range(n))
    slope = sum((x - x_mean) * (y - y_mean) for x, y in enumerate(values)) / denominator
    intercept = y_mean - slope * x_mean
    return [max(0.0, intercept + slope * (n + step)) for step in range(steps)]


def evaluate_series(values):
    """Chronological 80/20 holdout with MAE and RMSE; never reports on empty test."""
    n = len(values)
    split = max(MIN_TRAIN_DAYS, int(n * 0.8))
    if n < MIN_TRAIN_DAYS + 1 or split >= n:
        return {'status': 'insufficient_history', 'mae': None, 'rmse': None, 'test_count': 0, 'actual': [], 'predicted': []}
    actual = values[split:]
    predicted = least_squares_predict(values[:split], len(actual))
    errors = [a - p for a, p in zip(actual, predicted)]
    return {
        'status': 'available',
        'mae': round(sum(abs(error) for error in errors) / len(errors), 4),
        'rmse': round(math.sqrt(sum(error * error for error in errors) / len(errors)), 4),
        'test_count': len(actual), 'actual': actual, 'predicted': predicted,
        'split_index': split,
    }


def _collect_sources():
    revenue, product_demand, booking_demand = defaultdict(float), defaultdict(float), defaultdict(float)
    product_names = {}
    wastage_by_product = defaultdict(float)
    today = timezone.localdate()
    for order in Order.objects.filter(payment_status='PAID').exclude(order_type='END_OF_DAY_REPORT').only(
        'created_at', 'completed_at', 'total', 'returned_amount', 'line_items', 'return_events',
    ).iterator():
        day = timezone.localtime(order.created_at).date()
        if day > today:
            continue
        net_total = max(0.0, _number(order.total) - _number(order.returned_amount))
        revenue[day] += net_total
        for line in order.line_items or []:
            if not isinstance(line, dict):
                continue
            try:
                product_id = int(line.get('product') or line.get('product_id') or 0)
            except (TypeError, ValueError):
                continue
            quantity = max(0.0, _number(line.get('quantity')) - _number(line.get('returned_quantity')))
            if not product_id or not quantity:
                continue
            product_demand[(day, product_id)] += quantity
            product_names[product_id] = (line.get('product_details') or {}).get('name') or line.get('name') or f'Product {product_id}'
        # Wastage is captured as its own series and never enters sales or demand.
        for event in order.return_events or []:
            if str(event.get('action_type') or '').upper() == 'WASTAGE' or str(event.get('disposition') or '').upper() == 'WASTED':
                try:
                    wastage_by_product[(day, int(event.get('product_id') or 0))] += max(0.0, _number(event.get('quantity')))
                except (TypeError, ValueError):
                    continue
    for payment in Payment.objects.filter(
        payment_type=Payment.BOOKING, status='APPROVED', paid_at__isnull=False,
    ).only('amount', 'paid_at').iterator():
        day = timezone.localtime(payment.paid_at).date()
        if day <= today:
            revenue[day] += max(0.0, _number(payment.amount))
    for booking in Booking.objects.exclude(status='CANCELLED').only('scheduled_date').iterator():
        if booking.scheduled_date <= today:
            booking_demand[booking.scheduled_date] += 1
    days = list(revenue) + list(booking_demand) + [day for day, _ in product_demand]
    if not days:
        return {'start': None, 'end': None, 'revenue': {}, 'products': {}, 'bookings': {}, 'names': {}, 'wastage': {}}
    start, end = min(days), max(days)
    products = defaultdict(dict)
    for (day, product_id), quantity in product_demand.items():
        products[product_id][day] = quantity
    return {
        'start': start, 'end': end, 'revenue': dict(revenue), 'products': dict(products),
        'bookings': dict(booking_demand), 'names': product_names, 'wastage': dict(wastage_by_product),
    }


def _inventory_recommendations(product_forecasts, horizon):
    products = list(Product.objects.filter(is_active=True).only(
        'id', 'name', 'item_type', 'stock_level', 'stock_quantity', 'base_unit', 'recipe_data', 'reorder_point',
    ))
    by_id = {product.id: product for product in products}
    ingredient_requirements = defaultdict(float)
    recommendations = []
    for product_id, values in product_forecasts.items():
        demand = sum(values)
        product = by_id.get(product_id)
        if product:
            for recipe_line in product.recipe_data or []:
                if not isinstance(recipe_line, dict):
                    continue
                try:
                    ingredient_id = int(recipe_line.get('ingredient') or 0)
                    amount = max(0.0, _number(recipe_line.get('quantity')))
                except (TypeError, ValueError):
                    continue
                if ingredient_id in by_id and by_id[ingredient_id].item_type == Product.INGREDIENT:
                    ingredient_requirements[ingredient_id] += amount * demand
        if product and product.item_type == Product.PRODUCT:
            recommendations.append({
                'type': 'product', 'item_id': product.id, 'item_name': product.name,
                'unit': 'units', 'forecast_demand': round(demand, 2),
                'available_stock': product.stock_level,
                'shortage': round(max(0.0, demand - product.stock_level), 2),
                'suggested_replenishment': math.ceil(max(0.0, demand - product.stock_level)),
            })
    for ingredient_id, required in ingredient_requirements.items():
        ingredient = by_id[ingredient_id]
        stock = _number(ingredient.stock_quantity)
        shortage = max(0.0, required - stock)
        recommendations.append({
            'type': 'ingredient', 'item_id': ingredient.id, 'item_name': ingredient.name,
            'unit': {'G': 'g', 'ML': 'mL'}.get(ingredient.base_unit, ingredient.base_unit or 'units'),
            'forecast_requirement': round(required, 2), 'available_stock': round(stock, 2),
            'shortage': round(shortage, 2), 'suggested_replenishment': round(shortage, 2),
        })
    return recommendations


def create_forecast_run(horizon=DEFAULT_HORIZON_DAYS):
    horizon = max(1, min(int(horizon), 90))
    source = _collect_sources()
    predictions, evaluation = {'sales': [], 'products': [], 'bookings': [], 'actual_history': []}, {}
    if source['start'] is None:
        status = 'insufficient_history'
        recommendations = []
        run = ForecastRun.objects.create(
            model_version=MODEL_VERSION, horizon_days=horizon, data_status=status,
            predictions=predictions, evaluation=evaluation, recommendations=recommendations,
        )
        return run
    start, end = source['start'], source['end']
    calendar = _daily_series(source['revenue'], start, end)
    training_end = end
    eval_result = evaluate_series(calendar)
    evaluation['sales'] = {key: value for key, value in eval_result.items() if key not in {'actual', 'predicted', 'split_index'}}
    predictions['backtest'] = []
    if eval_result['status'] == 'available':
        split = eval_result['split_index']
        predictions['backtest'] = [
            {'date': (start + timedelta(days=split + i)).isoformat(),
             'actual_revenue': round(actual, 2), 'predicted_revenue': round(predicted, 2), 'unit': 'PHP'}
            for i, (actual, predicted) in enumerate(zip(eval_result['actual'], eval_result['predicted']))
        ]
    products = Product.objects.filter(item_type=Product.PRODUCT, is_active=True).only('id', 'name', 'stock_level', 'recipe_data')
    product_meta = {p.id: p for p in products}
    product_predictions = {}
    if len(calendar) >= MIN_TRAIN_DAYS:
        future_days = [end + timedelta(days=offset) for offset in range(1, horizon + 1)]
        sales_values = least_squares_predict(calendar, horizon)
        predictions['sales'] = [{'date': day.isoformat(), 'predicted_revenue': round(value, 2), 'unit': 'PHP'} for day, value in zip(future_days, sales_values)]
        booking_values = _daily_series(source['bookings'], start, end)
        booking_forecast = least_squares_predict(booking_values, horizon)
        predictions['bookings'] = [{'date': day.isoformat(), 'predicted_bookings': round(value, 2), 'unit': 'bookings'} for day, value in zip(future_days, booking_forecast)]
        evaluation['bookings'] = {key: value for key, value in evaluate_series(booking_values).items() if key not in {'actual', 'predicted', 'split_index'}}
        for product_id, product in product_meta.items():
            values = _daily_series(source['products'].get(product_id, {}), start, end)
            if not any(values):
                continue
            product_eval = evaluate_series(values)
            evaluation[f'product_{product_id}'] = {key: value for key, value in product_eval.items() if key not in {'actual', 'predicted', 'split_index'}}
            forecast = least_squares_predict(values, horizon)
            product_predictions[product_id] = forecast
            predictions['products'].extend(
                {'date': day.isoformat(), 'product_id': product_id, 'product_name': product.name,
                 'predicted_quantity': round(value, 2), 'unit': 'units'}
                for day, value in zip(future_days, forecast)
            )
        # Actual values are restricted to recorded calendar dates and remain null where no record exists.
        for index, day in enumerate((start + timedelta(days=i) for i in range(len(calendar)))):
            predictions['actual_history'].append({
                'date': day.isoformat(), 'actual_revenue': round(calendar[index], 2),
                'actual_bookings': round(source['bookings'].get(day, 0), 2),
                'actual_wastage_units': round(sum(value for (waste_day, _), value in source['wastage'].items() if waste_day == day), 2),
            })
        test_start = start + timedelta(days=eval_result.get('split_index', len(calendar))) if eval_result['status'] == 'available' else None
        test_end = end if test_start else None
        status = 'ready'
        recommendations = _inventory_recommendations(product_predictions, horizon)
    else:
        predictions['actual_history'] = [
            {'date': (start + timedelta(days=i)).isoformat(), 'actual_revenue': round(value, 2),
             'actual_bookings': round(source['bookings'].get(start + timedelta(days=i), 0), 2),
             'actual_wastage_units': round(sum(amount for (waste_day, _), amount in source['wastage'].items() if waste_day == start + timedelta(days=i)), 2)}
            for i, value in enumerate(calendar)
        ]
        status, recommendations, test_start, test_end = 'insufficient_history', [], None, None
    with transaction.atomic():
        run = ForecastRun.objects.create(
            model_version=MODEL_VERSION, horizon_days=horizon, training_start=start,
            training_end=training_end, test_start=test_start, test_end=test_end,
            data_status=status, predictions=predictions, evaluation=evaluation,
            recommendations=recommendations,
        )
    return run


def serialize_run(run):
    actuals = {row['date']: row for row in run.predictions.get('actual_history', [])}
    predictions = run.predictions
    return {
        'id': run.id, 'model_version': run.model_version, 'generated_at': run.generated_at.isoformat(),
        'horizon_days': run.horizon_days, 'training_period': {'start': run.training_start.isoformat() if run.training_start else None, 'end': run.training_end.isoformat() if run.training_end else None},
        'testing_period': {'start': run.test_start.isoformat() if run.test_start else None, 'end': run.test_end.isoformat() if run.test_end else None},
        'status': run.data_status, 'message': 'Insufficient historical data' if run.data_status == 'insufficient_history' else '',
        'sales_forecast': predictions.get('sales', []), 'product_forecast': predictions.get('products', []),
        'booking_forecast': predictions.get('bookings', []), 'actual_history': list(actuals.values()),
        'backtest': predictions.get('backtest', []),
        'evaluation': run.evaluation, 'recommendations': run.recommendations,
    }
