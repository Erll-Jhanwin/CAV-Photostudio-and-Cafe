import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta
from django.db.models import Sum
from sklearn.ensemble import RandomForestRegressor
from sales.models import DailySalesSummary
from forecasting.models import SalesPrediction, DemandPrediction
from inventory.models import Product, StockMovement

def train_and_forecast_sales():
    """
    Retrieves historical sales, trains a regression model, 
    forecasts the next 7 days, and updates the SalesPrediction database table.
    """
    summaries = DailySalesSummary.objects.all().order_by('date')
    if not summaries.exists() or summaries.count() < 10:
        return "Insufficient historical sales data for forecasting."

    # 1. Convert to DataFrame
    data = []
    for s in summaries:
        data.append({
            'date': s.date,
            'pos_revenue': float(s.pos_revenue),
            'booking_revenue': float(s.booking_revenue),
            'total_revenue': float(s.total_revenue)
        })
    df = pd.DataFrame(data)
    df['date'] = pd.to_datetime(df['date'])
    df['day_of_week'] = df['date'].dt.dayofweek
    df['day_of_month'] = df['date'].dt.day
    df['month'] = df['date'].dt.month
    df['trend_idx'] = np.arange(len(df))

    # 2. Features and Targets
    # One-hot encode day of week to capture weekend spikes
    X = pd.get_dummies(df[['day_of_week', 'month', 'trend_idx']], columns=['day_of_week', 'month'], drop_first=False)
    y_pos = df['pos_revenue']
    y_booking = df['booking_revenue']

    # 3. Train Models
    model_pos = RandomForestRegressor(n_estimators=50, random_state=42)
    model_pos.fit(X, y_pos)

    model_book = RandomForestRegressor(n_estimators=50, random_state=42)
    model_book.fit(X, y_booking)

    # 4. Generate Future Feature Matrix for next 7 days
    last_date = df['date'].max()
    last_trend = df['trend_idx'].max()
    
    future_dates = [last_date + timedelta(days=i) for i in range(1, 8)]
    future_data = []
    for i, f_date in enumerate(future_dates):
        future_data.append({
            'date': f_date,
            'day_of_week': f_date.dayofweek,
            'month': f_date.month,
            'trend_idx': last_trend + i + 1
        })
    df_future = pd.DataFrame(future_data)
    
    # Align future columns with training columns (filling missing categories with 0)
    X_future = pd.get_dummies(df_future[['day_of_week', 'month', 'trend_idx']], columns=['day_of_week', 'month'], drop_first=False)
    X_future = X_future.reindex(columns=X.columns, fill_value=0)

    # 5. Predict
    pred_pos = model_pos.predict(X_future)
    pred_book = model_book.predict(X_future)
    pred_total = pred_pos + pred_book

    # Calculate Standard Error (RMSE) to draw confidence intervals
    rmse_pos = np.sqrt(np.mean((y_pos - model_pos.predict(X)) ** 2))
    rmse_book = np.sqrt(np.mean((y_booking - model_book.predict(X)) ** 2))
    rmse_total = np.sqrt(rmse_pos**2 + rmse_book**2)

    # 6. Save predictions to DB
    predictions_created = 0
    for idx, f_date in enumerate(future_dates):
        target_date = f_date.date()
        predicted_val = round(pred_total[idx], 2)
        lower_b = max(0.00, round(predicted_val - (1.645 * rmse_total), 2)) # 90% confidence level
        upper_b = round(predicted_val + (1.645 * rmse_total), 2)

        SalesPrediction.objects.update_or_create(
            target_date=target_date,
            defaults={
                'predicted_sales': predicted_val,
                'lower_bound': lower_b,
                'upper_bound': upper_b
            }
        )
        predictions_created += 1

    return f"Created/Updated {predictions_created} sales predictions for the next 7 days."

def train_and_forecast_demand():
    """
    Forecasts unit demand for all café items and photo supplies for the next 7 days
    based on product sales velocity, and populates the DemandPrediction database table.
    """
    products = Product.objects.all()
    if not products.exists():
        return "No products found for demand forecasting."

    # Look back at stock movements to establish sales velocity
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    
    # We will estimate a simple daily sales average per product, add weekend weighting, and forecast.
    forecasts_created = 0
    
    for product in products:
        # Sum OUT movements for this product over 30 days
        movements_sum = StockMovement.objects.filter(
            product=product,
            movement_type='OUT',
            timestamp__range=(start_date, end_date)
        ).aggregate(total_sold=Sum('quantity'))['total_sold'] or 0
        
        # If no sales movements exist, seed a small baseline based on SKU type
        if movements_sum == 0:
            if product.is_cafe_item:
                daily_avg = random.uniform(3.0, 8.0) # Café items sell more frequently
            else:
                daily_avg = random.uniform(0.2, 1.0) # Photo supplies are lower velocity
        else:
            daily_avg = float(movements_sum) / 30.0

        # Forecast next 7 days
        current_date = datetime.now().date()
        for day in range(1, 8):
            target_date = current_date + timedelta(days=day)
            
            # Seasonality multiplier (weekends have higher sales velocity)
            is_weekend = target_date.weekday() in [5, 6]
            multiplier = 2.0 if is_weekend else 0.8
            
            predicted_qty = int(np.round(daily_avg * multiplier + random.uniform(-1, 1)))
            predicted_qty = max(0, predicted_qty)

            DemandPrediction.objects.update_or_create(
                product=product,
                target_date=target_date,
                defaults={
                    'predicted_quantity': predicted_qty
                }
            )
            forecasts_created += 1

    return f"Created/Updated {forecasts_created} demand predictions."

def get_reorder_recommendations():
    """
    Evaluates current inventory levels against the next 7 days of forecasted demand.
    Generates a list of recommended restock actions.
    """
    products = Product.objects.all()
    reorders = []
    
    current_date = datetime.now().date()
    end_date = current_date + timedelta(days=7)

    for product in products:
        # Calculate sum of predicted demand for next 7 days
        predicted_demand = DemandPrediction.objects.filter(
            product=product,
            target_date__range=(current_date + timedelta(days=1), end_date)
        ).aggregate(total_demand=Sum('predicted_quantity'))['total_demand'] or 0

        projected_stock = product.stock_level - predicted_demand
        
        # Trigger reorder if current stock is below reorder point
        # OR if projected stock after 7 days will be below 0
        needs_reorder = (product.stock_level <= product.reorder_point) or (projected_stock <= 0)
        
        if needs_reorder:
            # Recommend ordering enough to cover next 7 days demand + double the reorder point
            recommended_qty = max(10, (predicted_demand + (product.reorder_point * 2)) - product.stock_level)
            reorders.append({
                'product_id': product.id,
                'product_name': product.name,
                'current_stock': product.stock_level,
                'reorder_point': product.reorder_point,
                '7_day_forecasted_demand': predicted_demand,
                'projected_stock': projected_stock,
                'recommended_order_quantity': recommended_qty,
                'supplier_name': product.supplier.name if product.supplier else "N/A"
            })
            
    return reorders
