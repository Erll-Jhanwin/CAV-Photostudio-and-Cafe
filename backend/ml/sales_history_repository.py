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


def _decimal(value, default=None):
    """Parse a PHP-style amount without confusing invalid/missing input with zero."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return default
    cleaned = str(value).strip()
    if not cleaned:
        return default
    negative_parentheses = cleaned.startswith('(') and cleaned.endswith(')')
    if negative_parentheses:
        cleaned = cleaned[1:-1].strip()
    cleaned = re.sub(r'^(?:PHP|₱)\s*|\s*(?:PHP|₱)$', '', cleaned, flags=re.IGNORECASE).strip()
    # Commas are accepted only as correctly grouped thousands separators.
    if not re.fullmatch(r'[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)', cleaned):
        return default
    try:
        parsed = Decimal(cleaned.replace(',', ''))
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
        'import_id': batch.id if batch else None,
        'status': 'ok',
        'source_name': batch.source_name if batch else DEFAULT_SOURCE_NAME,
        'source_filename': batch.source_filename if batch else '',
        'source_hash': batch.source_hash if batch else '',
        'imported': False,
        'duplicate': False,
        'row_count': batch.row_count if batch else 0,
        'imported_row_count': batch.imported_row_count if batch else 0,
        'skipped_row_count': batch.skipped_row_count if batch else 0,
        'quality_report': batch.quality_report if batch else {},
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
    if not total_column and not total_amount_column:
        return _result(status='invalid', detail='Sales history CSV needs a recognized sales/revenue column; sales values cannot be inferred from quantities.')

    valid_rows = []
    skipped_count = exact_duplicate_count
    invalid_date_count = 0
    invalid_sales_count = 0
    invalid_quantity_count = 0
    for index, row in raw.iterrows():
        parsed_date = pd.to_datetime(row[date_column], format='mixed', errors='coerce')
        quantity = _decimal(row[quantity_column]) if quantity_column else Decimal('0')
        total_amount = _decimal(row[total_amount_column]) if total_amount_column else None
        raw_total = row[total_column] if total_column else ''
        # A daily Sales (PHP) column is authoritative. Blank or malformed
        # values are skipped; a genuine numeric zero remains a valid sale row.
        if daily_sales_column is not None:
            total = _decimal(row[daily_sales_column])
        elif total_column and str(raw_total).strip():
            total = _decimal(raw_total)
        else:
            total = total_amount
        items_description = str(row[items_column] if items_column else '').strip()
        date_invalid = pd.isna(parsed_date)
        sales_invalid = total is None or total < 0
        quantity_invalid = quantity_column is not None and (quantity is None or quantity < 0)
        if date_invalid or sales_invalid or quantity_invalid:
            skipped_count += 1
            invalid_date_count += int(date_invalid)
            invalid_sales_count += int(sales_invalid)
            invalid_quantity_count += int(quantity_invalid)
            continue
        valid_rows.append(SalesHistoryRecord(
            source_row_number=int(index) + 2,
            transaction_number=str(row[number_column]).strip() if number_column else str(int(index) + 2),
            status=str(row[status_column]).strip() if status_column else 'Sale',
            sold_at=_aware_datetime(parsed_date),
            sale_date=parsed_date.date(),
            quantity=quantity,
            total_amount=max(total_amount or Decimal('0'), Decimal('0')),
            total=total,
            items_description=items_description,
        ))

    if not valid_rows:
        return _result(status='invalid', source_filename=path.name, source_hash=source_hash, row_count=source_row_count, skipped_row_count=skipped_count, detail='No rows with valid dates and explicit non-negative sales values were found in the CSV.')

    dates = [row.sale_date for row in valid_rows]
    sales_column_mapping = {
        'date': date_column,
        'sales_php': daily_sales_column or total_column or total_amount_column,
        'quantity': quantity_column,
        'transaction_total': total_column,
        'total_amount': total_amount_column,
        'items': items_column,
    }
    quality_report = {
        'source_columns': list(raw.columns),
        'column_mapping': sales_column_mapping,
        'raw_rows': source_row_count,
        'valid_rows': len(valid_rows),
        'skipped_rows': skipped_count,
        'exact_duplicate_rows_removed': exact_duplicate_count,
        'invalid_date_rows': invalid_date_count,
        'missing_or_invalid_sales_rows': invalid_sales_count,
        'missing_or_invalid_quantity_rows': invalid_quantity_count,
        'zero_sales_rows': sum(row.total == 0 for row in valid_rows),
        'duplicate_date_rows': len(valid_rows) - len(set(dates)),
        'sales_total_php': float(sum((row.total for row in valid_rows), Decimal('0.00'))),
    }
    with transaction.atomic():
        batch = SalesHistoryImport.objects.select_for_update().filter(source_hash=source_hash).first()
        reprocessed = batch is not None
        if batch is None:
            batch = SalesHistoryImport.objects.create(
                source_name=source_name,
                source_filename=source_filename or path.name,
                source_hash=source_hash,
                status=SalesHistoryImport.PENDING,
                row_count=source_row_count,
                imported_row_count=len(valid_rows),
                skipped_row_count=skipped_count,
                quality_report=quality_report,
                history_start=min(dates),
                history_end=max(dates),
            )
        else:
            # Repair legacy snapshots with the same content hash in place.
            # Replacing child rows avoids duplicate transactions on re-import.
            batch.records.all().delete()
            batch.source_name = source_name
            batch.source_filename = source_filename or path.name
            batch.status = SalesHistoryImport.PENDING
            batch.row_count = source_row_count
            batch.imported_row_count = len(valid_rows)
            batch.skipped_row_count = skipped_count
            batch.quality_report = quality_report
            batch.history_start = min(dates)
            batch.history_end = max(dates)
            batch.error_message = ''
        for row in valid_rows:
            row.import_batch = batch
        SalesHistoryRecord.objects.bulk_create(valid_rows, batch_size=1000)
        SalesHistoryImport.objects.filter(source_name=source_name, is_active=True).update(is_active=False)
        batch.status = SalesHistoryImport.READY
        batch.is_active = True
        batch.completed_at = timezone.now()
        batch.save(update_fields=[
            'source_name', 'source_filename', 'status', 'is_active', 'completed_at',
            'row_count', 'imported_row_count', 'skipped_row_count',
            'quality_report',
            'history_start', 'history_end', 'error_message',
        ])

    return _result(batch, imported=not reprocessed, duplicate=reprocessed,
                   reprocessed=reprocessed,
                   column_mapping=sales_column_mapping,
                   quality_report=quality_report,
                   detail='Existing CSV snapshot was revalidated and repaired in place.' if reprocessed else 'Sales history imported and activated.')


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
