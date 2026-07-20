from rest_framework import views, permissions
from rest_framework.response import Response
from django.db.models import Prefetch, Sum, Count
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek
from django.utils import timezone
from datetime import datetime, timedelta
from sales.models import DailySalesSummary
from booking.models import Booking
from inventory.models import Ingredient, Product
from pos.models import Order, OrderItem
from pos.models import Payment


def parse_date(value, fallback):
    if not value:
      return fallback
    try:
      return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError:
      return fallback


def parse_date_param(value, field, fallback):
    if not value:
        return fallback, None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date(), None
    except ValueError:
        return fallback, {field: "Use YYYY-MM-DD format."}


def pct_change(current, previous):
    current = float(current or 0)
    previous = float(previous or 0)
    if previous == 0:
        return 100 if current > 0 else 0
    return round(((current - previous) / previous) * 100, 1)


def money(value):
    return round(float(value or 0), 2)

class DashboardAnalyticsView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=403)

        today = timezone.localdate()
        default_start = today - timedelta(days=30)
        start_date, start_error = parse_date_param(request.query_params.get('start'), 'start', default_start)
        end_date, end_error = parse_date_param(request.query_params.get('end'), 'end', today)
        if start_error:
            return Response(start_error, status=400)
        if end_error:
            return Response(end_error, status=400)
        if start_date > end_date:
            start_date, end_date = end_date, start_date
        if (end_date - start_date).days > 370:
            return Response({"detail": "Date range cannot exceed 370 days."}, status=400)

        grain = request.query_params.get('grain', 'daily')
        if grain not in {'daily', 'weekly', 'monthly'}:
            return Response({"grain": "Grain must be daily, weekly, or monthly."}, status=400)
        trunc_fn = {'weekly': TruncWeek, 'monthly': TruncMonth}.get(grain, TruncDay)

        start_dt = timezone.make_aware(datetime.combine(start_date, datetime.min.time()))
        end_dt = timezone.make_aware(datetime.combine(end_date, datetime.max.time()))
        period_days = max((end_date - start_date).days + 1, 1)
        prev_end = start_date - timedelta(days=1)
        prev_start = prev_end - timedelta(days=period_days - 1)
        prev_start_dt = timezone.make_aware(datetime.combine(prev_start, datetime.min.time()))
        prev_end_dt = timezone.make_aware(datetime.combine(prev_end, datetime.max.time()))

        paid_orders = Order.objects.filter(payment_status='PAID', created_at__range=(start_dt, end_dt))
        paid_pos_orders = paid_orders.filter(order_type='WALK_IN')
        paid_booking_orders = paid_orders.filter(order_type='BOOKING_LINKED', booking__status='COMPLETED')
        prev_paid_orders = Order.objects.filter(payment_status='PAID', created_at__range=(prev_start_dt, prev_end_dt))

        pos_rev = paid_pos_orders.aggregate(total=Sum('total'))['total'] or 0
        booking_rev = paid_booking_orders.aggregate(total=Sum('total'))['total'] or 0
        total_rev = money(pos_rev) + money(booking_rev)
        prev_total_rev = prev_paid_orders.aggregate(total=Sum('total'))['total'] or 0
        total_tx = paid_pos_orders.count()
        total_items_sold = OrderItem.objects.filter(order__in=paid_pos_orders).aggregate(total=Sum('quantity'))['total'] or 0
        avg_transaction = money(pos_rev) / total_tx if total_tx else 0

        bookings_in_range = Booking.objects.filter(created_at__range=(start_dt, end_dt))
        booking_status_counts = {
            'pending': bookings_in_range.filter(status='PENDING').count(),
            'confirmed': bookings_in_range.filter(status__in=['CONFIRMED', 'CONFIRMED_DP']).count(),
            'confirmed_dp': bookings_in_range.filter(status='CONFIRMED_DP').count(),
            'completed': bookings_in_range.filter(status='COMPLETED').count(),
            'cancelled': bookings_in_range.filter(status='CANCELLED').count(),
        }

        buckets = {}
        for row in paid_orders.annotate(bucket=trunc_fn('created_at')).values('bucket', 'order_type').annotate(total=Sum('total')).order_by('bucket'):
            key = row['bucket'].date().strftime('%Y-%m-%d')
            buckets.setdefault(key, {'date': key, 'pos_revenue': 0, 'booking_revenue': 0, 'total_revenue': 0})
            if row['order_type'] == 'BOOKING_LINKED':
                buckets[key]['booking_revenue'] += money(row['total'])
            else:
                buckets[key]['pos_revenue'] += money(row['total'])
            buckets[key]['total_revenue'] = buckets[key]['pos_revenue'] + buckets[key]['booking_revenue']
        chart_data = list(buckets.values())

        inventory_status_counts = {
            'IN_STOCK': 0,
            'LOW_STOCK': 0,
            'NEAR_EXPIRY': 0,
            'EXPIRED': 0,
            'OVERSTOCKED': 0,
        }
        inventory_alerts = []
        for ingredient in Ingredient.objects.all().select_related('supplier', 'category'):
            status_key = ingredient.inventory_status
            inventory_status_counts[status_key] = inventory_status_counts.get(status_key, 0) + 1
            if status_key != 'IN_STOCK':
                inventory_alerts.append({
                    'id': ingredient.id,
                    'name': ingredient.name,
                    'category': ingredient.category.name if ingredient.category else 'N/A',
                    'supplier_name': ingredient.supplier.name if ingredient.supplier else 'N/A',
                    'stock_quantity': money(ingredient.stock_quantity),
                    'base_unit': ingredient.base_unit,
                    'minimum_stock_level': money(ingredient.minimum_stock_level),
                    'maximum_stock_level': money(ingredient.maximum_stock_level),
                    'expiration_date': ingredient.expiration_date.strftime('%Y-%m-%d') if ingredient.expiration_date else None,
                    'days_until_expiry': ingredient.days_until_expiry,
                    'inventory_status': status_key,
                    'inventory_status_label': ingredient.inventory_status_label,
                    'suggested_action': ingredient.suggested_action,
                })

        priority_order = {'EXPIRED': 0, 'NEAR_EXPIRY': 1, 'LOW_STOCK': 2, 'OVERSTOCKED': 3}
        inventory_alerts.sort(key=lambda row: priority_order.get(row['inventory_status'], 99))

        # 4. Recent bookings list
        recent_bookings = bookings_in_range.select_related('customer', 'package').order_by('-created_at')[:10]
        bookings_list = [{
            'id': b.id,
            'customer_name': b.customer.get_full_name() or b.customer.username,
            'package_name': b.package.name,
            'scheduled_date': b.scheduled_date.strftime('%Y-%m-%d'),
            'scheduled_time': b.scheduled_time.strftime('%H:%M'),
            'status': b.status,
            'amount': money(b.package.price),
            'created_at': timezone.localtime(b.created_at).strftime('%Y-%m-%d %H:%M')
        } for b in recent_bookings]

        recent_orders = paid_pos_orders.select_related('staff').prefetch_related(
            Prefetch('payments', queryset=Payment.objects.order_by('id'), to_attr='prefetched_payments')
        ).order_by('-created_at')[:10]
        orders_list = [{
            'id': order.id,
            'transaction_id': order.transaction_id or f'POS-{order.id}',
            'cashier': order.staff.username if order.staff else 'N/A',
            'date': timezone.localtime(order.created_at).strftime('%Y-%m-%d %H:%M'),
            'total': money(order.total),
            'payment_method': order.prefetched_payments[0].method if order.prefetched_payments else 'N/A',
        } for order in recent_orders]

        top_products = OrderItem.objects.filter(order__in=paid_pos_orders).values('product__name').annotate(
            quantity_sold=Sum('quantity'),
            revenue=Sum('subtotal')
        ).order_by('-quantity_sold')[:8]
        top_packages = bookings_in_range.values('package__name').annotate(
            total_bookings=Count('id'),
            revenue=Sum('package__price')
        ).order_by('-total_bookings')[:8]

        return Response({
            'metrics': {
                'total_revenue': money(total_rev),
                'total_revenue_change': pct_change(total_rev, prev_total_rev),
                'pos_revenue': money(pos_rev),
                'booking_revenue': money(booking_rev),
                'transaction_count': total_tx,
                'avg_transaction_value': money(avg_transaction),
                'total_items_sold': total_items_sold,
                'total_bookings': bookings_in_range.count(),
                'completed_bookings': booking_status_counts['completed'],
                **booking_status_counts,
            },
            'sales_history_chart': chart_data,
            'low_stock_alerts': [row for row in inventory_alerts if row['inventory_status'] == 'LOW_STOCK'],
            'inventory_status_counts': inventory_status_counts,
            'inventory_alerts': inventory_alerts[:8],
            'recent_bookings': bookings_list,
            'recent_pos_transactions': orders_list,
            'top_selling_products': [
                {'product': p['product__name'], 'quantity_sold': p['quantity_sold'] or 0, 'revenue': money(p['revenue'])}
                for p in top_products
            ],
            'top_booked_packages': [
                {'package': p['package__name'], 'total_bookings': p['total_bookings'] or 0, 'revenue': money(p['revenue'])}
                for p in top_packages
            ],
            'range': {'start': start_date.strftime('%Y-%m-%d'), 'end': end_date.strftime('%Y-%m-%d'), 'grain': grain}
        })
