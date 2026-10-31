"""Import and read the forecasting-owned sales history tables.

The file is used only at import time. Forecast requests read the active
validated snapshot from PostgreSQL/Supabase through Django ORM.
"""

import hashlib
import math
import os
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pandas as pd
from django.db import transaction
from django.utils import timezone

from forecasting.models import SalesHistoryImport, SalesHistoryRecord


DEFAULT_SOURCE_NAME = 'cav_synthetic_daily_sales'
DEFAULT_CSV_FILENAME = 'CAV_Three_Year_Synthetic_Sales-Daily sales.csv'
EXCLUDED_STATUS_PATTERN = re.compile(r'cancel|void|refund|reject|failed|declined', re.IGNORECASE)


def _normalise_header(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').casefold()).strip()


def _find_column(columns, aliases):
    by_name = {_normalise_header(column): column for column in columns}
    for alias in aliases:
        found = by_name.get(_normalise_header(alias))
        if found:
            return found
    return None


def _decimal(value, default=Decimal('0')):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return default
    cleaned = str(value).strip().replace(',', '')
    negative_parentheses = cleaned.startswith('(') and cleaned.endswith(')')
    if negative_parentheses:
        cleaned = cleaned[1:-1].strip()
    cleaned = re.sub(r'^(?:PHP|₱)\s*|\s*(?:PHP|₱)$', '', cleaned, flags=re.IGNORECASE).strip()
    if not cleaned or not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)', cleaned):
        return default
    try:
        parsed = Decimal(cleaned)
        if negative_parentheses:
            parsed = -parsed
        return parsed.quantize(Decimal('0.01')) if parsed.is_finite() else default
    except (InvalidOperation, ValueError):
        return default


def resolve_csv_path(csv_path=None):
    configured = csv_path or os.environ.get('SALES_HISTORY_CSV_PATH', '')
    candidates = []
    if configured:
        configured_path = Path(configured)
        candidates.append(configured_path if configured_path.is_absolute() else Path(__file__).resolve().parents[1] / configured_path)
        return candidates[0]
    backend_dir = Path(__file__).resolve().parents[1]
    candidates.extend([
        backend_dir.parent / DEFAULT_CSV_FILENAME,
        backend_dir / DEFAULT_CSV_FILENAME,
        backend_dir / 'ml' / 'datasets' / DEFAULT_CSV_FILENAME,
    ])
    return next((candidate for candidate in candidates if candidate.is_file()), candidates[0])


def _aware_datetime(value):
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is not None:
        return timestamp.to_pydatetime()
    return timezone.make_aware(timestamp.to_pydatetime(), timezone.get_current_timezone())


def _result(batch=None, **values):
    result = {
        'status': 'ok',
        'source_name': batch.source_name if batch else DEFAULT_SOURCE_NAME,
        'source_filename': batch.source_filename if batch else '',
        'source_hash': batch.source_hash if batch else '',
        'imported': False,
        'duplicate': False,
        'row_count': batch.row_count if batch else 0,
        'imported_row_count': batch.imported_row_count if batch else 0,
        'skipped_row_count': batch.skipped_row_count if batch else 0,
        'detail': '',
    }
    result.update(values)
    return result


def import_sales_history_csv(csv_path=None, source_name=DEFAULT_SOURCE_NAME, source_filename=None):
    """Validate and atomically activate a new immutable CSV snapshot."""
    path = resolve_csv_path(csv_path)
    if not path.is_file():
        return _result(status='unavailable', detail=f'Sales history CSV was not found at {path}.')

    try:
        file_bytes = path.read_bytes()
        raw = pd.read_csv(path, dtype=str, keep_default_na=False)
    except (OSError, ValueError, pd.errors.ParserError) as exc:
        return _result(status='invalid', detail=f'Could not read sales history CSV: {exc}')

    source_hash = hashlib.sha256(file_bytes).hexdigest()
    existing = SalesHistoryImport.objects.filter(source_hash=source_hash).first()
    if existing and existing.status == SalesHistoryImport.READY:
        with transaction.atomic():
            SalesHistoryImport.objects.filter(source_name=source_name, is_active=True).exclude(pk=existing.pk).update(is_active=False)
            changed_fields = []
            if existing.source_name != source_name:
                existing.source_name = source_name
                changed_fields.append('source_name')
            if not existing.is_active:
                existing.is_active = True
                changed_fields.append('is_active')
            if changed_fields:
                existing.save(update_fields=changed_fields)
        return _result(existing, duplicate=True, detail='This CSV has already been imported; the existing snapshot is active.')

    source_row_count = len(raw)
    if raw.empty:
        return _result(status='invalid', detail='Sales history CSV is empty.')

    raw = raw.drop_duplicates()
    exact_duplicate_count = source_row_count - len(raw)

    date_column = _find_column(raw.columns, ['Date/Time', 'Date Time', 'Datetime', 'Date', 'Timestamp'])
    status_column = _find_column(raw.columns, ['Status', 'State'])
    quantity_column = _find_column(raw.columns, ['Qty.', 'Qty', 'Quantity', 'Units'])
    total_amount_column = _find_column(raw.columns, ['Total amount', 'Subtotal', 'Amount'])
    daily_sales_column = _find_column(raw.columns, ['Sales (PHP)'])
    total_column = _find_column(raw.columns, ['Total', 'Sales', 'Sales (PHP)', 'Revenue'])
    items_column = _find_column(raw.columns, ['Items Description', 'Item Description', 'Items', 'Product', 'Description'])
    number_column = _find_column(raw.columns, ['Number', 'Transaction', 'Transaction ID', 'Order'])

    if not date_column:
        return _result(status='invalid', detail='Sales history CSV needs a date or date/time column.')
    if not quantity_column and not total_column and not items_column:
        return _result(status='invalid', detail='Sales history CSV has no quantity, amount, or item column.')

    valid_rows = []
    skipped_count = exact_duplicate_count
    for index, row in raw.iterrows():
        parsed_date = pd.to_datetime(row[date_column], format='mixed', errors='coerce')
        quantity = _decimal(row[quantity_column]) if quantity_column else Decimal('0')
        total_amount = _decimal(row[total_amount_column]) if total_amount_column else Decimal('0')
        raw_total = row[total_column] if total_column else ''
        total = _decimal(raw_total, default=None) if total_column and str(raw_total).strip() else total_amount
        if daily_sales_column is not None and not str(raw_total).strip():
            total = None
        items_description = str(row[items_column] if items_column else '').strip()
        if (pd.isna(parsed_date) or total is None or quantity < 0 or total_amount < 0
                or (daily_sales_column is not None and total < 0)
                or (daily_sales_column is None and quantity <= 0 and total <= 0 and not items_description)):
            skipped_count += 1
            continue
        valid_rows.append(SalesHistoryRecord(
            source_row_number=int(index) + 2,
            transaction_number=str(row[number_column]).strip() if number_column else str(int(index) + 2),
            status=str(row[status_column]).strip() if status_column else 'Sale',
            sold_at=_aware_datetime(parsed_date),
            sale_date=parsed_date.date(),
            quantity=max(quantity, Decimal('0')),
            total_amount=max(total_amount, Decimal('0')),
            total=max(total, Decimal('0')),
            items_description=items_description,
        ))

    if not valid_rows:
        return _result(status='invalid', source_filename=path.name, source_hash=source_hash, row_count=len(raw), skipped_row_count=skipped_count, detail='No valid sales rows were found in the CSV.')

    dates = [row.sale_date for row in valid_rows]
    with transaction.atomic():
        batch = SalesHistoryImport.objects.create(
            source_name=source_name,
            source_filename=source_filename or path.name,
            source_hash=source_hash,
            status=SalesHistoryImport.PENDING,
            row_count=source_row_count,
            imported_row_count=len(valid_rows),
            skipped_row_count=skipped_count,
            history_start=min(dates),
            history_end=max(dates),
        )
        for row in valid_rows:
            row.import_batch = batch
        SalesHistoryRecord.objects.bulk_create(valid_rows, batch_size=1000)
        SalesHistoryImport.objects.filter(source_name=source_name, is_active=True).update(is_active=False)
        batch.status = SalesHistoryImport.READY
        batch.is_active = True
        batch.completed_at = timezone.now()
        batch.save(update_fields=['status', 'is_active', 'completed_at'])

    return _result(batch, imported=True, detail='Sales history imported and activated.')


def get_active_sales_history(source_name=DEFAULT_SOURCE_NAME):
    """Return the active import and only its normalized records."""
    batch = SalesHistoryImport.objects.filter(
        source_name=source_name,
        status=SalesHistoryImport.READY,
        is_active=True,
    ).order_by('-created_at').first()
    if not batch:
        return None, []
    records = list(batch.records.values(
        'sold_at', 'sale_date', 'transaction_number', 'status',
        'quantity', 'total_amount', 'total', 'items_description',
    ))
    return batch, records
