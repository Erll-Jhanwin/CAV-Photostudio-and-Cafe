import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from ml.datasets.sales_dataset import load_sales_from_db, generate_sales_data
from ml.preprocessing.cleaner import clean_sales_data, engineer_features, aggregate_daily
from ml.models.prophet_model import train_prophet_model, predict_with_prophet
from ml.models.sklearn_models import train_random_forest, evaluate_model
from ml.utils.helpers import prepare_features


def train_sales_forecast(days=365):
    try:
        df = load_sales_from_db()
    except Exception:
        df = generate_sales_data(days=days)

    df = clean_sales_data(df)
    df = engineer_features(df)
    daily = aggregate_daily(df)

    prophet_model = train_prophet_model(daily, target_col='quantity')
    forecast = predict_with_prophet(prophet_model, periods=30)

    return {
        'model': prophet_model,
        'forecast': forecast,
        'daily': daily,
    }


def train_demand_forecast():
    try:
        df = load_sales_from_db()
    except Exception:
        df = generate_sales_data(days=365)

    df = clean_sales_data(df)
    df = engineer_features(df)

    product_groups = df.groupby('product')
    results = {}
    for product, group in product_groups:
        daily = aggregate_daily(group)
        if len(daily) > 30:
            model = train_prophet_model(daily, target_col='quantity')
            forecast = predict_with_prophet(model, periods=30)
            results[product] = {
                'model': model,
                'forecast': forecast,
            }
    return results
