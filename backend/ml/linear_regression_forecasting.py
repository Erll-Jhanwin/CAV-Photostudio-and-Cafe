"""Daily-sales OLS forecasting over the bundled synthetic CAV history."""
import math
from datetime import timedelta
from pathlib import Path

import pandas as pd
from django.db import transaction

from forecasting.models import ForecastRun

MODEL_VERSION = 'daily-sales-ols-synthetic-v1'
DEFAULT_HORIZON_DAYS = 7
DATASET_FILENAME = 'CAV_Three_Year_Synthetic_Sales-Daily sales.csv'
REQUIRED_COLUMNS = ('Date', 'Sales (PHP)')


def dataset_path():
    return Path(__file__).resolve().parent / 'datasets' / DATASET_FILENAME


def load_daily_sales(path=None):
    """Validate rows, remove exact duplicates, aggregate duplicate dates, and fill calendar gaps with zero."""
    source = Path(path) if path else dataset_path()
    if not source.is_file():
        return {'status': 'unavailable', 'detail': f'Synthetic sales dataset was not found: {source}', 'values': [], 'dates': [], 'quality': {}}
    try:
        raw = pd.read_csv(source, dtype=str, keep_default_na=False)
    except (OSError, UnicodeError, ValueError, pd.errors.ParserError) as exc:
        return {'status': 'invalid', 'detail': f'Could not read synthetic sales dataset: {exc}', 'values': [], 'dates': [], 'quality': {}}
    missing_columns = [column for column in REQUIRED_COLUMNS if column not in raw.columns]
    if missing_columns:
        return {'status': 'invalid', 'detail': f"Dataset is missing required columns: {', '.join(missing_columns)}", 'values': [], 'dates': [], 'quality': {'columns': list(raw.columns)}}

    original_count = len(raw)
    raw = raw.drop_duplicates()
    exact_duplicates = original_count - len(raw)
    dates = pd.to_datetime(raw['Date'].astype(str).str.strip(), format='mixed', errors='coerce')
    sales_text = raw['Sales (PHP)'].astype(str).str.strip().str.replace(',', '', regex=False).str.replace(r'^(PHP|₱)\s*', '', regex=True)
    sales = pd.to_numeric(sales_text, errors='coerce')
    valid_date = dates.notna()
    valid_sales = sales.notna() & sales.map(math.isfinite) & sales.ge(0)
    kept = valid_date & valid_sales
    skipped_missing_or_invalid_date = int((~valid_date).sum())
    skipped_missing_or_invalid_sales = int((valid_date & ~valid_sales).sum())
    frame = pd.DataFrame({'date': dates[kept].dt.normalize(), 'sales': sales[kept].astype(float).to_numpy()})
    if frame.empty:
        return {'status': 'invalid', 'detail': 'No rows with a valid date and non-negative finite sales value were found.', 'values': [], 'dates': [], 'quality': {'columns': list(raw.columns)}}

    duplicate_date_rows = int(len(frame) - frame['date'].nunique())
    grouped = frame.groupby('date', sort=True)['sales'].sum()
    calendar = pd.date_range(grouped.index.min(), grouped.index.max(), freq='D')
    daily = grouped.reindex(calendar, fill_value=0.0)
    origins = sorted(set(raw.get('Data origin', pd.Series(dtype=str)).astype(str).str.strip().str.upper()) - {''})
    is_synthetic = 'SYNTHETIC' in origins or source.name == DATASET_FILENAME
    return {
        'status': 'ok', 'detail': '',
        'dates': [day.date() for day in calendar],
        'values': [float(value) for value in daily.to_numpy()],
        'quality': {
            'source_file': source.name, 'dataset_type': 'Synthetic dataset' if is_synthetic else 'Dataset',
            'is_synthetic': is_synthetic, 'columns': list(raw.columns),
            'raw_rows': original_count, 'valid_rows': int(kept.sum()),
            'exact_duplicate_rows_removed': exact_duplicates,
            'duplicate_date_rows_aggregated': duplicate_date_rows,
            'invalid_date_rows_skipped': skipped_missing_or_invalid_date,
            'missing_or_invalid_sales_rows_skipped': skipped_missing_or_invalid_sales,
            'calendar_days': len(calendar), 'imputed_missing_days': int(len(calendar) - grouped.size),
            'observed_sales_days': int((daily > 0).sum()),
            'training_sales_total_php': round(float(daily.sum()), 2),
            'start_date': calendar.min().date().isoformat(), 'end_date': calendar.max().date().isoformat(),
        },
    }


def fit_linear_regression(values):
    """Fit y = mx + b using x = elapsed calendar days from the first observation."""
    y_values = [float(value) for value in values]
    n = len(y_values)
    if n < 2:
        raise ValueError('At least two daily observations are required to fit linear regression.')
    x_values = list(range(n))
    sum_x = sum(x_values)
    sum_y = sum(y_values)
    sum_x2 = sum(x * x for x in x_values)
    sum_xy = sum(x * y for x, y in zip(x_values, y_values))
    denominator = n * sum_x2 - sum_x * sum_x
    if denominator == 0:
        raise ValueError('Elapsed-day values do not vary enough to fit linear regression.')
    slope = (n * sum_xy - sum_x * sum_y) / denominator
    intercept = (sum_y - slope * sum_x) / n
    return {
        'sample_count': n, 'sum_x': sum_x, 'sum_y': sum_y,
        'sum_x2': sum_x2, 'sum_xy': sum_xy,
        'slope': slope, 'intercept': intercept,
    }


def _predict(model, x):
    return model['slope'] * x + model['intercept']


def _metrics(actual, predicted):
    if not actual:
        return {'mae': None, 'rmse': None, 'r2': None}
    errors = [a - p for a, p in zip(actual, predicted)]
    mean_actual = sum(actual) / len(actual)
    total_sum_squares = sum((value - mean_actual) ** 2 for value in actual)
    residual_sum_squares = sum(error * error for error in errors)
    r_squared = 1 - residual_sum_squares / total_sum_squares if total_sum_squares else None
    return {
        'mae': round(sum(abs(error) for error in errors) / len(errors), 4),
        'rmse': round(math.sqrt(residual_sum_squares / len(errors)), 4),
        'r2': round(r_squared, 6) if r_squared is not None else None,
    }


def evaluate_series(values, dates=None):
    """Chronological 80/20 holdout; fit both models only on the earlier partition."""
    n = len(values)
    split = int(n * 0.8)
    if split < 2 or split >= n:
        return {'status': 'insufficient_history', 'train_count': split, 'test_count': max(0, n - split), 'backtest': []}
    train = [float(value) for value in values[:split]]
    actual = [float(value) for value in values[split:]]
    linear_model = fit_linear_regression(train)
    predicted = [_predict(linear_model, x) for x in range(split, n)]
    baseline_value = sum(train) / len(train)
    baseline_predicted = [baseline_value] * len(actual)
    start = dates[split] if dates else None
    backtest = [
        {'date': dates[index].isoformat() if dates else str(index), 'actual_revenue': round(actual[i], 2),
         'predicted_revenue': round(predicted[i], 2), 'baseline_revenue': round(baseline_predicted[i], 2), 'unit': 'PHP'}
        for i, index in enumerate(range(split, n))
    ]
    return {
        'status': 'available', 'train_count': split, 'test_count': len(actual), 'split_index': split,
        'training_start': dates[0].isoformat() if dates else None,
        'training_end': dates[split - 1].isoformat() if dates else None,
        'testing_start': start.isoformat() if start else None,
        'testing_end': dates[-1].isoformat() if dates else None,
        'linear_regression': _metrics(actual, predicted),
        'baseline': {'name': 'Training mean baseline', 'value': round(baseline_value, 4), **_metrics(actual, baseline_predicted)},
        'training_computation': linear_model,
        'backtest': backtest,
    }


def create_forecast_run(horizon=DEFAULT_HORIZON_DAYS, csv_path=None):
    horizon = max(1, min(int(horizon), 90))
    data = load_daily_sales(csv_path)
    dates, values, quality = data['dates'], data['values'], data['quality']
    predictions = {'sales': [], 'actual_history': [], 'backtest': []}
    evaluation = {}
    if data['status'] != 'ok' or len(values) < 3:
        run = ForecastRun.objects.create(
            model_version=MODEL_VERSION, horizon_days=horizon, data_status='insufficient_history' if data['status'] == 'ok' else data['status'],
            predictions=predictions, evaluation={'detail': data['detail'] or 'At least three daily observations are needed.'},
        )
        return run

    eval_result = evaluate_series(values, dates)
    evaluation['sales'] = {key: value for key, value in eval_result.items() if key not in {'backtest', 'training_computation', 'split_index'}}
    evaluation['sales']['model'] = 'linear_regression'
    evaluation['sales']['training_computation'] = eval_result['training_computation']
    evaluation['sales']['backtest'] = {
        'mae': eval_result['linear_regression']['mae'], 'rmse': eval_result['linear_regression']['rmse'], 'r2': eval_result['linear_regression']['r2'],
    }
    evaluation['sales']['baseline'] = eval_result['baseline']
    predictions['backtest'] = eval_result['backtest']
    predictions['actual_history'] = [
        {'date': day.isoformat(), 'actual_revenue': round(value, 2), 'unit': 'PHP'} for day, value in zip(dates, values)
    ]
    final_model = fit_linear_regression(values)
    future_dates = [dates[-1] + timedelta(days=step) for step in range(1, horizon + 1)]
    predictions['sales'] = [
        {'date': day.isoformat(), 'predicted_revenue': round(_predict(final_model, len(values) - 1 + step), 2), 'unit': 'PHP'}
        for step, day in enumerate(future_dates, start=1)
    ]
    evaluation['sales']['final_model_computation'] = final_model
    evaluation['sales']['forecast_example'] = predictions['sales'][0]
    evaluation['sales']['data_quality'] = quality
    with transaction.atomic():
        return ForecastRun.objects.create(
            model_version=MODEL_VERSION, horizon_days=horizon, training_start=dates[0], training_end=dates[-1],
            test_start=dates[eval_result['split_index']], test_end=dates[-1], data_status='ready',
            predictions=predictions, evaluation=evaluation, recommendations=[],
        )


def serialize_run(run):
    predictions = run.predictions or {}
    evaluation = run.evaluation or {}
    sales_evaluation = evaluation.get('sales', {})
    quality = sales_evaluation.get('data_quality', {})
    return {
        'id': run.id, 'model_version': run.model_version,
        'generated_at': run.generated_at.isoformat(), 'horizon_days': run.horizon_days,
        'training_period': {'start': run.training_start.isoformat() if run.training_start else None, 'end': run.training_end.isoformat() if run.training_end else None},
        'testing_period': {'start': run.test_start.isoformat() if run.test_start else None, 'end': run.test_end.isoformat() if run.test_end else None},
        'status': run.data_status, 'message': evaluation.get('detail', ''),
        'dataset': quality, 'sales_forecast': predictions.get('sales', []),
        'actual_history': predictions.get('actual_history', []), 'backtest': predictions.get('backtest', []),
        'evaluation': evaluation, 'recommendations': run.recommendations,
    }
