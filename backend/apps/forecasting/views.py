import os
import tempfile

from django.core.cache import cache
from django.utils import timezone
from rest_framework import views
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework import status

from ml.forecasting_engine import generate_forecast_report
from ml.sales_history_repository import DEFAULT_SOURCE_NAME, get_active_sales_history, import_sales_history_csv
from ml.linear_regression_forecasting import MODEL_VERSION, create_forecast_run, serialize_run
from forecasting.models import ForecastRun
from users.permissions import IsStaffOrAdmin

FORECAST_CACHE_SECONDS = 20


def forecast_cache_key():
    return f'forecasting:dashboard-report:v2:{timezone.localdate().isoformat()}'


class ForecastingDataView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request, *args, **kwargs):
        active_batch, _ = get_active_sales_history(DEFAULT_SOURCE_NAME)
        if not active_batch:
            import_result = import_sales_history_csv(source_name=DEFAULT_SOURCE_NAME)
            if import_result.get('status') == 'ok':
                cache.delete(forecast_cache_key())
        report = cache.get_or_set(
            forecast_cache_key(),
            generate_forecast_report,
            timeout=FORECAST_CACHE_SECONDS,
        )
        return Response(report)


class SalesHistoryImportView(views.APIView):
    """Staff-only online refresh endpoint for the active forecasting snapshot."""

    permission_classes = [IsStaffOrAdmin]
    parser_classes = [MultiPartParser, FormParser]
    max_upload_bytes = 10 * 1024 * 1024

    def post(self, request, *args, **kwargs):
        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'Attach a CSV file in the file field.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > self.max_upload_bytes:
            return Response({'detail': 'The sales history CSV must be 10 MB or smaller.'}, status=status.HTTP_400_BAD_REQUEST)
        if not upload.name.lower().endswith('.csv'):
            return Response({'detail': 'Only CSV files are accepted.'}, status=status.HTTP_400_BAD_REQUEST)

        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(prefix='sales-history-', suffix='.csv', delete=False) as temporary_file:
                temporary_path = temporary_file.name
                for chunk in upload.chunks():
                    temporary_file.write(chunk)
            result = import_sales_history_csv(temporary_path, source_filename=upload.name)
        finally:
            if temporary_path:
                try:
                    os.unlink(temporary_path)
                except OSError:
                    pass

        response_status = status.HTTP_201_CREATED if result.get('imported') else status.HTTP_200_OK
        if result.get('status') != 'ok':
            response_status = status.HTTP_400_BAD_REQUEST
        else:
            # A content duplicate can still reactivate a snapshot after changing source.
            cache.delete(forecast_cache_key())
        return Response(result, status=response_status)


class MachineLearningForecastView(views.APIView):
    """Read saved forecasts and run an explicitly requested controlled batch."""

    permission_classes = [IsStaffOrAdmin]

    def get(self, request, *args, **kwargs):
        runs = list(ForecastRun.objects.filter(model_version=MODEL_VERSION)[:20])
        return Response({
            'latest': serialize_run(runs[0]) if runs else None,
            'history': [serialize_run(run) for run in runs],
            'forecast_horizon_default_days': 7,
            'dataset_file': 'CAV_Three_Year_Synthetic_Sales-Daily sales.csv',
            'dataset_type': 'Synthetic daily sales data',
            'implementation_assumption': 'Linear regression fits daily Sales (PHP) against elapsed calendar days. Exact duplicate rows are removed, duplicate dates are summed, invalid date or sales rows are skipped, and missing calendar dates are filled with zero. Evaluation uses the first 80% of dates for training and the later 20% for testing. The default forecast horizon is seven calendar days.',
        })

    def post(self, request, *args, **kwargs):
        horizon_value = request.data.get('horizon_days', 7)
        if isinstance(horizon_value, bool) or not str(horizon_value).strip().isdigit():
            return Response({'horizon_days': 'Use a whole number from 1 to 90.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            horizon = int(horizon_value)
        except (TypeError, ValueError):
            return Response({'horizon_days': 'Use a whole number from 1 to 90.'}, status=status.HTTP_400_BAD_REQUEST)
        if not 1 <= horizon <= 90:
            return Response({'horizon_days': 'Use a whole number from 1 to 90.'}, status=status.HTTP_400_BAD_REQUEST)
        run = create_forecast_run(horizon=horizon)
        return Response(serialize_run(run), status=status.HTTP_201_CREATED)
