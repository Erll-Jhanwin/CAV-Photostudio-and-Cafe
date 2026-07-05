from rest_framework import generics, permissions, status
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from pos.models import Order, OrderItem, Payment
from pos.serializers import OrderSerializer
from inventory.models import Product, StockMovement
from sales.models import DailySalesSummary
from audit.models import AuditLog

def add_to_daily_sales(amount, is_booking=False):
    today = timezone.now().date()
    summary, _ = DailySalesSummary.objects.get_or_create(date=today)
    val = float(amount)
    if is_booking:
        summary.booking_revenue = float(summary.booking_revenue) + val
    else:
        summary.pos_revenue = float(summary.pos_revenue) + val
    summary.total_revenue = float(summary.pos_revenue) + float(summary.booking_revenue)
    summary.transaction_count += 1
    summary.save()

class OrderListCreateView(generics.ListCreateAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Staff and Admins can see all orders
        user = self.request.user
        if user.role in ['STAFF', 'ADMIN']:
            return Order.objects.all().prefetch_related('items', 'payments', 'items__product').order_by('-created_at')
        # Customers can only see orders linked to their own bookings
        return Order.objects.filter(booking__customer=user).prefetch_related('items', 'payments', 'items__product').order_by('-created_at')

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff members can process POS orders."}, status=status.HTTP_403_FORBIDDEN)

        items_data = request.data.get('items', [])
        payment_data = request.data.get('payment')  # Optional immediate payment details
        booking_id = request.data.get('booking_id')
        order_type = request.data.get('order_type', 'WALK_IN')

        if not items_data:
            return Response({"detail": "Cart is empty."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # 1. Create base Order
            order = Order.objects.create(
                staff=request.user,
                booking_id=booking_id,
                order_type=order_type,
                payment_status='PENDING'
            )

            total_amount = 0.00

            # 2. Iterate through items, validate stock, calculate subtotal and deplete stock
            for item in items_data:
                product_id = item.get('product_id')
                qty = int(item.get('quantity', 1))

                try:
                    product = Product.objects.select_for_update().get(id=product_id)
                except Product.DoesNotExist:
                    return Response({"detail": f"Product with ID {product_id} not found."}, status=status.HTTP_404_NOT_FOUND)

                # Check stock levels (only for items that require inventory stock, e.g., not infinite virtual items)
                if product.stock_level < qty:
                    return Response({"detail": f"Insufficient stock for {product.name}. Current stock: {product.stock_level}"}, status=status.HTTP_400_BAD_REQUEST)

                # Deplete stock
                product.stock_level -= qty
                product.save()

                # Log Stock Out Movement
                StockMovement.objects.create(
                    product=product,
                    movement_type='OUT',
                    quantity=qty,
                    reason=f"POS Transaction Order #{order.id}",
                    user=request.user
                )

                price = float(product.price)
                subtotal = price * qty
                total_amount += subtotal

                OrderItem.objects.create(
                    order=order,
                    product=product,
                    quantity=qty,
                    price=price,
                    subtotal=subtotal
                )

            order.total = total_amount
            order.save()

            # 3. Process immediate payment if provided
            if payment_data:
                amount_paid = float(payment_data.get('amount', total_amount))
                method = payment_data.get('method', 'CASH')
                tx_id = payment_data.get('transaction_id', '')

                Payment.objects.create(
                    order=order,
                    amount=amount_paid,
                    method=method,
                    transaction_id=tx_id
                )

                if amount_paid >= total_amount:
                    order.payment_status = 'PAID'
                    order.save()

                    # Add to daily sales tracking
                    add_to_daily_sales(total_amount, is_booking=(order_type == 'BOOKING_LINKED'))

            # Audit logging
            AuditLog.objects.create(
                user=request.user,
                action="POS_ORDER",
                description=f"Processed POS transaction #{order.id} for PHP {order.total} (Status: {order.payment_status})."
            )

        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)

class OrderDetailView(generics.RetrieveAPIView):
    queryset = Order.objects.all()
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

class PaymentCreateView(generics.CreateAPIView):
    queryset = Payment.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
            
        order_id = request.data.get('order')
        amount = float(request.data.get('amount'))
        method = request.data.get('method', 'CASH')
        tx_id = request.data.get('transaction_id', '')

        try:
            order = Order.objects.get(id=order_id)
        except Order.DoesNotExist:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            payment = Payment.objects.create(
                order=order,
                amount=amount,
                method=method,
                transaction_id=tx_id
            )

            # Recalculate total payments
            total_paid = sum(float(p.amount) for p in order.payments.all())
            if total_paid >= float(order.total):
                if order.payment_status != 'PAID':
                    order.payment_status = 'PAID'
                    order.save()
                    add_to_daily_sales(order.total, is_booking=(order.order_type == 'BOOKING_LINKED'))

            AuditLog.objects.create(
                user=request.user,
                action="POS_PAYMENT",
                description=f"Received payment of PHP {amount} for Order #{order.id} via {method}."
            )

        return Response({"message": "Payment logged successfully."})
