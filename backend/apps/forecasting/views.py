from rest_framework import views
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta
from ml.forecasting_engine import get_reorder_recommendations
from inventory.models import Product
from users.permissions import IsStaffOrAdmin

class ForecastingDataView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request, *args, **kwargs):
        today = timezone.localdate()
        preds_list = [
            {
                'target_date': (today + timedelta(days=i)).strftime('%Y-%m-%d'),
                'predicted_sales': 0.00,
                'lower_bound': 0.00,
                'upper_bound': 0.00,
            }
            for i in range(1, 8)
        ]

        # 2. Fetch reorder recommendations from ML engine
        reorder_recs = get_reorder_recommendations()

        # 3. Product demand predictions (next 7 days)
        demand_list = []
        for product in Product.objects.filter(item_type=Product.PRODUCT, is_active=True).order_by('name')[:20]:
            for i in range(1, 8):
                demand_list.append({
                    'product_name': product.name,
                    'target_date': (today + timedelta(days=i)).strftime('%Y-%m-%d'),
                    'predicted_quantity': 0,
                })

        return Response({
            'sales_forecast': preds_list,
            'demand_forecast': demand_list,
            'reorder_recommendations': reorder_recs
        })
