from rest_framework import views, permissions
from rest_framework.response import Response
from forecasting.models import SalesPrediction, DemandPrediction
from ml.forecasting_engine import get_reorder_recommendations

class ForecastingDataView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=403)

        # 1. Fetch sales predictions (next 7 days)
        predictions = SalesPrediction.objects.all().order_by('target_date')
        preds_list = []
        for p in predictions:
            preds_list.append({
                'target_date': p.target_date.strftime('%Y-%m-%d'),
                'predicted_sales': float(p.predicted_sales),
                'lower_bound': float(p.lower_bound) if p.lower_bound else 0.00,
                'upper_bound': float(p.upper_bound) if p.upper_bound else 0.00
            })

        # 2. Fetch reorder recommendations from ML engine
        reorder_recs = get_reorder_recommendations()

        # 3. Product demand predictions (next 7 days)
        demand_preds = DemandPrediction.objects.all().select_related('product').order_by('target_date')
        demand_list = []
        for dp in demand_preds:
            demand_list.append({
                'product_name': dp.product.name,
                'target_date': dp.target_date.strftime('%Y-%m-%d'),
                'predicted_quantity': dp.predicted_quantity
            })

        return Response({
            'sales_forecast': preds_list,
            'demand_forecast': demand_list,
            'reorder_recommendations': reorder_recs
        })
