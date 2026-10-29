from decimal import Decimal, InvalidOperation
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics, permissions, status, views
from rest_framework.response import Response

from audit.models import AuditLog
from inventory.models import (BusinessDay, DailyProductBalance, InventoryCorrection, ProductLossEvent,
    Category, InventoryEvent, Product, Supplier)
from inventory.recipe_defaults import ensure_default_ingredients_and_recipes
from pos.models import Order
from inventory.serializers import (
    CategorySerializer,
    IngredientSerializer,
    IngredientStockMovementSerializer,
    ProductSerializer,
    PurchaseOrderSerializer,
    PublicProductSerializer,
    RecipeIngredientSerializer,
    StockMovementSerializer,
    SupplierSerializer,
    active_supplier,
    supplier_for,
)
from users.permissions import IsStaffOrAdmin


def apply_limit(queryset, request, default=None, maximum=300):
    raw_limit = request.query_params.get('limit')
    try:
        limit = default if raw_limit is None else min(max(int(raw_limit), 1), maximum)
    except (TypeError, ValueError):
        limit = default
    try:
        offset = min(max(int(request.query_params.get('offset', 0)), 0), 100000)
    except (TypeError, ValueError):
        offset = 0
    if limit is None:
        return queryset[offset:] if offset else queryset
    return queryset[offset:offset + limit]


def normalize_purchase_order_items(items_data, allow_inactive=False):
    normalized = {}
    unit_costs = {}
    for item in items_data:
        if not isinstance(item, dict):
            return None, 'Each purchase order item must be an object.'
        try:
            product_id = int(item.get('product_id') or item.get('product'))
            quantity = int(item.get('quantity'))
        except (TypeError, ValueError):
            return None, 'Each purchase order item needs a product and whole-number quantity.'
        if quantity <= 0:
            return None, 'Purchase order quantities must be greater than zero.'
        raw_unit_cost = item.get('unit_cost', item.get('cost_price'))
        if raw_unit_cost in (None, ''):
            raw_unit_cost = None
        if raw_unit_cost is not None:
            try:
                unit_cost = Decimal(str(raw_unit_cost))
            except (InvalidOperation, TypeError, ValueError):
                return None, 'Each purchase order unit cost must be a valid number.'
            if unit_cost < 0:
                return None, 'Purchase order unit costs cannot be negative.'
            unit_costs.setdefault(product_id, unit_cost)
        normalized[product_id] = normalized.get(product_id, 0) + quantity

    products = Product.objects.filter(id__in=normalized, item_type=Product.PRODUCT)
    if not allow_inactive:
        products = products.filter(is_active=True)
    products_by_id = {product.id: product for product in products}
    missing = set(normalized) - set(products_by_id)
    if missing:
        return None, f'Product with ID {next(iter(missing))} was not found or is inactive.'
    return [
        {
            'product_id': product_id,
            'quantity': quantity,
            'product_name': products_by_id[product_id].name,
            'unit_cost': str(unit_costs.get(product_id, products_by_id[product_id].cost)),
            'line_total': str(unit_costs.get(product_id, products_by_id[product_id].cost) * quantity),
        }
        for product_id, quantity in normalized.items()
    ], None


class ProductListCreateView(generics.ListCreateAPIView):
    serializer_class = ProductSerializer

    def get_queryset(self):
        include_inactive = (
            self.request.user.is_authenticated
            and self.request.user.role in ['STAFF', 'ADMIN']
            and str(self.request.query_params.get('include_inactive', '')).lower() in {'1', 'true', 'yes'}
        )
        queryset = Product.objects.filter(item_type=Product.PRODUCT)
        if not include_inactive:
            queryset = queryset.filter(is_active=True)
        if not (
            self.request.user.is_authenticated
            and self.request.user.role in ['STAFF', 'ADMIN']
        ):
            queryset = queryset.defer('recipe_data', 'supplier_details')
        queryset = queryset.order_by('name')
        return apply_limit(queryset, self.request, default=100)

    def get_serializer_class(self):
        if self.request.method == 'GET' and (not self.request.user.is_authenticated or self.request.user.role == 'CUSTOMER'):
            return PublicProductSerializer
        return ProductSerializer

    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff and admins can create products."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()
        if product.stock_level > 0:
            InventoryEvent.objects.create(
                event_type=InventoryEvent.STOCK_MOVEMENT,
                product=product,
                movement_type='IN',
                quantity=product.stock_level,
                reason="Initial product creation",
                user=request.user,
            )
        AuditLog.objects.create(user=request.user, action="PRODUCT_CREATE", description=f"Created product: {product.name} (SKU: {product.sku}) with stock {product.stock_level}.")
        return Response(ProductSerializer(product).data, status=status.HTTP_201_CREATED)


class ProductDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Product.objects.filter(item_type=Product.PRODUCT)
    serializer_class = ProductSerializer
    permission_classes = [IsStaffOrAdmin]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff and admins can modify products."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            try:
                product = Product.objects.select_for_update().get(pk=kwargs['pk'], item_type=Product.PRODUCT)
            except Product.DoesNotExist:
                return Response({"detail": "Product not found."}, status=status.HTTP_404_NOT_FOUND)
            old_stock = product.stock_level
            serializer = self.get_serializer(product, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            updated_product = serializer.save()
            if old_stock != updated_product.stock_level:
                diff = updated_product.stock_level - old_stock
                InventoryEvent.objects.create(
                    event_type=InventoryEvent.STOCK_MOVEMENT,
                    product=updated_product,
                    movement_type='IN' if diff > 0 else 'OUT',
                    quantity=abs(diff),
                    reason="Manual inventory adjustment",
                    user=request.user,
                )
                AuditLog.objects.create(user=request.user, action="INVENTORY_ADJUST", description=f"Adjusted stock of {updated_product.name} from {old_stock} to {updated_product.stock_level}.")
        return Response(ProductSerializer(updated_product).data)

    def destroy(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff and admins can remove products."}, status=status.HTTP_403_FORBIDDEN)
        product = self.get_object()
        product.is_active = False
        product.save(update_fields=['is_active'])
        AuditLog.objects.create(user=request.user, action="PRODUCT_DEACTIVATE", description=f"Deactivated product: {product.name} (SKU: {product.sku}).")
        return Response(status=status.HTTP_204_NO_CONTENT)


class StockMovementListView(generics.ListCreateAPIView):
    serializer_class = StockMovementSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = InventoryEvent.objects.filter(event_type=InventoryEvent.STOCK_MOVEMENT).select_related('product', 'user')
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff can log stock movements."}, status=status.HTTP_403_FORBIDDEN)
        try:
            qty = int(request.data.get('quantity', 0))
        except (TypeError, ValueError):
            return Response({"quantity": "Quantity must be a whole number."}, status=status.HTTP_400_BAD_REQUEST)
        if qty <= 0:
            return Response({"quantity": "Quantity must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
        movement_type = request.data.get('movement_type')
        with transaction.atomic():
            try:
                product = Product.objects.select_for_update().get(id=request.data.get('product'), item_type=Product.PRODUCT, is_active=True)
            except Product.DoesNotExist:
                return Response({"detail": "Product not found."}, status=status.HTTP_404_NOT_FOUND)
            if movement_type == 'IN':
                product.stock_level += qty
            elif movement_type == 'OUT':
                if product.stock_level < qty:
                    return Response({"detail": "Insufficient stock level."}, status=status.HTTP_400_BAD_REQUEST)
                product.stock_level -= qty
            else:
                return Response({"detail": "Invalid movement type."}, status=status.HTTP_400_BAD_REQUEST)
            product.save(update_fields=['stock_level'])
            movement = InventoryEvent.objects.create(
                event_type=InventoryEvent.STOCK_MOVEMENT,
                product=product,
                movement_type=movement_type,
                quantity=qty,
                reason=str(request.data.get('reason', 'Manual Update') or 'Manual Update').strip()[:100],
                user=request.user,
            )
        AuditLog.objects.create(user=request.user, action="STOCK_MOVEMENT", description=f"Stock {movement_type}: {product.name} x {qty}.")
        return Response(StockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)


class IngredientListCreateView(generics.ListCreateAPIView):
    serializer_class = IngredientSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = Product.objects.filter(item_type=Product.INGREDIENT).order_by('name')
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            ingredient = serializer.save()
            if ingredient.stock_quantity > 0:
                InventoryEvent.objects.create(
                    event_type=InventoryEvent.INGREDIENT_MOVEMENT,
                    product=ingredient,
                    movement_type='IN',
                    quantity=ingredient.stock_quantity,
                    input_quantity=ingredient.stock_quantity,
                    input_unit=ingredient.base_unit,
                    reason='Initial ingredient creation',
                    user=request.user,
                )
            AuditLog.objects.create(user=request.user, action='INGREDIENT_CREATE', description=f"Created ingredient {ingredient.name} with stock {ingredient.stock_quantity} {ingredient.get_base_unit_display()}.")
        return Response(IngredientSerializer(ingredient).data, status=status.HTTP_201_CREATED)


class ProductSalesInventoryView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        raw_date = request.query_params.get('date')
        day = parse_date(raw_date) if raw_date else timezone.localdate()
        if not day:
            return Response({'date': 'Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
        products = list(Product.objects.filter(item_type=Product.PRODUCT, is_active=True).order_by('name'))
        product_ids = [row.id for row in products]
        sales = {}
        for order in Order.objects.exclude(order_type='END_OF_DAY_REPORT').filter(payment_status='PAID', created_at__date=day).order_by('created_at', 'id'):
            for line in order.line_items or []:
                product_id = int(line.get('product') or 0)
                if product_id not in product_ids:
                    continue
                entry = sales.setdefault(product_id, {
                    'beginning_stock': line.get('beginning_stock'),
                    'quantity_sold': 0,
                    'wastage': 0,
                    'restocked': 0,
                    'revenue': Decimal('0.00'),
                    'cost': Decimal('0.00'),
                })
                quantity = int(line.get('quantity') or 0)
                returned = int(line.get('returned_quantity') or 0)
                wasted = int(line.get('wasted_quantity') or 0)
                restocked = sum(int(event.get('quantity') or 0) for event in line.get('returns', []) if event.get('disposition') == 'RESTOCKED')
                entry['quantity_sold'] += max(quantity - returned, 0)
                entry['wastage'] += wasted
                entry['restocked'] += restocked
                line_revenue = Decimal(str(line.get('net_subtotal') or line.get('subtotal') or '0'))
                refunded = Decimal(str(line.get('refunded_amount') or '0'))
                entry['revenue'] += max(line_revenue - refunded, Decimal('0.00'))
                entry['cost'] += Decimal(str(line.get('cost') or '0')) * max(quantity - restocked, 0)
        ingredient_ids = {int(row.get('ingredient')) for product in products for row in (product.recipe_data or []) if row.get('ingredient')}
        ingredients = {row.id: row for row in Product.objects.filter(id__in=ingredient_ids, item_type=Product.INGREDIENT)}
        result = []
        for product in products:
            entry = sales.get(product.id, {})
            if entry.get('beginning_stock') is None:
                serving_counts = []
                for recipe_item in product.recipe_data or []:
                    ingredient = ingredients.get(int(recipe_item.get('ingredient') or 0))
                    required = Decimal(str(recipe_item.get('quantity') or '0'))
                    if ingredient and required > 0:
                        serving_counts.append(int(ingredient.stock_quantity // required))
                beginning = min(serving_counts) if serving_counts else product.stock_level
            else:
                beginning = int(entry['beginning_stock'])
            sold = int(entry.get('quantity_sold') or 0)
            wasted = int(entry.get('wastage') or 0)
            restocked = int(entry.get('restocked') or 0)
            current_servings = []
            for recipe_item in product.recipe_data or []:
                ingredient = ingredients.get(int(recipe_item.get('ingredient') or 0))
                required = Decimal(str(recipe_item.get('quantity') or '0'))
                if ingredient and required > 0:
                    current_servings.append(int(ingredient.stock_quantity // required))
            live_ending = min(current_servings) if current_servings else product.stock_level
            # quantity_sold already excludes all returned units. A RESTOCKED
            # return therefore must not be added back a second time here.
            ending = live_ending if day == timezone.localdate() else max(beginning - sold - wasted, 0)
            revenue = entry.get('revenue') or Decimal('0.00')
            cost = entry.get('cost') or Decimal('0.00')
            result.append({
                'product_id': product.id,
                'product_name': product.name,
                'date': day.isoformat(),
                'beginning_stock': beginning,
                'quantity_sold': sold,
                'wastage': wasted,
                'ending_stock': ending,
                'revenue': str(revenue.quantize(Decimal('0.01'))),
                'cost': str(cost.quantize(Decimal('0.01'))),
                'profit_loss': str((revenue - cost).quantize(Decimal('0.01'))),
            })
        return Response(result)


def _daily_report(day, actor=None):
    """Build the open-day view from POS records and the existing product ledger."""
    from django.utils.timezone import localtime
    products = list(Product.objects.filter(item_type=Product.PRODUCT, is_active=True).order_by('name'))
    balances = {b.product_id: b for b in DailyProductBalance.objects.filter(day=day).select_related('product')}
    if not day.is_closed and len(balances) < len(products):
        previous = BusinessDay.objects.filter(is_closed=True, business_date__lt=day.business_date).order_by('-business_date').first()
        may_carry_forward = previous and previous.business_date + timedelta(days=1) == day.business_date
        may_open_first_day = day.business_date == timezone.localdate() and not BusinessDay.objects.filter(is_closed=True).exists()
        if not (may_carry_forward or may_open_first_day):
            previous = None
        else:
            prev_balances = {b.product_id: (b.corrected_ending_quantity if b.corrected_ending_quantity is not None else b.actual_ending_quantity) for b in previous.balances.all()} if previous else {}
            first_sale_openings = {}
            opening_movement_deltas = {}
            if not previous:
                for movement in InventoryEvent.objects.filter(event_type=InventoryEvent.STOCK_MOVEMENT, product__in=products):
                    if localtime(movement.created_at).date() == day.business_date:
                        delta = int(movement.quantity) * (1 if movement.movement_type == 'IN' else -1)
                        opening_movement_deltas[movement.product_id] = opening_movement_deltas.get(movement.product_id, 0) + delta
                for order in Order.objects.filter(payment_status='PAID').exclude(order_type='END_OF_DAY_REPORT').order_by('completed_at', 'created_at', 'id'):
                    if localtime(order.completed_at or order.created_at).date() != day.business_date:
                        continue
                    for line in order.line_items or []:
                        product_id = int(line.get('product') or 0)
                        recorded_opening = line.get('inventory_beginning_stock', line.get('beginning_stock'))
                        if product_id and recorded_opening is not None:
                            first_sale_openings.setdefault(product_id, int(recorded_opening))
            # First tracked day reconstructs midnight stock from the product ledger when possible.
            for product in products:
                if product.id not in balances:
                    opening = prev_balances.get(product.id)
                    opening_source = 'previous_finalized_close'
                    if opening is None:
                        if product.id in opening_movement_deltas:
                            opening = product.stock_level - opening_movement_deltas[product.id]
                            opening_source = 'product_ledger_reconstruction'
                        elif localtime(product.created_at).date() == day.business_date:
                            opening = 0
                            opening_source = 'created_on_business_date'
                        else:
                            opening = first_sale_openings.get(product.id, product.stock_level)
                            opening_source = 'first_transaction_snapshot' if product.id in first_sale_openings else 'authorized_initial_snapshot'
                    balance, balance_created = DailyProductBalance.objects.get_or_create(day=day, product=product, defaults={'beginning_quantity': opening})
                    balances[product.id] = balance
                    if balance_created:
                        AuditLog.objects.create(user=day.opened_by or actor, action='INVENTORY_OPENING_BALANCE',
                            description=f'Opening inventory for {product.name} on {day.business_date}: {opening} {product.unit}.',
                            metadata={'product_id': product.id, 'quantity': opening, 'source': opening_source})
    rows = []
    orders = Order.objects.filter(payment_status='PAID').exclude(order_type='END_OF_DAY_REPORT').select_related('staff')
    refund_losses = {}
    later_waste_corrections = {}
    for order in orders:
        sale_day = localtime(order.completed_at or order.created_at).date()
        for event in order.return_events or []:
            try:
                product_id = int(event.get('product_id') or 0)
                quantity = int(event.get('quantity') or 0)
                return_day = localtime(timezone.datetime.fromisoformat(event.get('timestamp'))).date()
            except (TypeError, ValueError):
                continue
            if return_day != day.business_date or quantity <= 0:
                continue
            if event.get('disposition') == 'WASTED':
                return_actor = get_user_model().objects.filter(pk=event.get('staff_id')).first()
                refund_losses.setdefault(product_id, []).append({
                    'id': f'refund-{order.pk}-{event.get("timestamp")}-{product_id}', 'product_name': '',
                    'transaction_number': order.transaction_id or f'#{order.pk}', 'created_at': event.get('timestamp'),
                    'loss_type': 'Refunded', 'quantity': quantity, 'remarks': event.get('reason') or 'Refunded item was not restocked',
                    'staff_member': return_actor.get_full_name() or return_actor.username if return_actor else 'Unknown',
                    'restock_disposition': 'Not restocked', 'related_reference': order.transaction_id or f'#{order.pk}',
                })
                if sale_day != return_day:
                    later_waste_corrections[product_id] = later_waste_corrections.get(product_id, 0) - quantity
    for product in products:
        balance = balances.get(product.id)
        beginning = balance.beginning_quantity if balance else 0
        sold = 0
        returned_waste = 0
        for order in orders:
            moment = order.completed_at or order.created_at
            if localtime(moment).date() != day.business_date:
                continue
            for line in order.line_items or []:
                if int(line.get('product') or 0) == product.id:
                    returned_on_day = sum(int(event.get('quantity') or 0) for event in line.get('returns', [])
                        if event.get('timestamp') and localtime(timezone.datetime.fromisoformat(event['timestamp'])).date() == day.business_date)
                    sold += max(int(line.get('quantity') or 0) - returned_on_day, 0)
        sold += later_waste_corrections.get(product.id, 0)
        losses = list(ProductLossEvent.objects.filter(day=day, product=product).select_related('actor', 'related_order'))
        refund_detail = refund_losses.get(product.id, [])
        loss_qty = sum(loss.quantity for loss in losses) + sum(item['quantity'] for item in refund_detail)
        movement_events = list(InventoryEvent.objects.filter(event_type=InventoryEvent.STOCK_MOVEMENT, product=product))
        movement_total = 0
        restocks = 0
        adjustments = 0
        for movement in movement_events:
            if localtime(movement.created_at).date() != day.business_date:
                continue
            # POS outflows are represented by Net Sold. Closing adjustments are the explicit variance correction.
            if movement.reason.startswith(('POS Transaction', 'Day close reconciliation', 'Wastage:')):
                continue
            if movement.reason.startswith('Refund restock'):
                try:
                    returned_order_id = int(movement.reason.rsplit('#', 1)[-1])
                    returned_order = next(o for o in orders if o.pk == returned_order_id)
                    if localtime(returned_order.completed_at or returned_order.created_at).date() == day.business_date:
                        continue
                except (ValueError, StopIteration):
                    pass
            delta = int(movement.quantity) * (1 if movement.movement_type == 'IN' else -1)
            movement_total += delta
            if delta > 0:
                restocks += delta
            else:
                adjustments += delta
        expected = beginning + movement_total - sold - loss_qty
        actual = balance.actual_ending_quantity if balance else None
        variance = actual - expected if actual is not None else None
        status_label = 'Not Counted' if actual is None else ('Tally' if variance == 0 else (f'Short by {abs(variance)}' if variance < 0 else f'Over by {variance}'))
        rows.append({
            'product_id': product.id, 'product_name': product.name, 'unit': product.unit,
            'beginning_inventory': beginning, 'restocks': restocks, 'net_stock_adjustments': adjustments,
            'net_sold': sold, 'loss_qty': loss_qty, 'expected_ending': expected,
            'actual_ending': actual, 'variance': variance, 'tally_status': status_label,
            'losses': [{'id': e.id, 'product_name': product.name,
                'transaction_number': (e.related_order.transaction_id or f'#{e.related_order_id}') if e.related_order_id else None,
                'created_at': e.created_at.isoformat(), 'loss_type': e.get_loss_type_display(), 'quantity': e.quantity,
                'remarks': e.reason, 'staff_member': e.actor.get_full_name() or e.actor.username if e.actor else 'Unknown',
                'related_reference': e.related_order.transaction_id if e.related_order_id else None} for e in losses] + [dict(item, product_name=product.name) for item in refund_detail],
            'movements': [{'id': m.id, 'type': m.movement_type, 'quantity': int(m.quantity), 'reason': m.reason,
                'created_at': m.created_at.isoformat(), 'actor': m.user.get_full_name() or m.user.username if m.user else 'Unknown'}
                for m in movement_events if localtime(m.created_at).date() == day.business_date],
        })
    return {'date': day.business_date.isoformat(), 'is_closed': day.is_closed,
        'closed_by': day.closed_by.get_full_name() or day.closed_by.username if day.closed_by else None,
        'closed_at': day.closed_at.isoformat() if day.closed_at else None,
        'discrepancy_remarks': day.discrepancy_remarks, 'rows': rows,
        'report': day.report_data if day.is_closed else None}


class DailyInventoryView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        day_value = request.query_params.get('date') or timezone.localdate().isoformat()
        business_date = parse_date(day_value)
        if not business_date:
            return Response({'date': 'Use YYYY-MM-DD.'}, status=400)
        day = BusinessDay.objects.filter(business_date=business_date).first()
        if day is None:
            previous = BusinessDay.objects.filter(is_closed=True, business_date__lt=business_date).order_by('-business_date').first()
            can_start = business_date == timezone.localdate() and not BusinessDay.objects.filter(is_closed=True).exists()
            can_carry = previous and previous.business_date + timedelta(days=1) == business_date
            if not (can_start or can_carry):
                return Response({'detail': 'No saved reconciliation exists for this date. Historical counts are not inferred.'}, status=404)
            day, created = BusinessDay.objects.get_or_create(business_date=business_date, defaults={'opened_by': request.user})
        else:
            created = False
        if created:
            AuditLog.objects.create(user=request.user, action='INVENTORY_DAY_OPEN', description=f'Opened product inventory reconciliation for {business_date}.')
        if day.is_closed:
            return Response({**day.report_data, 'corrections': self._corrections(day)})
        report = _daily_report(day, request.user)
        if day.balances.count() < len(report['rows']):
            return Response({'detail': 'Opening balances are unavailable for this historical date; no counts were inferred.'}, status=404)
        return Response(report)

    @staticmethod
    def _corrections(day):
        return [{'id': correction.id, 'product_name': correction.product.name,
            'previous_quantity': correction.previous_quantity, 'corrected_quantity': correction.corrected_quantity,
            'reason': correction.reason, 'actor': correction.actor.get_full_name() or correction.actor.username if correction.actor else 'Unknown',
            'created_at': correction.created_at.isoformat()} for correction in day.corrections.select_related('product', 'actor')]

    def post(self, request):
        if request.user.role not in {'STAFF', 'ADMIN'}:
            return Response({'detail': 'Staff access required.'}, status=403)
        action = str(request.data.get('action') or '').upper()
        day_value = str(request.data.get('date') or timezone.localdate().isoformat())
        business_date = parse_date(day_value)
        if not business_date:
            return Response({'date': 'Use YYYY-MM-DD.'}, status=400)
        if action == 'CORRECTION':
            if request.user.role != 'ADMIN':
                return Response({'detail': 'Admin access required to correct finalized inventory.'}, status=403)
            try:
                product_id = int(request.data.get('product_id'))
                corrected_quantity = int(request.data.get('quantity'))
            except (TypeError, ValueError):
                return Response({'detail': 'Product and whole-number corrected quantity are required.'}, status=400)
            reason = str(request.data.get('reason') or '').strip()
            idempotency_key = str(request.data.get('idempotency_key') or '').strip()[:100]
            if corrected_quantity < 0 or not reason or not idempotency_key:
                return Response({'detail': 'A non-negative quantity, explanation, and idempotency key are required.'}, status=400)
            with transaction.atomic():
                day = BusinessDay.objects.select_for_update().filter(business_date=business_date).first()
                if not day or not day.is_closed:
                    return Response({'detail': 'Corrections apply only to finalized business days.'}, status=409)
                duplicate = InventoryCorrection.objects.filter(day=day, idempotency_key=idempotency_key).first()
                if duplicate:
                    return Response({**day.report_data, 'corrections': self._corrections(day)})
                if BusinessDay.objects.filter(is_closed=True, business_date__gt=business_date).exists():
                    return Response({'detail': 'Correct finalized days in chronological order so later saved reports remain intact.'}, status=409)
                try:
                    balance = DailyProductBalance.objects.select_for_update().get(day=day, product_id=product_id)
                except DailyProductBalance.DoesNotExist:
                    return Response({'detail': 'Product was not part of the finalized report.'}, status=404)
                previous_quantity = balance.corrected_ending_quantity if balance.corrected_ending_quantity is not None else balance.actual_ending_quantity
                if previous_quantity is None:
                    return Response({'detail': 'The finalized report has no physical count to correct.'}, status=409)
                delta = corrected_quantity - previous_quantity
                product = Product.objects.select_for_update().get(pk=product_id)
                if product.stock_level + delta < 0:
                    return Response({'detail': 'This correction would make current product stock negative.'}, status=400)
                later_balances = list(DailyProductBalance.objects.select_for_update().filter(day__is_closed=False, day__business_date__gt=business_date, product_id=product_id).select_related('day'))
                if any(balance.beginning_quantity + delta < 0 for balance in later_balances):
                    return Response({'detail': 'This correction would make a later open-day opening balance negative.'}, status=400)
                product.stock_level += delta
                product.save(update_fields=['stock_level', 'updated_at'])
                balance.corrected_ending_quantity = corrected_quantity
                balance.save(update_fields=['corrected_ending_quantity'])
                for later_balance in later_balances:
                    before = later_balance.beginning_quantity
                    later_balance.beginning_quantity += delta
                    later_balance.save(update_fields=['beginning_quantity'])
                    AuditLog.objects.create(user=request.user, action='INVENTORY_OPENING_CORRECT', description=f'Adjusted opening balance for {product.name} on {later_balance.day.business_date} from {before} to {later_balance.beginning_quantity}.', metadata={'product_id': product_id, 'before': before, 'after': later_balance.beginning_quantity, 'correction_day': business_date.isoformat()})
                if delta:
                    InventoryEvent.objects.create(event_type=InventoryEvent.STOCK_MOVEMENT, product=product, user=request.user,
                        movement_type='IN' if delta > 0 else 'OUT', quantity=abs(delta),
                        reason=f'Authorized inventory correction {business_date}: {reason[:90]}')
                InventoryCorrection.objects.create(day=day, product=product, previous_quantity=previous_quantity,
                    corrected_quantity=corrected_quantity, reason=reason, actor=request.user, idempotency_key=idempotency_key)
                AuditLog.objects.create(user=request.user, action='INVENTORY_FINAL_CORRECTION', description=f'Corrected finalized {business_date} count for {product.name} from {previous_quantity} to {corrected_quantity}: {reason}.', metadata={'product_id': product_id, 'before': previous_quantity, 'after': corrected_quantity})
            return Response({**day.report_data, 'corrections': self._corrections(day)})
        if action in {'LOSS', 'COUNT'} and not BusinessDay.objects.filter(business_date=business_date).exists():
            previous = BusinessDay.objects.filter(is_closed=True, business_date__lt=business_date).order_by('-business_date').first()
            can_start = business_date == timezone.localdate() and not BusinessDay.objects.filter(is_closed=True).exists()
            can_carry = previous and previous.business_date + timedelta(days=1) == business_date
            if not (can_start or can_carry):
                return Response({'detail': 'No open business day exists for this date.'}, status=404)
        if action == 'LOSS':
            try:
                product_id, quantity = int(request.data.get('product_id')), int(request.data.get('quantity'))
            except (TypeError, ValueError):
                return Response({'detail': 'Product and whole number quantity are required.'}, status=400)
            reason = str(request.data.get('reason') or '').strip()
            idempotency_key = str(request.data.get('idempotency_key') or '').strip()[:100]
            if quantity <= 0 or not reason:
                return Response({'detail': 'Quantity must be positive and a reason is required.'}, status=400)
            if not idempotency_key:
                return Response({'detail': 'An idempotency key is required for wastage records.'}, status=400)
            with transaction.atomic():
                day, _ = BusinessDay.objects.select_for_update().get_or_create(business_date=business_date, defaults={'opened_by': request.user})
                if day.is_closed:
                    return Response({'detail': 'Closed days cannot be edited.'}, status=409)
                report = _daily_report(day, request.user)
                if day.balances.count() < len(report['rows']):
                    return Response({'detail': 'Opening balances are unavailable for this date.'}, status=409)
                duplicate = ProductLossEvent.objects.filter(day=day, idempotency_key=idempotency_key).first()
                if duplicate:
                    return Response(_daily_report(day, request.user))
                try:
                    product = Product.objects.select_for_update().get(pk=product_id, item_type=Product.PRODUCT, is_active=True)
                except Product.DoesNotExist:
                    return Response({'detail': 'Product not found.'}, status=404)
                if product.stock_level < quantity:
                    return Response({'detail': f'Insufficient available stock ({product.stock_level}).'}, status=400)
                product.stock_level -= quantity
                product.save(update_fields=['stock_level', 'updated_at'])
                movement = InventoryEvent.objects.create(event_type=InventoryEvent.STOCK_MOVEMENT, product=product, user=request.user,
                    movement_type='OUT', quantity=quantity, reason=f'Wastage: {reason[:110]}')
                ProductLossEvent.objects.create(day=day, product=product, quantity=quantity, reason=reason, actor=request.user, inventory_event=movement, idempotency_key=idempotency_key)
                AuditLog.objects.create(user=request.user, action='PRODUCT_WASTAGE', description=f'Recorded waste of {quantity} {product.name} on {business_date}: {reason}.', metadata={'product_id': product.id, 'quantity': quantity, 'before': product.stock_level + quantity, 'after': product.stock_level})
            return Response(_daily_report(day, request.user), status=201)
        if action == 'COUNT':
            try:
                product_id, quantity = int(request.data.get('product_id')), int(request.data.get('quantity'))
            except (TypeError, ValueError):
                return Response({'detail': 'Product and whole number quantity are required.'}, status=400)
            if quantity < 0:
                return Response({'detail': 'Count cannot be negative.'}, status=400)
            with transaction.atomic():
                day = BusinessDay.objects.select_for_update().get(business_date=business_date)
                if day.is_closed:
                    return Response({'detail': 'Closed days cannot be edited.'}, status=409)
                report = _daily_report(day, request.user)
                if day.balances.count() < len(report['rows']):
                    return Response({'detail': 'Opening balances are unavailable for this date.'}, status=409)
                balance = DailyProductBalance.objects.select_for_update().get(day=day, product_id=product_id)
                previous = balance.actual_ending_quantity
                balance.actual_ending_quantity = quantity
                balance.counted_by = request.user
                balance.counted_at = timezone.now()
                balance.save(update_fields=['actual_ending_quantity', 'counted_by', 'counted_at'])
                AuditLog.objects.create(user=request.user, action='INVENTORY_COUNT', description=f'Counted product {balance.product.name} for {business_date}: {previous} to {quantity}.', metadata={'product_id': product_id, 'before': previous, 'after': quantity})
            return Response(_daily_report(day, request.user))
        if action == 'CLOSE':
            with transaction.atomic():
                day = BusinessDay.objects.select_for_update().get(business_date=business_date)
                if day.is_closed:
                    return Response(day.report_data)
                report = _daily_report(day, request.user)
                if day.balances.count() < len(report['rows']):
                    return Response({'detail': 'Opening balances are unavailable for this date.'}, status=409)
                if any(row['actual_ending'] is None for row in report['rows']):
                    return Response({'detail': 'Count every active product before closing.'}, status=400)
                discrepant = [row for row in report['rows'] if row['variance']]
                remarks = str(request.data.get('remarks') or '').strip()
                if discrepant and (request.user.role != 'ADMIN' or not remarks):
                    return Response({'detail': 'An admin and discrepancy explanation are required to close with variances.'}, status=403 if request.user.role != 'ADMIN' else 400)
                # An incomplete paid/refund/pending transaction must not be silently rolled into a closed report.
                from django.utils.timezone import localtime
                unresolved = [o.pk for o in Order.objects.filter(payment_status='PENDING') if localtime(o.created_at).date() == business_date]
                if unresolved:
                    return Response({'detail': 'Resolve pending transactions before closing.', 'orders': unresolved}, status=409)
                report['discrepancy_remarks'] = remarks
                report['closed_by'] = request.user.get_full_name() or request.user.username
                report['closed_at'] = timezone.now().isoformat()
                report['is_closed'] = True
                for row in report['rows']:
                    product = Product.objects.select_for_update().get(pk=row['product_id'])
                    before = product.stock_level
                    counted = row['actual_ending']
                    if before != counted:
                        diff = counted - before
                        product.stock_level = counted
                        product.save(update_fields=['stock_level', 'updated_at'])
                        adjustment = InventoryEvent.objects.create(event_type=InventoryEvent.STOCK_MOVEMENT, product=product, user=request.user,
                            movement_type='IN' if diff > 0 else 'OUT', quantity=abs(diff), reason=f'Day close reconciliation {business_date}: {remarks[:80]}')
                        row['ledger_before'] = before
                        row['closing_reconciliation_adjustment'] = {'movement_id': adjustment.id, 'type': adjustment.movement_type,
                            'quantity': int(adjustment.quantity), 'reason': adjustment.reason, 'created_at': adjustment.created_at.isoformat(),
                            'actor': request.user.get_full_name() or request.user.username}
                        row['movements'].append(row['closing_reconciliation_adjustment'])
                    row['tally_status'] = 'Tally' if row['variance'] == 0 else (f'Short by {abs(row["variance"])}' if row['variance'] < 0 else f'Over by {row["variance"]}')
                day.is_closed = True
                day.closed_by = request.user
                day.closed_at = timezone.now()
                day.discrepancy_remarks = remarks
                day.report_data = report
                day.save(update_fields=['is_closed', 'closed_by', 'closed_at', 'discrepancy_remarks', 'report_data'])
                AuditLog.objects.create(user=request.user, action='INVENTORY_DAY_CLOSE', description=f'Closed inventory day {business_date}.', metadata={'discrepancies': len(discrepant), 'remarks': remarks})
            return Response(day.report_data)
        return Response({'action': 'Use COUNT, LOSS, or CLOSE.'}, status=400)


class IngredientDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Product.objects.filter(item_type=Product.INGREDIENT)
    serializer_class = IngredientSerializer
    permission_classes = [IsStaffOrAdmin]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            try:
                ingredient = Product.objects.select_for_update().get(pk=kwargs['pk'], item_type=Product.INGREDIENT)
            except Product.DoesNotExist:
                return Response({"detail": "Ingredient not found."}, status=status.HTTP_404_NOT_FOUND)
            old_quantity = ingredient.stock_quantity
            serializer = self.get_serializer(ingredient, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            updated_ingredient = serializer.save()
            if old_quantity != updated_ingredient.stock_quantity:
                diff = updated_ingredient.stock_quantity - old_quantity
                InventoryEvent.objects.create(
                    event_type=InventoryEvent.INGREDIENT_MOVEMENT,
                    product=updated_ingredient,
                    movement_type='IN' if diff > 0 else 'OUT',
                    quantity=abs(diff),
                    input_quantity=abs(diff),
                    input_unit=updated_ingredient.base_unit,
                    reason='Manual ingredient adjustment',
                    user=request.user,
                )
                AuditLog.objects.create(user=request.user, action='INGREDIENT_ADJUST', description=f"Adjusted ingredient {updated_ingredient.name} from {old_quantity} to {updated_ingredient.stock_quantity} {updated_ingredient.get_base_unit_display()}.")
        return Response(IngredientSerializer(updated_ingredient).data)

    def destroy(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class RecipeIngredientListCreateView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        product_id = request.query_params.get('product')
        products = Product.objects.filter(item_type=Product.PRODUCT)
        if product_id:
            products = products.filter(id=product_id)
        rows = []
        for product in products:
            rows.extend(ProductSerializer(product).data.get('recipe_items', []))
        return Response(rows)

    def post(self, request):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        serializer = RecipeIngredientSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = Product.objects.get(id=serializer.validated_data['product'], item_type=Product.PRODUCT)
        ingredient = Product.objects.get(id=serializer.validated_data['ingredient'], item_type=Product.INGREDIENT)
        recipe_items = list(product.recipe_data or [])
        row = {
            'id': len(recipe_items) + 1,
            'product': product.id,
            'ingredient': ingredient.id,
            'ingredient_name': ingredient.name,
            'quantity': str(serializer.validated_data['quantity']),
            'base_unit': ingredient.base_unit,
        }
        recipe_items.append(row)
        product.recipe_data = recipe_items
        product.save(update_fields=['recipe_data'])
        return Response(row, status=status.HTTP_201_CREATED)


class IngredientStockMovementListView(generics.ListCreateAPIView):
    serializer_class = IngredientStockMovementSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = InventoryEvent.objects.filter(event_type=InventoryEvent.INGREDIENT_MOVEMENT).select_related('product', 'user')
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        movement_type = request.data.get('movement_type')
        input_quantity = request.data.get('quantity', request.data.get('input_quantity', 0))
        input_unit = request.data.get('unit', request.data.get('input_unit', '')).upper()
        reason = str(request.data.get('reason', 'Manual ingredient adjustment') or 'Manual ingredient adjustment').strip()[:150]
        if movement_type not in ('IN', 'OUT'):
            return Response({"detail": "Invalid movement type."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            try:
                ingredient = Product.objects.select_for_update().get(id=request.data.get('ingredient'), item_type=Product.INGREDIENT)
                quantity = ingredient.convert_stock_quantity(input_quantity, input_unit)
            except Product.DoesNotExist:
                return Response({"detail": "Ingredient not found."}, status=status.HTTP_404_NOT_FOUND)
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            except (InvalidOperation, TypeError):
                return Response({"quantity": "Quantity must be a valid number."}, status=status.HTTP_400_BAD_REQUEST)
            if quantity <= 0:
                return Response({"quantity": "Quantity must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
            if movement_type == 'IN':
                ingredient.stock_quantity += quantity
            else:
                if ingredient.stock_quantity < quantity:
                    return Response({"detail": f"Insufficient {ingredient.name}. Available: {ingredient.stock_quantity} {ingredient.get_base_unit_display()}."}, status=status.HTTP_400_BAD_REQUEST)
                ingredient.stock_quantity -= quantity
            ingredient.save(update_fields=['stock_quantity'])
            movement = InventoryEvent.objects.create(
                event_type=InventoryEvent.INGREDIENT_MOVEMENT,
                product=ingredient,
                movement_type=movement_type,
                quantity=quantity,
                input_quantity=input_quantity,
                input_unit=input_unit,
                reason=reason,
                user=request.user,
            )
        AuditLog.objects.create(user=request.user, action="INGREDIENT_STOCK_MOVEMENT", description=f"Ingredient stock {movement_type}: {ingredient.name} {quantity} {ingredient.get_base_unit_display()} ({reason}).")
        return Response(IngredientStockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)


class GenerateRecipeIngredientsView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def post(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        generated = ensure_default_ingredients_and_recipes()
        AuditLog.objects.create(user=request.user, action="RECIPE_GENERATE", description=f"Generated default ingredient recipes ({generated} new links).")
        return Response({"message": "Raw ingredient list and drink recipes generated.", "created_recipe_items": generated})


class CategoryListCreateView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        queryset = Category.objects.all()
        if str(request.query_params.get('include_inactive', '')).lower() not in {'1', 'true', 'yes'}:
            queryset = queryset.filter(is_active=True)
        return Response(CategorySerializer(queryset, many=True).data)

    def post(self, request):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        serializer = CategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        category = serializer.save()
        AuditLog.objects.create(user=request.user, action='CATEGORY_CREATE', description=f'Created category: {category.name}.')
        return Response(CategorySerializer(category).data, status=status.HTTP_201_CREATED)


class SupplierListCreateView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        queryset = Supplier.objects.all()
        if str(request.query_params.get('include_inactive', '')).lower() not in {'1', 'true', 'yes'}:
            queryset = queryset.filter(is_active=True)
        return Response(SupplierSerializer(queryset, many=True).data)

    def post(self, request):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        serializer = SupplierSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        supplier = serializer.save()
        AuditLog.objects.create(user=request.user, action='SUPPLIER_CREATE', description=f'Created supplier: {supplier.name}.')
        return Response(SupplierSerializer(supplier).data, status=status.HTTP_201_CREATED)


class CategoryDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsStaffOrAdmin]

    def perform_update(self, serializer):
        category = serializer.save()
        AuditLog.objects.create(user=self.request.user, action='CATEGORY_UPDATE', description=f'Updated category: {category.name}.')

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
        AuditLog.objects.create(user=self.request.user, action='CATEGORY_DEACTIVATE', description=f'Deactivated category: {instance.name}.')


class SupplierDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsStaffOrAdmin]

    def perform_update(self, serializer):
        supplier = serializer.save()
        AuditLog.objects.create(user=self.request.user, action='SUPPLIER_UPDATE', description=f'Updated supplier: {supplier.name}.')

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
        AuditLog.objects.create(user=self.request.user, action='SUPPLIER_DEACTIVATE', description=f'Deactivated supplier: {instance.name}.')


class PurchaseOrderListCreateView(generics.ListCreateAPIView):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = InventoryEvent.objects.filter(event_type=InventoryEvent.PURCHASE_ORDER)
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        items_data = request.data.get('items', [])
        if not items_data or not isinstance(items_data, list):
            return Response({"items": "Purchase order needs at least one item."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            supplier_id = int(request.data.get('supplier'))
        except (TypeError, ValueError):
            supplier_id = None
        supplier_details = supplier_for(supplier_id)
        if not supplier_details or not active_supplier(supplier_id):
            return Response({"supplier": "Select a valid supplier."}, status=status.HTTP_400_BAD_REQUEST)
        items, item_error = normalize_purchase_order_items(items_data)
        if item_error:
            return Response({"items": item_error}, status=status.HTTP_400_BAD_REQUEST)
        event = InventoryEvent.objects.create(
            event_type=InventoryEvent.PURCHASE_ORDER,
            supplier=supplier_id,
            supplier_details=supplier_details,
            status='ORDERED',
            notes=str(request.data.get('notes', '') or '').strip()[:1000],
            items=items,
            user=request.user,
        )
        AuditLog.objects.create(user=request.user, action="PO_CREATE", description=f"Created Purchase Order #{event.id}.")
        return Response(PurchaseOrderSerializer(event).data, status=status.HTTP_201_CREATED)


class PurchaseOrderDetailUpdateView(generics.RetrieveUpdateAPIView):
    queryset = InventoryEvent.objects.filter(event_type=InventoryEvent.PURCHASE_ORDER)
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsStaffOrAdmin]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        new_status = request.data.get('status')
        if new_status is not None:
            new_status = str(new_status).upper().strip()
        if new_status and new_status not in {'ORDERED', 'RECEIVED', 'CANCELLED'}:
            return Response({"status": "Invalid purchase order status."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                po = InventoryEvent.objects.select_for_update().get(pk=kwargs['pk'], event_type=InventoryEvent.PURCHASE_ORDER)
            except InventoryEvent.DoesNotExist:
                return Response({"detail": "Purchase order not found."}, status=status.HTTP_404_NOT_FOUND)

            editable_fields = {'supplier', 'items', 'notes'} & set(request.data.keys())
            if editable_fields and po.status != 'ORDERED':
                return Response({"detail": "Only ordered purchase orders can be edited."}, status=status.HTTP_400_BAD_REQUEST)

            changed_fields = []
            if 'supplier' in request.data:
                try:
                    supplier_id = int(request.data.get('supplier'))
                except (TypeError, ValueError):
                    supplier_id = None
                supplier_details = supplier_for(supplier_id)
                if not supplier_details or not active_supplier(supplier_id):
                    return Response({"supplier": "Select a valid supplier."}, status=status.HTTP_400_BAD_REQUEST)
                po.supplier = supplier_id
                po.supplier_details = supplier_details
                changed_fields.extend(['supplier', 'supplier_details'])

            if 'items' in request.data:
                if not isinstance(request.data.get('items'), list) or not request.data.get('items'):
                    return Response({"items": "Purchase order needs at least one item."}, status=status.HTTP_400_BAD_REQUEST)
                items, item_error = normalize_purchase_order_items(request.data.get('items'), allow_inactive=True)
                if item_error:
                    return Response({"items": item_error}, status=status.HTTP_400_BAD_REQUEST)
                po.items = items
                changed_fields.append('items')

            if 'notes' in request.data:
                po.notes = str(request.data.get('notes', '') or '').strip()[:1000]
                changed_fields.append('notes')

            if new_status and po.status != new_status:
                if po.status != 'ORDERED':
                    return Response({"status": "Only ordered purchase orders can be received or cancelled."}, status=status.HTTP_400_BAD_REQUEST)
                if new_status == 'RECEIVED':
                    items, item_error = normalize_purchase_order_items(po.items or [], allow_inactive=True)
                    if item_error:
                        return Response({"items": item_error}, status=status.HTTP_400_BAD_REQUEST)
                    product_ids = [item['product_id'] for item in items]
                    products = Product.objects.select_for_update().filter(id__in=product_ids, item_type=Product.PRODUCT)
                    products_by_id = {product.id: product for product in products}
                    if len(products_by_id) != len(product_ids):
                        return Response({"items": "A purchase order product no longer exists."}, status=status.HTTP_400_BAD_REQUEST)
                    for item in items:
                        product = products_by_id[item['product_id']]
                        product.stock_level += item['quantity']
                        product.save(update_fields=['stock_level', 'updated_at'])
                        InventoryEvent.objects.create(
                            event_type=InventoryEvent.STOCK_MOVEMENT,
                            product=product,
                            movement_type='IN',
                            quantity=item['quantity'],
                            reason=f"Restock from PO #{po.id}",
                            user=request.user,
                        )
                po.status = new_status
                changed_fields.append('status')

            if changed_fields:
                po.save(update_fields=sorted(set(changed_fields + ['updated_at'])))
                AuditLog.objects.create(
                    user=request.user,
                    action="PO_UPDATE",
                    description=f"Updated Purchase Order #{po.id}{f' to {new_status}' if new_status else ''}.",
                )
        return Response(PurchaseOrderSerializer(po).data)
