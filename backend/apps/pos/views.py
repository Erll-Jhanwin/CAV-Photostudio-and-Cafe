from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.models import AuditLog
from booking.models import Booking
from payment.models import Payment
from inventory.models import InventoryEvent, Product
from pos.models import Order
from pos.receipt_printing import print_end_of_day_report, print_receipt
from pos.serializers import EndOfDayReportSerializer, OrderSerializer
from users.permissions import IsAdmin, IsStaffOrAdmin


POS_IDEMPOTENCY_KEY_MAX_LENGTH = 100


def apply_limit(queryset, request, default=50, maximum=200):
    raw_limit = request.query_params.get('limit')
    try:
        limit = default if raw_limit is None else min(max(int(raw_limit), 1), maximum)
    except (TypeError, ValueError):
        limit = default
    try:
        offset = min(max(int(request.query_params.get('offset', 0)), 0), 100000)
    except (TypeError, ValueError):
        offset = 0
    return queryset[offset:offset + limit]


def validate_payment_method(method):
    if method not in {'CASH', 'GCASH'}:
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
    return {
        "type": discount_type,
        "value": discount_value,
        "amount": discount_amount,
        "total": max(subtotal - discount_amount, Decimal('0.00')),
    }, None


def generate_transaction_id(sequence_date, sequence_number):
    return f"TXN-{sequence_date.strftime('%Y%m%d')}-{sequence_number:06d}"


def assign_order_transaction_id(order, completed_at=None):
    if order.transaction_id:
        return order.transaction_id
    completed_at = completed_at or timezone.now()
    sequence_date = timezone.localtime(completed_at).date()
    order.transaction_id = generate_transaction_id(sequence_date, order.pk)
    order.completed_at = completed_at
    order.save(update_fields=['transaction_id', 'completed_at'])
    return order.transaction_id


def get_idempotency_key(request):
    value = str(request.data.get('idempotency_key') or '').strip()
    return value[:POS_IDEMPOTENCY_KEY_MAX_LENGTH]


def decimal_sum(value):
    return value or Decimal('0.00')


def item_quantity_total(order):
    return sum(int(item.get('quantity') or 0) for item in order.line_items or [])


def order_revenue_by_payment_method(order, method):
    payments = [payment for payment in order.payments.all() if payment.method == method]
    if not payments:
        return Decimal('0.00')
    all_payments = list(order.payments.all())
    payment_total = sum((payment.amount for payment in all_payments), Decimal('0.00'))
    net_total = max(order.total - order.returned_amount, Decimal('0.00'))
    if payment_total <= 0:
        return Decimal('0.00')
    method_amount = sum((payment.amount for payment in payments), Decimal('0.00'))
    return net_total * method_amount / payment_total


def build_receipt_payload(order, payment, staff_username, amount_received=None):
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
        "items": order.line_items or [],
        "payments": [{
            "id": payment.id,
            "amount": str(payment.amount),
            "method": payment.method,
            "transaction_id": payment.transaction_id,
            "timestamp": payment.timestamp.isoformat(),
        }] if payment else [],
    }


class OrderListCreateView(generics.ListCreateAPIView):
    serializer_class = OrderSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        user = self.request.user
        queryset = Order.objects.exclude(order_type='END_OF_DAY_REPORT').select_related('staff', 'booking__customer').prefetch_related('payments')
        if user.role in ['STAFF', 'ADMIN']:
            return apply_limit(queryset.order_by('-created_at'), self.request)
        return apply_limit(queryset.filter(booking__customer=user).order_by('-created_at'), self.request)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff members can process POS orders."}, status=status.HTTP_403_FORBIDDEN)

        idempotency_key = get_idempotency_key(request)
        if idempotency_key:
            existing_order = Order.objects.filter(
                staff=request.user,
                idempotency_key=idempotency_key,
            ).prefetch_related('payments').first()
            if existing_order:
                payment = existing_order.payments.order_by('-created_at', '-id').first()
                payload = build_receipt_payload(existing_order, payment, request.user.username)
                payload['receipt_print'] = {
                    'printed': False,
                    'printer': None,
                    'error': 'Receipt printing was skipped for this duplicate request.',
                }
                return Response(payload, status=status.HTTP_200_OK)

        items_data = request.data.get('items', [])
        payment_data = request.data.get('payment')
        discount_data = request.data.get('discount') or {}
        booking_id = request.data.get('booking_id')
        order_type = request.data.get('order_type', 'WALK_IN')
        should_print_receipt = str(request.data.get('print_receipt', '')).strip().lower() in {'1', 'true', 'yes', 'on'}

        if not items_data or not isinstance(items_data, list):
            return Response({"detail": "Cart items must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)
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
            try:
                product_id = int(item.get('product_id'))
                qty = int(item.get('quantity', 1))
            except (AttributeError, TypeError, ValueError):
                return Response({"detail": "Invalid cart item."}, status=status.HTTP_400_BAD_REQUEST)
            if qty <= 0:
                return Response({"detail": "Item quantity must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
            item_quantities[product_id] = item_quantities.get(product_id, 0) + qty

        with transaction.atomic():
            products = list(Product.objects.select_for_update().filter(id__in=item_quantities.keys(), item_type=Product.PRODUCT, is_active=True))
            products_by_id = {product.id: product for product in products}
            missing_ids = set(item_quantities.keys()) - set(products_by_id.keys())
            if missing_ids:
                return Response({"detail": f"Product with ID {next(iter(missing_ids))} not found."}, status=status.HTTP_404_NOT_FOUND)

            ingredient_requirements = defaultdict(Decimal)
            ingredient_ids = set()
            for product in products:
                for recipe_item in product.recipe_data or []:
                    ingredient_id = recipe_item.get('ingredient')
                    if ingredient_id:
                        ingredient_ids.add(int(ingredient_id))
            ingredients = Product.objects.select_for_update().filter(id__in=ingredient_ids, item_type=Product.INGREDIENT)
            ingredients_by_id = {ingredient.id: ingredient for ingredient in ingredients}

            total_amount = Decimal('0.00')
            order_items = []
            product_movements = []
            ingredient_movements = []
            for product_id, qty in item_quantities.items():
                product = products_by_id[product_id]
                recipe_items = product.recipe_data or []
                beginning_stock = product.stock_level
                product_beginning_stock = product.stock_level
                if product.stock_level < qty:
                    return Response({"detail": f"Insufficient stock for {product.name}. Current stock: {product.stock_level}"}, status=status.HTTP_400_BAD_REQUEST)
                product.stock_level -= qty
                product_movements.append((product, qty))
                if recipe_items:
                    for recipe_item in recipe_items:
                        ingredient_id = int(recipe_item.get('ingredient'))
                        required_quantity = Decimal(str(recipe_item.get('quantity') or '0')) * qty
                        ingredient_requirements[ingredient_id] += required_quantity

                price = product.price
                subtotal = price * qty
                total_amount += subtotal
                if recipe_items:
                    ingredient_serving_counts = []
                    for recipe_item in recipe_items:
                        ingredient = ingredients_by_id.get(int(recipe_item.get('ingredient') or 0))
                        recipe_quantity = Decimal(str(recipe_item.get('quantity') or '0'))
                        if ingredient and recipe_quantity > 0:
                            ingredient_serving_counts.append(int(ingredient.stock_quantity // recipe_quantity))
                    beginning_stock = min(ingredient_serving_counts) if ingredient_serving_counts else 0
                line_discount_data = item.get('discount') or {}
                line_discount, line_discount_error = calculate_discount(subtotal, line_discount_data)
                if line_discount_error:
                    return Response({'items': f"{product.name}: {line_discount_error.data.get('discount', 'Invalid item discount.')}"}, status=status.HTTP_400_BAD_REQUEST)
                order_items.append({
                    "id": len(order_items) + 1,
                    "product": product.id,
                    "quantity": qty,
                    "price": str(price),
                    "subtotal": str(subtotal),
                    "discount_type": line_discount['type'],
                    "discount_value": str(line_discount['value']),
                    "discount_amount": str(line_discount['amount']),
                    "net_subtotal": str(line_discount['total']),
                    "returned_quantity": 0,
                    "wasted_quantity": 0,
                    "cost": str(product.cost),
                    "beginning_stock": beginning_stock,
                    "inventory_beginning_stock": product_beginning_stock,
                    "recipe": [dict(row) for row in recipe_items],
                    "product_details": {
                        "id": product.id,
                        "name": product.name,
                        "price": str(product.price),
                        "image_url": product.image_url,
                    },
                })

            for ingredient_id, required_quantity in ingredient_requirements.items():
                ingredient = ingredients_by_id.get(ingredient_id)
                if not ingredient:
                    return Response({"detail": "Configured ingredient not found."}, status=status.HTTP_400_BAD_REQUEST)
                if ingredient.stock_quantity < required_quantity:
                    return Response({"detail": f"Insufficient {ingredient.name}. Required: {required_quantity} {ingredient.get_base_unit_display()}, available: {ingredient.stock_quantity} {ingredient.get_base_unit_display()}."}, status=status.HTTP_400_BAD_REQUEST)
                ingredient.stock_quantity -= required_quantity
                ingredient_movements.append((ingredient, required_quantity))

            subtotal_amount = money(total_amount)
            item_discount_total = sum((Decimal(row['discount_amount']) for row in order_items), Decimal('0.00'))
            discountable_subtotal = max(subtotal_amount - item_discount_total, Decimal('0.00'))
            discount, discount_error = calculate_discount(discountable_subtotal, discount_data)
            if discount_error:
                return discount_error
            final_total = discount["total"]
            for line in order_items:
                before_order_discount = Decimal(str(line['net_subtotal']))
                global_share = (
                    discount['amount'] * before_order_discount / discountable_subtotal
                    if discountable_subtotal > 0 else Decimal('0.00')
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                line['item_discount_amount'] = line['discount_amount']
                line['order_discount_amount'] = str(global_share)
                line['discount_amount'] = str(Decimal(line['discount_amount']) + global_share)
                line['net_subtotal'] = str(max(before_order_discount - global_share, Decimal('0.00')))

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
                discount_amount=item_discount_total + discount["amount"],
                total=final_total,
                order_type=order_type,
                payment_status=payment_status_value,
                line_items=order_items,
                idempotency_key=idempotency_key or None,
            )

            Product.objects.bulk_update(products, ['stock_level'])
            if ingredients_by_id:
                Product.objects.bulk_update(ingredients_by_id.values(), ['stock_quantity'])
            InventoryEvent.objects.bulk_create([
                InventoryEvent(event_type=InventoryEvent.STOCK_MOVEMENT, product=product, movement_type='OUT', quantity=qty, reason=f"POS Transaction Order #{order.id}", user=request.user)
                for product, qty in product_movements
            ] + [
                InventoryEvent(event_type=InventoryEvent.INGREDIENT_MOVEMENT, product=ingredient, movement_type='OUT', quantity=qty, input_quantity=qty, input_unit=ingredient.base_unit, reason=f"POS drink recipe Order #{order.id}", user=request.user)
                for ingredient, qty in ingredient_movements
            ])

            payment = None
            if amount_paid is not None:
                payment = Payment.objects.create(payment_type=Payment.POS, order=order, amount=amount_paid, method=method, transaction_id=tx_id, status='PAID')
                if payment.amount >= order.total:
                    assign_order_transaction_id(order)

            AuditLog.objects.create(user=request.user, action="POS_ORDER", description=f"Processed POS transaction {order.transaction_id or '#' + str(order.id)} for PHP {order.total} (Status: {order.payment_status}).")

        receipt_payload = build_receipt_payload(order, payment, request.user.username, amount_paid)
        if receipt_payload["payment_status"] == "PAID" and should_print_receipt:
            receipt_payload["receipt_print"] = print_receipt(receipt_payload)
        elif receipt_payload["payment_status"] == "PAID":
            receipt_payload["receipt_print"] = {
                "printed": False,
                "printer": None,
                "error": "Receipt printing was skipped for this synced transaction.",
            }
        else:
            receipt_payload["receipt_print"] = {
                "printed": False,
                "printer": None,
                "error": "Receipt was not printed because the order is not fully paid.",
            }
        return Response(receipt_payload, status=status.HTTP_201_CREATED)


class OrderDetailView(generics.RetrieveAPIView):
    serializer_class = OrderSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = Order.objects.exclude(order_type='END_OF_DAY_REPORT').select_related('staff', 'booking__customer').prefetch_related('payments')
        if self.request.user.role in ['STAFF', 'ADMIN']:
            return queryset
        return queryset.filter(booking__customer=self.request.user)


class OrderReturnView(APIView):
    permission_classes = [IsStaffOrAdmin]

    def post(self, request, pk):
        if request.user.role not in {'STAFF', 'ADMIN'}:
            return Response({'detail': 'Staff access required.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            product_id = int(request.data.get('product_id'))
            quantity = int(request.data.get('quantity', 1))
        except (TypeError, ValueError):
            return Response({'detail': 'Product and whole-number quantity are required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not request.data.get('disposition'):
            return Response({'disposition': 'Choose RESTOCKED or WASTED for each refund.'}, status=status.HTTP_400_BAD_REQUEST)
        disposition = str(request.data.get('disposition')).upper()
        idempotency_key = str(request.data.get('idempotency_key') or '').strip()[:100]
        if disposition not in {'WASTED', 'RESTOCKED'} or quantity <= 0 or not idempotency_key:
            return Response({'detail': 'Use a positive quantity, an idempotency key, and WASTED or RESTOCKED disposition.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            try:
                order = Order.objects.select_for_update().get(pk=pk)
            except Order.DoesNotExist:
                return Response({'detail': 'Transaction not found.'}, status=status.HTTP_404_NOT_FOUND)
            if order.payment_status != 'PAID':
                return Response({'detail': 'Only paid transactions can have returns.'}, status=status.HTTP_409_CONFLICT)
            if idempotency_key and any(event.get('idempotency_key') == idempotency_key for event in (order.return_events or [])):
                return Response(OrderSerializer(order).data)
            items = [dict(row) for row in (order.line_items or [])]
            line = next((row for row in items if int(row.get('product') or 0) == product_id), None)
            if not line:
                return Response({'detail': 'This product is not part of the transaction.'}, status=status.HTTP_404_NOT_FOUND)
            sold_quantity = int(line.get('quantity') or 0)
            returned_quantity = int(line.get('returned_quantity') or 0)
            if quantity > sold_quantity - returned_quantity:
                return Response({'detail': 'Return quantity exceeds the unreturned quantity.'}, status=status.HTTP_400_BAD_REQUEST)

            product = Product.objects.select_for_update().filter(pk=product_id, item_type=Product.PRODUCT).first()
            if not product:
                return Response({'detail': 'The sold product no longer exists in inventory.'}, status=status.HTTP_409_CONFLICT)
            product_stock_before = product.stock_level
            if disposition == 'RESTOCKED':
                recipe = line.get('recipe') or []
                if recipe:
                    recipe_ids = [int(row.get('ingredient')) for row in recipe if row.get('ingredient')]
                    ingredients = list(Product.objects.select_for_update().filter(pk__in=recipe_ids, item_type=Product.INGREDIENT))
                    by_id = {row.pk: row for row in ingredients}
                    for recipe_row in recipe:
                        ingredient = by_id.get(int(recipe_row.get('ingredient') or 0))
                        if ingredient:
                            ingredient.stock_quantity += Decimal(str(recipe_row.get('quantity') or 0)) * quantity
                    if ingredients:
                        Product.objects.bulk_update(ingredients, ['stock_quantity'])
                product.stock_level += quantity
                product.save(update_fields=['stock_level', 'updated_at'])
                InventoryEvent.objects.create(
                    event_type=InventoryEvent.STOCK_MOVEMENT, product=product, user=request.user,
                    movement_type='IN', quantity=quantity,
                    reason=f'Refund restock Order #{order.pk}',
                )

            raw_line_total = Decimal(str(line.get('net_subtotal') or line.get('subtotal') or 0))
            previously_refunded = Decimal(str(line.get('refunded_amount') or '0.00'))
            cumulative_refund = (
                raw_line_total * (returned_quantity + quantity) / max(sold_quantity, 1)
            ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            refund = cumulative_refund - previously_refunded
            line['returned_quantity'] = returned_quantity + quantity
            line['wasted_quantity'] = int(line.get('wasted_quantity') or 0) + (quantity if disposition == 'WASTED' else 0)
            line_returns = list(line.get('returns') or [])
            event = {
                'quantity': quantity,
                'disposition': disposition,
                'refund_amount': str(refund),
                'loss_at_cost': str((Decimal(str(line.get('cost') or 0)) * quantity).quantize(Decimal('0.01')) if disposition == 'WASTED' else Decimal('0.00')),
                'reason': str(request.data.get('reason') or '').strip()[:300],
                'staff_id': request.user.pk,
                'timestamp': timezone.now().isoformat(),
                'idempotency_key': idempotency_key,
            }
            line_returns.append(event)
            line['returns'] = line_returns
            line['refunded_amount'] = str((Decimal(str(line.get('refunded_amount') or 0)) + refund).quantize(Decimal('0.01')))
            order.line_items = items
            order.returned_amount += refund
            order.return_events = [*(order.return_events or []), {'product_id': product_id, **event}]
            order.save(update_fields=['line_items', 'returned_amount', 'return_events'])
            AuditLog.objects.create(
                user=request.user,
                action=f'POS_RETURN_{disposition}',
                description=f'Recorded {quantity} returned {product.name} as {disposition.lower()} for transaction {order.transaction_id or order.pk}.',
                metadata={'order_id': order.pk, 'product_id': product_id, 'quantity': quantity, 'disposition': disposition, 'refund_amount': str(refund), 'loss_at_cost': event['loss_at_cost'], 'stock_before': product_stock_before, 'stock_after': product.stock_level},
            )
        return Response(OrderSerializer(order).data)


class PaymentCreateView(generics.CreateAPIView):
    queryset = Payment.objects.filter(payment_type=Payment.POS)
    permission_classes = [IsStaffOrAdmin]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
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
        try:
            order = Order.objects.get(id=request.data.get('order'))
        except Order.DoesNotExist:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            Payment.objects.create(payment_type=Payment.POS, order=order, amount=amount, method=method, transaction_id=str(request.data.get('transaction_id', '') or '').strip()[:100], status='PAID')
            total_paid = order.payments.aggregate(value=Sum('amount'))['value'] or Decimal('0.00')
            if total_paid >= order.total:
                if order.payment_status != 'PAID':
                    order.payment_status = 'PAID'
                    order.save(update_fields=['payment_status'])
                assign_order_transaction_id(order)
            AuditLog.objects.create(user=request.user, action="POS_PAYMENT", description=f"Received payment of PHP {amount} for {order.transaction_id or 'Order #' + str(order.id)} via {method}.")
        return Response({"message": "Payment logged successfully.", "transaction_id": order.transaction_id})


def report_time_display(value):
    if not value:
        return ""
    return timezone.localtime(value).strftime("%I:%M %p")


def report_from_order(order):
    data = dict(order.report_data or {})
    if not data.get('transaction_ids'):
        data['transaction_ids'] = list(dict.fromkeys(
            value for value in (data.get('first_transaction_id'), data.get('last_transaction_id')) if value
        ))
    data.setdefault('transactions', [])
    data.setdefault('print_history', [])
    if not data['print_history'] and order.printed_at:
        data['print_history'] = [{
            'event': 'print',
            'recorded_at': order.printed_at,
            'printed': bool((order.print_status or {}).get('printed')),
            'printer': (order.print_status or {}).get('printer') or '',
            'error': (order.print_status or {}).get('error') or '',
        }]
    data.update({
        'id': order.id,
        'closed_by': order.staff_id,
        'closed_by_name': order.staff.username if order.staff else '',
        'printed_at': order.printed_at,
        'print_status': order.print_status,
        'created_at': order.created_at,
    })
    return data


def append_report_print_event(report_order, print_status, event='print'):
    report_data = dict(report_order.report_data or {})
    print_history = list(report_data.get('print_history') or [])
    print_history.append({
        'event': event,
        'recorded_at': timezone.now().isoformat(),
        'printed': bool(print_status.get('printed')),
        'printer': print_status.get('printer') or '',
        'error': print_status.get('error') or '',
    })
    report_data['print_history'] = print_history
    report_order.report_data = report_data
    report_order.print_status = print_status
    if print_status.get('printed'):
        report_order.printed_at = timezone.now()
    report_order.save(update_fields=['report_data', 'print_status', 'printed_at'])


def build_report_transaction_snapshot(paid_orders, booking_payments):
    transactions = []
    for order in sorted(paid_orders, key=lambda row: (row.completed_at or row.created_at, row.id)):
        payments = list(order.payments.all())
        transactions.append({
            'id': order.id,
            'transaction_id': order.transaction_id or '',
            'type': order.order_type,
            'created_at': order.completed_at or order.created_at,
            'staff_name': (order.staff.get_full_name() or order.staff.username) if order.staff else '',
            'booking_id': order.booking_id,
            'booking_customer_name': (
                order.booking.customer.get_full_name() or order.booking.customer.username
            ) if order.booking_id and order.booking and order.booking.customer else '',
            'subtotal': order.subtotal,
            'discount_type': order.discount_type,
            'discount_value': order.discount_value,
            'discount_amount': order.discount_amount,
            'refunds': order.returned_amount,
            'total': order.total,
            'items': [
                {
                    'id': item.get('id'),
                    'name': (item.get('product_details') or {}).get('name') or item.get('name') or 'Item',
                    'quantity': item.get('quantity', 0),
                    'returned_quantity': item.get('returned_quantity', 0),
                    'price': item.get('price', '0.00'),
                    'subtotal': item.get('subtotal', '0.00'),
                    'discount_amount': item.get('discount_amount', '0.00'),
                    'net_subtotal': item.get('net_subtotal', item.get('subtotal', '0.00')),
                }
                for item in order.line_items or []
            ],
            'payments': [
                {
                    'method': payment.method,
                    'amount': payment.amount,
                    'transaction_id': payment.transaction_id or '',
                    'reference_number': payment.reference_number or '',
                    'paid_at': payment.paid_at or payment.created_at,
                }
                for payment in payments
            ],
        })

    for payment in sorted(booking_payments, key=lambda row: (row.paid_at or row.created_at, row.id)):
        transactions.append({
            'id': f'booking-payment-{payment.id}',
            'transaction_id': payment.transaction_id or payment.reference_number or '',
            'type': 'BOOKING_PAYMENT',
            'created_at': payment.paid_at or payment.created_at,
            'staff_name': '',
            'booking_id': payment.booking_id,
            'subtotal': payment.amount,
            'discount_type': '',
            'discount_value': Decimal('0.00'),
            'discount_amount': Decimal('0.00'),
            'refunds': Decimal('0.00'),
            'total': payment.amount,
            'items': [],
            'payments': [{
                'method': payment.method,
                'amount': payment.amount,
                'transaction_id': payment.transaction_id or '',
                'reference_number': payment.reference_number or '',
                'paid_at': payment.paid_at or payment.created_at,
            }],
        })

    transaction_ids = []
    for transaction in transactions:
        candidate_ids = [transaction.get('transaction_id')]
        candidate_ids.extend(
            payment_id
            for payment in transaction.get('payments') or []
            for payment_id in (payment.get('transaction_id'), payment.get('reference_number'))
        )
        transaction_ids.extend(value for value in candidate_ids if value)
    transaction_ids = list(dict.fromkeys(transaction_ids))
    return transactions, transaction_ids


def transactions_for_report_date(report_date):
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(report_date, datetime.min.time()), tz)
    end = timezone.make_aware(datetime.combine(report_date, datetime.max.time()), tz)
    paid_orders = list(
        Order.objects.exclude(order_type='END_OF_DAY_REPORT')
        .filter(payment_status='PAID', created_at__range=(start, end))
        .select_related('staff', 'booking', 'booking__customer')
        .prefetch_related('payments')
    )
    booking_payments = list(
        Payment.objects.filter(payment_type=Payment.BOOKING, status='APPROVED', paid_at__range=(start, end))
        .select_related('booking', 'booking__customer')
    )
    return build_report_transaction_snapshot(paid_orders, booking_payments)


def build_end_of_day_payload(report):
    return {
        **report,
        "opening_time_display": report_time_display(report.get('opening_time')),
        "closing_time_display": report_time_display(report.get('closing_time')),
    }


def json_safe_report_data(report):
    """Store report JSON without leaking Decimal or datetime values into JSONField."""
    return json.loads(json.dumps(report, cls=DjangoJSONEncoder))


def build_end_of_day_report_data(user, report_date, actual_cash, opening_cash=Decimal('0.00'), cash_in_out=Decimal('0.00')):
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(report_date, datetime.min.time()), tz)
    end = timezone.make_aware(datetime.combine(report_date, datetime.max.time()), tz)
    paid_orders = list(Order.objects.exclude(order_type='END_OF_DAY_REPORT').filter(payment_status='PAID', created_at__range=(start, end)).select_related('staff', 'booking', 'booking__customer').prefetch_related('payments'))
    booking_payments = list(Payment.objects.filter(payment_type=Payment.BOOKING, status='APPROVED', paid_at__range=(start, end)).select_related('booking', 'booking__customer'))

    cash_sales = sum((order_revenue_by_payment_method(order, 'CASH') for order in paid_orders), Decimal('0.00'))
    gcash_pos_sales = sum((order_revenue_by_payment_method(order, 'GCASH') for order in paid_orders), Decimal('0.00'))
    booking_payment_income = sum((payment.amount for payment in booking_payments), Decimal('0.00'))
    subtotal_sales = sum((order.subtotal for order in paid_orders), Decimal('0.00'))
    discounts = sum((order.discount_amount for order in paid_orders), Decimal('0.00'))
    booking_linked_income = sum((order.total for order in paid_orders if order.order_type == 'BOOKING_LINKED'), Decimal('0.00'))
    cafe_pos_income = sum((order.total for order in paid_orders if order.order_type == 'WALK_IN'), Decimal('0.00'))
    total_items_sold = sum(sum(max(int(item.get('quantity') or 0) - int(item.get('returned_quantity') or 0), 0) for item in order.line_items or []) for order in paid_orders)
    cancelled_count = Order.objects.filter(created_at__range=(start, end), payment_status='CANCELLED').count()

    product_totals = defaultdict(lambda: {'quantity': 0, 'total': Decimal('0.00')})
    for order in paid_orders:
        for item in order.line_items or []:
            name = item.get('product_details', {}).get('name') or 'Item'
            sold_quantity = max(int(item.get('quantity') or 0) - int(item.get('returned_quantity') or 0), 0)
            product_totals[name]['quantity'] += sold_quantity
            item_total = Decimal(str(item.get('net_subtotal') or item.get('subtotal') or '0'))
            product_totals[name]['total'] += item_total * Decimal(sold_quantity) / max(int(item.get('quantity') or 1), 1)
    best_items = [
        {'name': name, 'quantity': values['quantity'], 'total': str(values['total'])}
        for name, values in sorted(product_totals.items(), key=lambda row: (-row[1]['quantity'], -row[1]['total']))[:5]
    ]

    transaction_ids = [order.transaction_id for order in sorted(paid_orders, key=lambda row: (row.completed_at or row.created_at, row.id)) if order.transaction_id]
    opening_time_values = [order.created_at for order in paid_orders] + [payment.paid_at for payment in booking_payments if payment.paid_at]
    opening_time = min(opening_time_values, default=None)
    closing_time = timezone.now()
    actual_cash = Decimal(str(actual_cash or '0'))
    opening_cash = Decimal(str(opening_cash or '0'))
    cash_in_out = Decimal(str(cash_in_out or '0'))
    expected_cash = opening_cash + cash_sales + cash_in_out
    transaction_snapshots, all_transaction_ids = build_report_transaction_snapshot(paid_orders, booking_payments)
    report = {
        'report_date': report_date,
        'opening_time': opening_time,
        'closing_time': closing_time,
        'staff_name': user.get_full_name() or user.username,
        'total_transactions': len(paid_orders) + len(booking_payments),
    'gross_sales': subtotal_sales + booking_payment_income,
        'discounts': discounts,
    'refunds': sum((order.returned_amount for order in paid_orders), Decimal('0.00')),
        'opening_cash': opening_cash,
        'cash_sales': cash_sales,
        'gcash_sales': gcash_pos_sales + booking_payment_income,
        'card_sales': Decimal('0.00'),
        'other_payment_sales': gcash_pos_sales,
        'booking_income': booking_linked_income + booking_payment_income,
        'cafe_pos_income': cafe_pos_income,
        'total_items_sold': total_items_sold,
        'best_selling_items': best_items,
        'cancelled_or_voided_transactions': cancelled_count,
        'cash_in_out': cash_in_out,
        'first_transaction_id': transaction_ids[0] if transaction_ids else '',
        'last_transaction_id': transaction_ids[-1] if transaction_ids else '',
        'transaction_ids': all_transaction_ids,
        'transactions': transaction_snapshots,
        'transaction_snapshot_version': 1,
        'expected_cash': expected_cash,
        'actual_cash': actual_cash,
        'cash_difference': actual_cash - expected_cash,
    }
    return report


def create_end_of_day_report(user, report_date, actual_cash, opening_cash=Decimal('0.00'), cash_in_out=Decimal('0.00')):
    report = build_end_of_day_report_data(user, report_date, actual_cash, opening_cash, cash_in_out)
    return Order.objects.create(
        staff=user,
        order_type='END_OF_DAY_REPORT',
        report_data=json_safe_report_data(report),
    )


class EndOfDayReportSummaryView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        if request.user.role != 'ADMIN':
            return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            report_date = datetime.strptime(request.query_params.get('report_date') or timezone.localdate().isoformat(), '%Y-%m-%d').date()
            opening_cash = Decimal(str(request.query_params.get('opening_cash') or '0'))
            cash_in_out = Decimal(str(request.query_params.get('cash_in_out') or '0'))
        except Exception:
            return Response({'detail': 'Use a valid report date and cash amounts.'}, status=status.HTTP_400_BAD_REQUEST)

        report = build_end_of_day_report_data(
            request.user,
            report_date,
            actual_cash=Decimal('0.00'),
            opening_cash=opening_cash,
            cash_in_out=cash_in_out,
        )
        return Response({
            'report_date': report['report_date'],
            'cash_sales': report['cash_sales'],
            'booking_income': report['booking_income'],
            'gcash_sales': report['gcash_sales'],
            'gross_sales': report['gross_sales'],
            'total_transactions': report['total_transactions'],
            'expected_cash': report['expected_cash'],
        })


class EndOfDayReportListCreateView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        reports = [report_from_order(order) for order in Order.objects.filter(order_type='END_OF_DAY_REPORT').select_related('staff')[:100]]
        return Response(EndOfDayReportSerializer(reports, many=True).data)

    def post(self, request):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        try:
            actual_cash = Decimal(str(request.data.get('actual_cash')))
            opening_cash = Decimal(str(request.data.get('opening_cash') or '0'))
            cash_in_out = Decimal(str(request.data.get('cash_in_out') or '0'))
        except Exception:
            return Response({"detail": "Cash values must be valid amounts."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            report_date = datetime.strptime(request.data.get('report_date') or timezone.localdate().isoformat(), "%Y-%m-%d").date()
        except ValueError:
            return Response({"report_date": "Use YYYY-MM-DD format."}, status=status.HTTP_400_BAD_REQUEST)
        report_order = create_end_of_day_report(request.user, report_date, actual_cash, opening_cash, cash_in_out)
        report = report_from_order(report_order)
        should_print_report = str(request.data.get('print_report', 'false')).strip().lower() in {'1', 'true', 'yes', 'on'}
        print_status = (
            print_end_of_day_report(build_end_of_day_payload(report))
            if should_print_report else {
                'printed': False,
                'printer': None,
                'error': 'Report printing was deferred to the local cashier printer.',
            }
        )
        append_report_print_event(report_order, print_status, event='created')
        AuditLog.objects.create(
            user=request.user,
            action='ADMIN_END_OF_DAY_REPORT_CREATE',
            description=f'Created end-of-day report #{report_order.id} for {report_date.isoformat()}.',
            metadata={'report_order_id': report_order.id, 'report_date': report_date.isoformat()},
        )
        data = EndOfDayReportSerializer(report_from_order(report_order)).data
        data['receipt_print'] = print_status
        return Response(data, status=status.HTTP_201_CREATED)


class EndOfDayReportReprintView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        try:
            report_order = Order.objects.get(pk=pk, order_type='END_OF_DAY_REPORT')
        except Order.DoesNotExist:
            return Response({"detail": "Report not found."}, status=status.HTTP_404_NOT_FOUND)
        report = report_from_order(report_order)
        should_print_report = str(request.data.get('print_report', 'false')).strip().lower() in {'1', 'true', 'yes', 'on'}
        print_status = (
            print_end_of_day_report(build_end_of_day_payload(report))
            if should_print_report else {
                'printed': False,
                'printer': None,
                'error': 'Report printing was deferred to the local cashier printer.',
            }
        )
        append_report_print_event(report_order, print_status, event='reprint')
        AuditLog.objects.create(
            user=request.user,
            action='ADMIN_END_OF_DAY_REPORT_REPRINT',
            description=f'Reprinted end-of-day report #{report_order.id}.',
            metadata={'report_order_id': report_order.id, 'printed': bool(print_status.get('printed'))},
        )
        data = EndOfDayReportSerializer(report_from_order(report_order)).data
        data['receipt_print'] = print_status
        return Response(data)


class EndOfDayReportDetailView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            report_order = Order.objects.select_related('staff').get(pk=pk, order_type='END_OF_DAY_REPORT')
        except Order.DoesNotExist:
            return Response({'detail': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        report = report_from_order(report_order)
        if not report.get('transaction_snapshot_version'):
            try:
                report_date = datetime.strptime(str(report.get('report_date') or ''), '%Y-%m-%d').date()
            except ValueError:
                report_date = None
            if report_date:
                transactions, transaction_ids = transactions_for_report_date(report_date)
                if transactions:
                    report['transactions'] = transactions
                    report['transaction_ids'] = transaction_ids or report.get('transaction_ids', [])
                report['transactions_reconstructed'] = True

        return Response(EndOfDayReportSerializer(report).data)


class EndOfDayReportMarkPrintedView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            report_order = Order.objects.get(pk=pk, order_type='END_OF_DAY_REPORT')
        except Order.DoesNotExist:
            return Response({'detail': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        printer = str(request.data.get('printer') or 'local cashier printer').strip()[:255]
        printed = str(request.data.get('printed', True)).strip().lower() not in {'0', 'false', 'no', 'off'}
        print_status = {
            'printed': printed,
            'printer': printer,
            'error': str(request.data.get('error') or '').strip()[:1000],
        }
        append_report_print_event(
            report_order,
            print_status,
            event='local_print' if printed else 'local_print_failed',
        )
        AuditLog.objects.create(
            user=request.user,
            action='ADMIN_END_OF_DAY_REPORT_MARK_PRINTED' if printed else 'ADMIN_END_OF_DAY_REPORT_PRINT_FAILED',
            description=(
                f'Marked end-of-day report #{report_order.id} as printed.'
                if printed else f'Local printing failed for end-of-day report #{report_order.id}.'
            ),
            metadata={'report_order_id': report_order.id, 'printer': printer, 'printed': printed, 'error': print_status['error']},
        )
        return Response(EndOfDayReportSerializer(report_from_order(report_order)).data)
