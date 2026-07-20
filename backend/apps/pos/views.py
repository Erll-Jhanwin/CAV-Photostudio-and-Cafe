from rest_framework import generics, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db import transaction, close_old_connections
from django.db.models import Sum, Count, Min, Q
from django.utils import timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import datetime
from threading import Thread
from pos.models import Order, OrderItem, Payment, EndOfDayReport, TransactionSequence
from pos.serializers import OrderSerializer, EndOfDayReportSerializer
from pos.receipt_printing import print_receipt, print_end_of_day_report
from booking.models import Booking, BookingPayment
from inventory.models import Product, StockMovement, Ingredient, IngredientStockMovement, RecipeIngredient
from sales.models import DailySalesSummary
from audit.models import AuditLog

def apply_limit(queryset, request, default=50, maximum=200):
    raw_limit = request.query_params.get('limit')
    if raw_limit is None:
        return queryset[:default]
    try:
        limit = min(max(int(raw_limit), 1), maximum)
    except (TypeError, ValueError):
        return queryset[:default]
    return queryset[:limit]

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

def validate_payment_method(method):
    allowed_methods = {choice[0] for choice in Payment.METHOD_CHOICES}
    if method not in allowed_methods:
        return Response({"detail": "Payment method must be CASH or GCASH."}, status=status.HTTP_400_BAD_REQUEST)
    return None

def money(value):
    try:
        return Decimal(str(value or '0')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Enter a valid amount.")

def calculate_discount(subtotal, discount_data):
    discount_data = discount_data or {}
    if not isinstance(discount_data, dict):
        return None, Response({"discount": "Discount must be an object."}, status=status.HTTP_400_BAD_REQUEST)
    discount_type = str(discount_data.get('type') or 'FIXED').upper()
    if discount_type not in {'FIXED', 'PERCENT'}:
        return None, Response({"discount": "Discount type must be FIXED or PERCENT."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        discount_value = money(discount_data.get('value') or '0')
    except Exception:
        return None, Response({"discount": "Enter a valid discount value."}, status=status.HTTP_400_BAD_REQUEST)

    if discount_value < 0:
        return None, Response({"discount": "Discount cannot be negative."}, status=status.HTTP_400_BAD_REQUEST)

    if discount_type == 'PERCENT':
        if discount_value > 100:
            return None, Response({"discount": "Percentage discount cannot exceed 100%."}, status=status.HTTP_400_BAD_REQUEST)
        discount_amount = (subtotal * discount_value / Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    else:
        if discount_value > subtotal:
            return None, Response({"discount": "Fixed discount cannot exceed the cart subtotal."}, status=status.HTTP_400_BAD_REQUEST)
        discount_amount = discount_value

    total = max(subtotal - discount_amount, Decimal('0.00'))
    return {
        "type": discount_type,
        "value": discount_value,
        "amount": discount_amount,
        "total": total,
    }, None

def generate_transaction_id(sequence_date, sequence_number):
    return f"TXN-{sequence_date.strftime('%Y%m%d')}-{sequence_number:06d}"

def assign_order_transaction_id(order, completed_at=None):
    if order.transaction_id:
        return order.transaction_id

    completed_at = completed_at or timezone.now()
    sequence_date = timezone.localtime(completed_at).date()
    sequence, _ = TransactionSequence.objects.select_for_update().get_or_create(
        sequence_date=sequence_date,
        defaults={'next_number': 1},
    )
    transaction_id = generate_transaction_id(sequence_date, sequence.next_number)
    sequence.next_number += 1
    sequence.save(update_fields=['next_number'])

    order.transaction_id = transaction_id
    order.completed_at = completed_at
    order.save(update_fields=['transaction_id', 'completed_at'])
    return transaction_id

def run_async_db_task(task):
    def runner():
        close_old_connections()
        try:
            task()
        finally:
            close_old_connections()

    Thread(target=runner, daemon=True).start()

def build_receipt_payload(order, order_items, payment, staff_username, amount_received=None):
    paid_amount = amount_received if amount_received is not None else (payment.amount if payment else order.total)
    change_amount = max(Decimal(str(paid_amount)) - order.total, Decimal('0.00'))
    created_at_display = timezone.localtime(order.created_at).strftime("%Y-%m-%d %I:%M %p")
    transaction_number = order.transaction_id or f"POS-{order.id}"
    return {
        "id": order.id,
        "or_number": order.id,
        "transaction_id": order.transaction_id,
        "transaction_number": transaction_number,
        "business_logo_text": "CAV",
        "business_name": "CAV PHOTO STUDIO & CAFE",
        "business_address": "028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas",
        "business_contact_number": "+639171234567",
        "staff": order.staff_id,
        "staff_name": staff_username,
        "booking": order.booking_id,
        "booking_customer_name": "",
        "subtotal": str(order.subtotal or order.total),
        "total": str(order.total),
        "discount_type": order.discount_type,
        "discount_value": str(order.discount_value),
        "discounts": str(order.discount_amount),
        "amount_received": str(paid_amount),
        "change_amount": str(change_amount),
        "payment_status": order.payment_status,
        "order_type": order.order_type,
        "completed_at": order.completed_at.isoformat() if order.completed_at else None,
        "created_at": order.created_at.isoformat(),
        "created_at_display": created_at_display,
        "items": [
            {
                "id": item.id,
                "product": item.product_id,
                "quantity": item.quantity,
                "price": str(item.price),
                "subtotal": str(item.subtotal),
                "product_details": {
                    "id": item.product.id,
                    "name": item.product.name,
                    "price": str(item.product.price),
                    "image_url": item.product.image_url,
                },
            }
            for item in order_items
        ],
        "payments": [
            {
                "id": payment.id,
                "amount": str(payment.amount),
                "method": payment.method,
                "transaction_id": payment.transaction_id,
                "timestamp": payment.timestamp.isoformat(),
            }
        ] if payment else [],
    }

def decimal_sum(value):
    return value or Decimal('0.00')

def report_time_display(value):
    if not value:
        return ""
    return timezone.localtime(value).strftime("%I:%M %p")

def build_end_of_day_payload(report):
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(report.report_date, datetime.min.time()), tz)
    end = timezone.make_aware(datetime.combine(report.report_date, datetime.max.time()), tz)
    transaction_ids = list(
        Order.objects
        .filter(payment_status='PAID', created_at__range=(start, end), transaction_id__isnull=False)
        .exclude(transaction_id='')
        .order_by('completed_at', 'id')
        .values_list('transaction_id', flat=True)
    )
    return {
        "id": report.id,
        "report_date": report.report_date.isoformat(),
        "opening_time": report.opening_time.isoformat() if report.opening_time else None,
        "opening_time_display": report_time_display(report.opening_time),
        "closing_time": report.closing_time.isoformat(),
        "closing_time_display": report_time_display(report.closing_time),
        "staff_name": report.staff_name,
        "total_transactions": report.total_transactions,
        "gross_sales": str(report.gross_sales),
        "discounts": str(report.discounts),
        "refunds": str(report.refunds),
        "opening_cash": str(report.opening_cash),
        "cash_sales": str(report.cash_sales),
        "gcash_sales": str(report.gcash_sales),
        "card_sales": str(report.card_sales),
        "other_payment_sales": str(report.other_payment_sales),
        "booking_income": str(report.booking_income),
        "cafe_pos_income": str(report.cafe_pos_income),
        "total_items_sold": report.total_items_sold,
        "best_selling_items": report.best_selling_items,
        "cancelled_or_voided_transactions": report.cancelled_or_voided_transactions,
        "first_transaction_id": transaction_ids[0] if transaction_ids else "",
        "last_transaction_id": transaction_ids[-1] if transaction_ids else "",
        "cash_in_out": str(report.cash_in_out),
        "expected_cash": str(report.expected_cash),
        "actual_cash": str(report.actual_cash),
        "cash_difference": str(report.cash_difference),
    }

def create_end_of_day_report(user, report_date, actual_cash, opening_cash=Decimal('0.00'), cash_in_out=Decimal('0.00')):
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(report_date, datetime.min.time()), tz)
    end = timezone.make_aware(datetime.combine(report_date, datetime.max.time()), tz)

    paid_orders = Order.objects.filter(payment_status='PAID', created_at__range=(start, end))
    payments = Payment.objects.filter(order__payment_status='PAID', order__created_at__range=(start, end)).select_related('order')
    booking_payments = BookingPayment.objects.filter(status='APPROVED', paid_at__range=(start, end))

    first_pos_time = paid_orders.aggregate(value=Min('created_at'))['value']
    first_booking_time = booking_payments.aggregate(value=Min('paid_at'))['value']
    opening_time = min([value for value in [first_pos_time, first_booking_time] if value], default=None)
    closing_time = timezone.now()

    discounts = decimal_sum(paid_orders.aggregate(value=Sum('discount_amount'))['value'])
    subtotal_sales = decimal_sum(paid_orders.aggregate(value=Sum('subtotal'))['value'])
    cash_sales = decimal_sum(payments.filter(method='CASH').aggregate(value=Sum('order__total'))['value'])
    gcash_pos_sales = decimal_sum(payments.filter(method='GCASH').aggregate(value=Sum('order__total'))['value'])
    card_sales = decimal_sum(payments.filter(method='CARD').aggregate(value=Sum('order__total'))['value'])
    booking_payment_income = decimal_sum(booking_payments.aggregate(value=Sum('amount'))['value'])
    gcash_sales = gcash_pos_sales + booking_payment_income
    other_pos_sales = gcash_pos_sales + card_sales
    booking_linked_income = decimal_sum(paid_orders.filter(order_type='BOOKING_LINKED').aggregate(value=Sum('total'))['value'])
    cafe_pos_income = decimal_sum(paid_orders.filter(order_type='WALK_IN').aggregate(value=Sum('total'))['value'])
    booking_income = booking_linked_income + booking_payment_income
    gross_sales = subtotal_sales + booking_payment_income
    total_transactions = paid_orders.count() + booking_payments.count()
    total_items_sold = OrderItem.objects.filter(order__in=paid_orders).aggregate(value=Sum('quantity'))['value'] or 0
    cancelled_count = Order.objects.filter(created_at__range=(start, end), payment_status='CANCELLED').count()

    best_items = list(
        OrderItem.objects
        .filter(order__in=paid_orders)
        .values('product__name')
        .annotate(quantity=Sum('quantity'), total=Sum('subtotal'))
        .order_by('-quantity', '-total')[:5]
    )
    best_items = [
        {
            "name": item['product__name'] or 'Item',
            "quantity": item['quantity'] or 0,
            "total": str(item['total'] or Decimal('0.00')),
        }
        for item in best_items
    ]

    actual_cash = Decimal(str(actual_cash or '0'))
    opening_cash = Decimal(str(opening_cash or '0'))
    cash_in_out = Decimal(str(cash_in_out or '0'))
    expected_cash = opening_cash + cash_sales + cash_in_out
    cash_difference = actual_cash - expected_cash
    staff_name = user.get_full_name() or user.username

    return EndOfDayReport.objects.create(
        report_date=report_date,
        opening_time=opening_time,
        closing_time=closing_time,
        closed_by=user,
        staff_name=staff_name,
        total_transactions=total_transactions,
        gross_sales=gross_sales,
        discounts=discounts,
        refunds=Decimal('0.00'),
        opening_cash=opening_cash,
        cash_sales=cash_sales,
        gcash_sales=gcash_sales,
        card_sales=card_sales,
        other_payment_sales=gcash_sales + card_sales,
        booking_income=booking_income,
        cafe_pos_income=cafe_pos_income,
        total_items_sold=total_items_sold,
        best_selling_items=best_items,
        cancelled_or_voided_transactions=cancelled_count,
        cash_in_out=cash_in_out,
        expected_cash=expected_cash,
        actual_cash=actual_cash,
        cash_difference=cash_difference,
    )

class OrderListCreateView(generics.ListCreateAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Staff and Admins can see all orders
        user = self.request.user
        if user.role in ['STAFF', 'ADMIN']:
            queryset = Order.objects.all().select_related('staff', 'booking__customer').prefetch_related('items', 'payments', 'items__product').order_by('-created_at')
            return apply_limit(queryset, self.request)
        # Customers can only see orders linked to their own bookings
        queryset = Order.objects.filter(booking__customer=user).select_related('staff', 'booking__customer').prefetch_related('items', 'payments', 'items__product').order_by('-created_at')
        return apply_limit(queryset, self.request)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff members can process POS orders."}, status=status.HTTP_403_FORBIDDEN)

        items_data = request.data.get('items', [])
        payment_data = request.data.get('payment')  # Optional immediate payment details
        discount_data = request.data.get('discount') or {}
        booking_id = request.data.get('booking_id')
        order_type = request.data.get('order_type', 'WALK_IN')

        if not items_data:
            return Response({"detail": "Cart is empty."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(items_data, list):
            return Response({"detail": "Cart items must be a list."}, status=status.HTTP_400_BAD_REQUEST)
        if order_type not in {'WALK_IN', 'BOOKING_LINKED'}:
            return Response({"order_type": "Order type must be WALK_IN or BOOKING_LINKED."}, status=status.HTTP_400_BAD_REQUEST)
        if order_type == 'BOOKING_LINKED':
            if not booking_id:
                return Response({"booking_id": "Booking is required for linked orders."}, status=status.HTTP_400_BAD_REQUEST)
            if not Booking.objects.filter(id=booking_id).exists():
                return Response({"booking_id": "Booking not found."}, status=status.HTTP_404_NOT_FOUND)
        else:
            booking_id = None

        item_quantities = {}
        for item in items_data:
            if not isinstance(item, dict):
                return Response({"detail": "Invalid cart item."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                product_id = int(item.get('product_id'))
                qty = int(item.get('quantity', 1))
            except (TypeError, ValueError):
                return Response({"detail": "Invalid cart item."}, status=status.HTTP_400_BAD_REQUEST)
            if qty <= 0:
                return Response({"detail": "Item quantity must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
            item_quantities[product_id] = item_quantities.get(product_id, 0) + qty

        payment = None
        created_order_items = []

        with transaction.atomic():
            products = list(Product.objects.select_for_update().select_related('category').filter(id__in=item_quantities.keys(), is_active=True))
            products_by_id = {product.id: product for product in products}
            missing_ids = set(item_quantities.keys()) - set(products_by_id.keys())
            if missing_ids:
                return Response({"detail": f"Product with ID {next(iter(missing_ids))} not found."}, status=status.HTTP_404_NOT_FOUND)

            recipe_items = list(
                RecipeIngredient.objects.select_for_update()
                .select_related('ingredient')
                .filter(product_id__in=item_quantities.keys())
            )
            recipe_items_by_product = {}
            for recipe_item in recipe_items:
                recipe_items_by_product.setdefault(recipe_item.product_id, []).append(recipe_item)

            total_amount = Decimal('0.00')
            ingredient_requirements = {}
            ingredients_by_id = {}
            finished_stock_movements = []
            ingredient_movements = []
            order_item_specs = []

            for product_id, qty in item_quantities.items():
                product = products_by_id[product_id]
                product_recipe_items = recipe_items_by_product.get(product_id, [])
                category_name = product.category.name.lower() if product.category else ""
                requires_recipe = product.is_cafe_item and category_name != "snacks"
                if requires_recipe and not product_recipe_items:
                    return Response({"detail": f"{product.name} has no ingredient recipe configured."}, status=status.HTTP_400_BAD_REQUEST)

                if product_recipe_items:
                    for recipe_item in product_recipe_items:
                        required_quantity = recipe_item.quantity * qty
                        ingredient_requirements[recipe_item.ingredient_id] = ingredient_requirements.get(recipe_item.ingredient_id, Decimal('0')) + required_quantity
                        ingredients_by_id[recipe_item.ingredient_id] = recipe_item.ingredient
                else:
                    if product.stock_level < qty:
                        return Response({"detail": f"Insufficient stock for {product.name}. Current stock: {product.stock_level}"}, status=status.HTTP_400_BAD_REQUEST)

                    product.stock_level -= qty

                price = product.price
                subtotal = price * qty
                total_amount += subtotal
                order_item_specs.append((product, qty, price, subtotal))

            if ingredient_requirements:
                for ingredient_id, required_quantity in ingredient_requirements.items():
                    ingredient = ingredients_by_id[ingredient_id]
                    if ingredient.stock_quantity < required_quantity:
                        return Response({
                            "detail": f"Insufficient {ingredient.name}. Required: {required_quantity} {ingredient.get_base_unit_display()}, available: {ingredient.stock_quantity} {ingredient.get_base_unit_display()}."
                        }, status=status.HTTP_400_BAD_REQUEST)

            subtotal_amount = money(total_amount)
            discount, discount_error = calculate_discount(subtotal_amount, discount_data)
            if discount_error:
                return discount_error
            final_total = discount["total"]

            amount_paid = None
            method = None
            tx_id = ''
            if payment_data:
                if not isinstance(payment_data, dict):
                    return Response({"payment": "Payment must be an object."}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    amount_paid = money(payment_data.get('amount', final_total))
                except ValueError as exc:
                    return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                if amount_paid < 0:
                    return Response({"amount": "Payment amount cannot be negative."}, status=status.HTTP_400_BAD_REQUEST)
                method = payment_data.get('method', 'CASH')
                method_error = validate_payment_method(method)
                if method_error:
                    return method_error
                tx_id = str(payment_data.get('transaction_id', '') or '').strip()[:100]

            payment_status_value = 'PAID' if amount_paid is not None and amount_paid >= final_total else 'PENDING'
            order = Order.objects.create(
                staff=request.user,
                booking_id=booking_id,
                subtotal=subtotal_amount,
                discount_type=discount["type"],
                discount_value=discount["value"],
                discount_amount=discount["amount"],
                total=final_total,
                order_type=order_type,
                payment_status=payment_status_value
            )

            created_order_items = [
                OrderItem(order=order, product=product, quantity=qty, price=price, subtotal=subtotal)
                for product, qty, price, subtotal in order_item_specs
            ]

            for product_id, qty in item_quantities.items():
                product = products_by_id[product_id]
                if not recipe_items_by_product.get(product_id):
                    finished_stock_movements.append(StockMovement(
                        product_id=product.id,
                        movement_type='OUT',
                        quantity=qty,
                        reason=f"POS Transaction Order #{order.id}",
                        user_id=request.user.id
                    ))

            if ingredient_requirements:
                for ingredient_id, required_quantity in ingredient_requirements.items():
                    ingredient = ingredients_by_id[ingredient_id]
                    ingredient.stock_quantity -= required_quantity
                    ingredient_movements.append(IngredientStockMovement(
                        ingredient_id=ingredient.id,
                        movement_type='OUT',
                        quantity=required_quantity,
                        input_quantity=required_quantity,
                        input_unit=ingredient.base_unit,
                        reason=f"POS drink recipe Order #{order.id}",
                        user_id=request.user.id
                    ))
                Ingredient.objects.bulk_update(ingredients_by_id.values(), ['stock_quantity'])

            stock_products = [product for product in products if product.id in item_quantities and not recipe_items_by_product.get(product.id)]
            if stock_products:
                Product.objects.bulk_update(stock_products, ['stock_level'])

            OrderItem.objects.bulk_create(created_order_items)

            # 3. Process immediate payment if provided
            if amount_paid is not None:
                payment = Payment.objects.create(
                    order=order,
                    amount=amount_paid,
                    method=method,
                    transaction_id=tx_id
                )
                if payment.amount >= order.total:
                    assign_order_transaction_id(order)

            user_id = request.user.id
            order_id = order.id
            order_transaction_id = order.transaction_id
            order_total = order.total
            order_status = order.payment_status
            should_record_sales = payment is not None and payment.amount >= order.total
            transaction.on_commit(lambda: run_async_db_task(lambda: (
                add_to_daily_sales(order_total, is_booking=(order_type == 'BOOKING_LINKED')) if should_record_sales else None,
                IngredientStockMovement.objects.bulk_create(ingredient_movements) if ingredient_movements else None,
                StockMovement.objects.bulk_create(finished_stock_movements) if finished_stock_movements else None,
                AuditLog.objects.create(
                    user_id=user_id,
                    action="POS_ORDER",
                    description=f"Processed POS transaction {order_transaction_id or '#' + str(order_id)} for PHP {order_total} (Status: {order_status})."
                )
            )))

        receipt_payload = build_receipt_payload(order, created_order_items, payment, request.user.username, amount_paid)
        receipt_payload["receipt_print"] = print_receipt(receipt_payload) if receipt_payload["payment_status"] == "PAID" else {
            "printed": False,
            "printer": None,
            "error": "Receipt was not printed because the order is not fully paid.",
        }
        return Response(receipt_payload, status=status.HTTP_201_CREATED)

class OrderDetailView(generics.RetrieveAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Order.objects.select_related('staff', 'booking__customer').prefetch_related('items', 'payments', 'items__product')
        if self.request.user.role in ['STAFF', 'ADMIN']:
            return queryset
        return queryset.filter(booking__customer=self.request.user)

class PaymentCreateView(generics.CreateAPIView):
    queryset = Payment.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
            
        order_id = request.data.get('order')
        try:
            amount = money(request.data.get('amount'))
        except ValueError as exc:
            return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if amount <= 0:
            return Response({"amount": "Payment amount must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
        method = request.data.get('method', 'CASH')
        method_error = validate_payment_method(method)
        if method_error:
            return method_error
        tx_id = str(request.data.get('transaction_id', '') or '').strip()[:100]

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
            total_paid = order.payments.aggregate(value=Sum('amount'))['value'] or Decimal('0.00')
            if total_paid >= order.total:
                if order.payment_status != 'PAID':
                    order.payment_status = 'PAID'
                    order.save(update_fields=['payment_status'])
                    assign_order_transaction_id(order)
                    add_to_daily_sales(order.total, is_booking=(order.order_type == 'BOOKING_LINKED'))
                elif not order.transaction_id:
                    assign_order_transaction_id(order)

            AuditLog.objects.create(
                user=request.user,
                action="POS_PAYMENT",
                description=f"Received payment of PHP {amount} for {order.transaction_id or 'Order #' + str(order.id)} via {method}."
            )

        return Response({"message": "Payment logged successfully.", "transaction_id": order.transaction_id})


class EndOfDayReportListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        reports = EndOfDayReport.objects.select_related('closed_by').all()[:100]
        return Response(EndOfDayReportSerializer(reports, many=True).data)

    def post(self, request):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)

        actual_cash_raw = request.data.get('actual_cash')
        if actual_cash_raw in (None, ''):
            return Response({"actual_cash": "Actual cash is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            actual_cash = Decimal(str(actual_cash_raw))
        except Exception:
            return Response({"actual_cash": "Enter a valid cash amount."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            opening_cash = Decimal(str(request.data.get('opening_cash') or '0'))
            cash_in_out = Decimal(str(request.data.get('cash_in_out') or '0'))
        except Exception:
            return Response({"detail": "Opening cash and cash in/out must be valid amounts."}, status=status.HTTP_400_BAD_REQUEST)

        report_date_raw = request.data.get('report_date') or timezone.localdate().isoformat()
        try:
            report_date = datetime.strptime(report_date_raw, "%Y-%m-%d").date()
        except ValueError:
            return Response({"report_date": "Use YYYY-MM-DD format."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            report = create_end_of_day_report(request.user, report_date, actual_cash, opening_cash, cash_in_out)
            print_status = print_end_of_day_report(build_end_of_day_payload(report))
            report.print_status = print_status
            report.printed_at = timezone.now() if print_status.get("printed") else None
            report.save(update_fields=['print_status', 'printed_at'])

        data = EndOfDayReportSerializer(report).data
        data['receipt_print'] = print_status
        return Response(data, status=status.HTTP_201_CREATED)


class EndOfDayReportReprintView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        try:
            report = EndOfDayReport.objects.get(pk=pk)
        except EndOfDayReport.DoesNotExist:
            return Response({"detail": "Report not found."}, status=status.HTTP_404_NOT_FOUND)

        print_status = print_end_of_day_report(build_end_of_day_payload(report))
        report.print_status = print_status
        report.printed_at = timezone.now() if print_status.get("printed") else report.printed_at
        report.save(update_fields=['print_status', 'printed_at'])
        data = EndOfDayReportSerializer(report).data
        data['receipt_print'] = print_status
        return Response(data)
