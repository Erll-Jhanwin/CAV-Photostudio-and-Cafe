"""Supabase-backed sales forecasting for the management dashboard.

Forecast requests read the active validated snapshot from the forecasting
tables through Django ORM. CSV files are handled only by the explicit import
command, so deployed forecasting never depends on a local filesystem file.
"""

import math
import re
from datetime import timedelta

import numpy as np
import pandas as pd
from django.utils import timezone

from inventory.models import Product
from ml.sales_history_repository import (
    DEFAULT_SOURCE_NAME,
    EXCLUDED_STATUS_PATTERN,
    get_active_sales_history,
)


FORECAST_HORIZON_DAYS = 90
MIN_RELIABLE_HISTORY_DAYS = 56
MIN_RELIABLE_OBSERVED_DAYS = 28
ITEM_PATTERN = re.compile(r'(?P<quantity>\d+(?:\.\d+)?)\s*x\s*(?P<name>[^,;]+)', re.IGNORECASE)


def _clean_product_name(value):
    return ' '.join(str(value or '').replace('\n', ' ').split()).strip(' ,;')


def _parse_items(description, row_quantity):
    description = str(description or '').strip()
    matches = [
        (float(match.group('quantity')), _clean_product_name(match.group('name')))
        for match in ITEM_PATTERN.finditer(description)
        if _clean_product_name(match.group('name'))
    ]
    if matches:
        return matches
    if description:
        return [(max(row_quantity, 1.0), _clean_product_name(description))]
    if row_quantity > 0:
        return [(row_quantity, 'Unspecified product')]
    return []


def _empty_preprocessed(status, error='', summary=None):
    return {
        'status': status,
        'error': error,
        'daily': pd.DataFrame(),
        'products': {},
        'product_unit_revenue': {},
        'summary': summary or {},
    }


def preprocess_sales_history(source_name=DEFAULT_SOURCE_NAME):
    """Read and aggregate the active Supabase sales-history snapshot."""
    batch, records = get_active_sales_history(source_name)
    if not batch:
        return _empty_preprocessed(
            'unavailable',
            'No validated sales history import is active. Import the CSV before forecasting.',
        )

    records = [
        record for record in records
        if not EXCLUDED_STATUS_PATTERN.search(str(record.get('status') or ''))
    ]
    if not records:
        return _empty_preprocessed(
            'invalid',
            'The active sales history import contains no non-cancelled sale rows.',
        )

    display_names = {}
    transaction_rows = []
    product_rows = []
    for record in records:
        sale_date = pd.Timestamp(record['sale_date']).normalize()
        row_quantity = float(record.get('quantity') or 0)
        row_sales = float(record.get('total') or record.get('total_amount') or 0)
        items = _parse_items(record.get('items_description'), row_quantity)
        if not items:
            continue
        total_item_quantity = sum(quantity for quantity, _ in items) or 1.0
        transaction_rows.append({
            'date': sale_date,
            'sales': max(row_sales, 0.0),
            'quantity': total_item_quantity,
            'transaction_id': str(record.get('transaction_number') or record['sale_date']),
        })
        for quantity, raw_name in items:
            key = raw_name.casefold()
            display_names.setdefault(key, raw_name)
            product_rows.append({
                'date': sale_date,
                'product': key,
                'product_name': display_names[key],
                'quantity': quantity,
                # The export stores transaction totals, not line prices. This
                # allocation is labelled in the API and dashboard.
                'sales': max(row_sales, 0.0) * quantity / total_item_quantity,
            })

    if not transaction_rows:
        return _empty_preprocessed('invalid', 'No sale items could be parsed from the active import.')

    transactions = pd.DataFrame(transaction_rows)
    products = pd.DataFrame(product_rows)
    start_date = transactions['date'].min()
    end_date = transactions['date'].max()
    calendar = pd.date_range(start=start_date, end=end_date, freq='D')

    daily_grouped = transactions.groupby('date').agg(
        actual_sales=('sales', 'sum'),
        actual_quantity=('quantity', 'sum'),
        transaction_count=('transaction_id', 'nunique'),
    )
    daily = daily_grouped.reindex(calendar, fill_value=0).reset_index().rename(columns={'index': 'date'})
    daily['is_observed'] = daily['transaction_count'].gt(0)
    daily['is_imputed'] = ~daily['is_observed']

    product_daily = {}
    unit_revenue = {}
    for product_key, group in products.groupby('product'):
        grouped = group.groupby('date').agg(
            actual_quantity=('quantity', 'sum'),
            actual_sales=('sales', 'sum'),
        ).reindex(calendar, fill_value=0).reset_index().rename(columns={'index': 'date'})
        grouped['is_observed'] = grouped['actual_quantity'].gt(0)
        grouped['product_name'] = display_names[product_key]
        product_daily[product_key] = grouped
        total_quantity = float(group['quantity'].sum())
        unit_revenue[product_key] = float(group['sales'].sum()) / total_quantity if total_quantity else 0.0

    observed_dates = int(daily['is_observed'].sum())
    return {
        'status': 'ok',
        'error': '',
        'daily': daily,
        'products': product_daily,
        'product_unit_revenue': unit_revenue,
        'summary': {
            'import_id': batch.id,
            'source_name': batch.source_name,
            'source_file': batch.source_filename,
            'source_hash': batch.source_hash,
            'imported_at': batch.completed_at.isoformat() if batch.completed_at else None,
            'raw_rows': batch.row_count,
            'valid_rows': batch.imported_row_count,
            'skipped_rows': batch.skipped_row_count,
            'parsed_transactions': int(len(transactions)),
            'start_date': start_date.date(),
            'end_date': end_date.date(),
            'history_days': int(len(calendar)),
            'observed_days': observed_dates,
            'missing_days': int(len(calendar) - observed_dates),
            'product_count': int(len(product_daily)),
            'total_sales': float(transactions['sales'].sum()),
            'total_quantity': float(products['quantity'].sum()),
        },
    }


def _moving_average(values, horizon, window=7):
    values = np.asarray(values, dtype=float)
    baseline = float(np.mean(values[-min(window, len(values)):])) if len(values) else 0.0
    return np.repeat(max(baseline, 0.0), horizon)


def _damped_holt(values, horizon, alpha=0.3, beta=0.1, damping=0.85):
    values = np.asarray(values, dtype=float)
    if not len(values):
        return np.zeros(horizon)
    if len(values) == 1:
        return np.repeat(max(values[0], 0.0), horizon)
    level = float(values[0])
    trend = float(values[1] - values[0])
    for actual in values[1:]:
        previous_level = level
        level = alpha * actual + (1 - alpha) * (level + trend)
        trend = beta * (level - previous_level) + (1 - beta) * trend
    predictions = []
    damped_trend = 0.0
    for step in range(1, horizon + 1):
        damped_trend += damping ** step
        predictions.append(max(level + damped_trend * trend, 0.0))
    return np.asarray(predictions)


def _predict(values, horizon, model_name):
    if model_name == 'damped_holt':
        return _damped_holt(values, horizon)
    return _moving_average(values, horizon)


def _metrics(actual, predicted):
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    if not len(actual):
        return {
            'mae': None, 'rmse': None, 'wape': None, 'smape': None,
            'mape': None, 'mape_coverage': 0, 'holdout_days': 0,
        }
    errors = np.abs(actual - predicted)
    denominator = np.abs(actual) + np.abs(predicted)
    nonzero = actual != 0
    return {
        'mae': round(float(np.mean(errors)), 2),
        'rmse': round(float(np.sqrt(np.mean((actual - predicted) ** 2))), 2),
        'wape': round(float(np.sum(errors) / np.sum(np.abs(actual))), 4) if np.sum(np.abs(actual)) else None,
        'smape': round(float(np.mean(np.divide(2 * errors, denominator, out=np.zeros_like(errors), where=denominator != 0))), 4),
        'mape': round(float(np.mean(errors[nonzero] / np.abs(actual[nonzero]))), 4) if np.any(nonzero) else None,
        'mape_coverage': int(np.sum(nonzero)),
        'holdout_days': int(len(actual)),
    }


def _series_forecast(series, value_column, horizon):
    values = series[value_column].astype(float).to_numpy()
    observed_days = int(series.get('is_observed', pd.Series(False, index=series.index)).sum())
    reliable = len(values) >= MIN_RELIABLE_HISTORY_DAYS and observed_days >= MIN_RELIABLE_OBSERVED_DAYS
    holdout_metrics = _metrics([], [])
    selected_model = '7_day_moving_average'

    if reliable and len(values) >= 14:
        holdout_days = min(7, max(1, len(values) // 5))
        train = values[:-holdout_days]
        actual = values[-holdout_days:]
        candidates = {
            '7_day_moving_average': _predict(train, holdout_days, '7_day_moving_average'),
            'damped_holt': _predict(train, holdout_days, 'damped_holt'),
        }
        scored = []
        for name, prediction in candidates.items():
            metric = _metrics(actual, prediction)
            score = metric['wape'] if metric['wape'] is not None else metric['rmse']
            scored.append((score, name, metric))
        _, selected_model, holdout_metrics = min(scored, key=lambda item: item[0])
    elif len(values) >= 2:
        holdout_days = min(7, max(1, len(values) // 4))
        holdout_metrics = _metrics(values[-holdout_days:], _predict(values[:-holdout_days], holdout_days, selected_model))

    predictions = _predict(values, horizon, selected_model)
    residual_source = values[-min(len(values), 14):]
    residual_scale = float(np.std(np.diff(residual_source))) if len(residual_source) > 1 else 0.0
    baseline = float(np.mean(values[-min(len(values), 7):])) if len(values) else 0.0
    spread = max(residual_scale, baseline * 0.35, 1.0)
    if not reliable:
        spread *= 1.5
    lower = np.maximum(predictions - spread, 0.0)
    upper = predictions + spread
    metrics = {
        **holdout_metrics,
        'accuracy_available': reliable and holdout_metrics['holdout_days'] > 0,
        'reliability': 'reliable_backtest' if reliable else 'insufficient_history',
    }
    return predictions, lower, upper, {
        'name': selected_model,
        'display_name': 'Damped Holt' if selected_model == 'damped_holt' else '7-day moving-average baseline',
        'history_days': int(len(values)),
        'observed_days': observed_days,
        'reliable': reliable,
        'metrics': metrics,
    }


def _round(value):
    return round(float(value or 0), 2)


def _date_text(value):
    return pd.Timestamp(value).strftime('%Y-%m-%d')


def _empty_report(data):
    return {
        'status': data.get('status', 'unavailable'),
        'detail': data.get('error') or 'No sales history is available for forecasting.',
        'source_file': data.get('summary', {}).get('source_file', ''),
        'sales_forecast': [],
        'actual_history': [],
        'product_forecasts': [],
        'product_forecast_summary': [],
        'product_sales_forecast': [],
        'demand_forecast': [],
        'monthly_forecast': [],
        'forecast_ranges': {},
        'metrics': {},
        'data_quality': data.get('summary', {}),
        'data_sufficiency': {
            'is_sufficient': False,
            'status': 'unavailable',
            'message': data.get('error') or 'Import the sales history CSV before running a forecast.',
            'minimum_reliable_history_days': MIN_RELIABLE_HISTORY_DAYS,
            'minimum_reliable_observed_days': MIN_RELIABLE_OBSERVED_DAYS,
            'requested_30_day_observed_coverage': {'available': False, 'observed_days': 0, 'required_observed_days': 30},
        },
        'reorder_recommendations': get_reorder_recommendations(),
    }


def _range_summary(label, rows):
    if not rows:
        return {'label': label, 'start_date': None, 'end_date': None, 'total_predicted_sales': 0, 'total_predicted_quantity': 0, 'rows': 0}
    return {
        'label': label,
        'start_date': rows[0]['target_date'],
        'end_date': rows[-1]['target_date'],
        'total_predicted_sales': _round(sum(row['predicted_sales'] for row in rows)),
        'total_predicted_quantity': _round(sum(row['predicted_quantity'] for row in rows)),
        'average_daily_sales': _round(sum(row['predicted_sales'] for row in rows) / len(rows)),
        'rows': len(rows),
    }


def generate_forecast_report(source_name=DEFAULT_SOURCE_NAME, horizon=FORECAST_HORIZON_DAYS):
    """Return a JSON-ready report sourced only from the active Supabase batch."""
    data = preprocess_sales_history(source_name)
    if data['status'] != 'ok':
        return _empty_report(data)

    horizon = max(14, min(int(horizon), 365))
    daily = data['daily']
    total_sales, sales_lower, sales_upper, sales_model = _series_forecast(daily, 'actual_sales', horizon)
    total_quantity, _, _, quantity_model = _series_forecast(daily, 'actual_quantity', horizon)
    last_date = daily['date'].max()
    future_dates = pd.date_range(last_date + timedelta(days=1), periods=horizon, freq='D')
    sales_forecast = [
        {
            'target_date': _date_text(target_date),
            'predicted_sales': _round(total_sales[index]),
            'predicted_quantity': _round(total_quantity[index]),
            'lower_bound': _round(sales_lower[index]),
            'upper_bound': _round(sales_upper[index]),
            'data_type': 'prediction',
        }
        for index, target_date in enumerate(future_dates)
    ]

    actual_history = [
        {
            'date': _date_text(row['date']),
            'actual_sales': _round(row['actual_sales']),
            'actual_quantity': _round(row['actual_quantity']),
            'transaction_count': int(row['transaction_count']),
            'is_observed': bool(row['is_observed']),
            'is_imputed': bool(row['is_imputed']),
            'data_type': 'actual' if row['is_observed'] else 'missing_date',
        }
        for _, row in daily.iterrows()
    ]

    product_forecasts = []
    product_sales_forecast = []
    demand_forecast = []
    product_next_7 = []
    for product_key, product_daily in sorted(data['products'].items(), key=lambda item: str(item[1]['product_name'].iloc[0]).casefold()):
        product_quantity, product_lower, product_upper, product_model = _series_forecast(product_daily, 'actual_quantity', horizon)
        unit_revenue = data['product_unit_revenue'].get(product_key, 0.0)
        product_rows = []
        for index, target_date in enumerate(future_dates):
            row = {
                'target_date': _date_text(target_date),
                'predicted_quantity': _round(product_quantity[index]),
                'predicted_sales': _round(product_quantity[index] * unit_revenue),
                'lower_bound': _round(product_lower[index] * unit_revenue),
                'upper_bound': _round(product_upper[index] * unit_revenue),
                'data_type': 'prediction',
            }
            product_rows.append(row)
            demand_forecast.append({'product_name': product_daily['product_name'].iloc[0], **row})
            product_sales_forecast.append({'product_name': product_daily['product_name'].iloc[0], **row})
        product_summary = {
            'product_name': product_daily['product_name'].iloc[0],
            'history_days': product_model['history_days'],
            'observed_days': product_model['observed_days'],
            'historical_quantity': _round(product_daily['actual_quantity'].sum()),
            'historical_sales': _round(product_daily['actual_sales'].sum()),
            'predicted_next_7_days_quantity': _round(sum(row['predicted_quantity'] for row in product_rows[:7])),
            'predicted_next_7_days_sales': _round(sum(row['predicted_sales'] for row in product_rows[:7])),
            'model': product_model,
            'forecast': product_rows,
        }
        product_forecasts.append(product_summary)
        product_next_7.append({
            'product_name': product_summary['product_name'],
            'predicted_quantity': product_summary['predicted_next_7_days_quantity'],
            'predicted_sales': product_summary['predicted_next_7_days_sales'],
        })

    monthly_frame = pd.DataFrame(sales_forecast)
    monthly_frame['month'] = pd.to_datetime(monthly_frame['target_date']).dt.to_period('M')
    monthly_forecast = [
        {
            'target_date': f'{period}-01',
            'date_range': {'start': group['target_date'].min(), 'end': group['target_date'].max()},
            'predicted_sales': _round(group['predicted_sales'].sum()),
            'predicted_quantity': _round(group['predicted_quantity'].sum()),
            'lower_bound': _round(group['lower_bound'].sum()),
            'upper_bound': _round(group['upper_bound'].sum()),
            'data_type': 'prediction',
        }
        for period, group in monthly_frame.groupby('month', sort=True)
    ]

    data_sufficient = sales_model['reliable']
    sufficiency_message = (
        'Enough history is available for a held-out backtest.'
        if data_sufficient else
        f"Only {data['summary']['history_days']} calendar days and {data['summary']['observed_days']} days with recorded sales are available. "
        f"The projection is a baseline, not a reliable accuracy claim; at least {MIN_RELIABLE_HISTORY_DAYS} calendar days and "
        f"{MIN_RELIABLE_OBSERVED_DAYS} observed days are recommended."
    )
    forecast_ranges = {
        'next_7_days': _range_summary('Next 7 days', sales_forecast[:7]),
        'next_week': _range_summary('Following week', sales_forecast[7:14]),
        'upcoming_months': [{**month, 'reliable': data_sufficient} for month in monthly_forecast],
    }

    return {
        'status': 'ok',
        'source_file': data['summary']['source_file'],
        'source_hash': data['summary']['source_hash'],
        'import_id': data['summary']['import_id'],
        'imported_at': data['summary']['imported_at'],
        'history_start': _date_text(daily['date'].min()),
        'history_end': _date_text(daily['date'].max()),
        'forecast_start': sales_forecast[0]['target_date'],
        'forecast_end': sales_forecast[-1]['target_date'],
        'generated_at': timezone.now().isoformat(),
        'model': sales_model,
        'quantity_model': quantity_model,
        'metrics': sales_model['metrics'],
        'data_sufficiency': {
            'is_sufficient': data_sufficient,
            'status': 'sufficient' if data_sufficient else 'insufficient_history',
            'message': sufficiency_message,
            'minimum_reliable_history_days': MIN_RELIABLE_HISTORY_DAYS,
            'minimum_reliable_observed_days': MIN_RELIABLE_OBSERVED_DAYS,
            'requested_30_day_observed_coverage': {
                'available': int(data['summary']['observed_days']) >= 30,
                'observed_days': int(data['summary']['observed_days']),
                'required_observed_days': 30,
            },
        },
        'data_quality': {
            **data['summary'],
            'start_date': data['summary']['start_date'].isoformat(),
            'end_date': data['summary']['end_date'].isoformat(),
            'revenue_allocation': 'Transaction total allocated by parsed item quantity for product-level revenue.',
        },
        'actual_history': actual_history,
        'sales_forecast': sales_forecast,
        'monthly_forecast': monthly_forecast,
        'forecast_ranges': forecast_ranges,
        'product_forecasts': product_forecasts,
        'product_forecast_summary': product_next_7,
        'product_sales_forecast': product_sales_forecast,
        'demand_forecast': demand_forecast,
        'reorder_recommendations': get_reorder_recommendations(),
    }


def train_and_forecast_sales(days=FORECAST_HORIZON_DAYS):
    return generate_forecast_report(horizon=max(14, min(int(days), 365)))


def train_and_forecast_demand():
    return generate_forecast_report().get('product_forecasts', [])


def get_reorder_recommendations():
    reorders = []
    for product in Product.objects.filter(item_type=Product.PRODUCT, is_active=True):
        seven_day_forecast = max(0, int(product.reorder_point or 0))
        projected_stock = product.stock_level - seven_day_forecast
        needs_reorder = product.stock_level <= product.reorder_point or projected_stock <= 0
        if needs_reorder:
            reorders.append({
                'product_id': product.id,
                'product_name': product.name,
                'current_stock': product.stock_level,
                'reorder_point': product.reorder_point,
                '7_day_forecasted_demand': seven_day_forecast,
                'projected_stock': projected_stock,
                'recommended_order_quantity': max(10, (seven_day_forecast + (product.reorder_point * 2)) - product.stock_level),
                'supplier_name': (product.supplier_details or {}).get('name', 'N/A'),
            })
    return reorders
