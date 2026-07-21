from datetime import datetime, timedelta

from inventory.models import Product


def train_and_forecast_sales():
    return "Sales forecasts are calculated at request time in the compact schema."


def train_and_forecast_demand():
    return "Demand forecasts are calculated at request time in the compact schema."


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
