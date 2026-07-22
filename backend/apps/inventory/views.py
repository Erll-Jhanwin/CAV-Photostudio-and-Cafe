from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework import generics, permissions, status, views
from rest_framework.response import Response

from audit.models import AuditLog
from inventory.models import InventoryEvent, Product
from inventory.recipe_defaults import ensure_default_ingredients_and_recipes
from inventory.serializers import (
    DEFAULT_CATEGORIES,
    DEFAULT_SUPPLIERS,
    CategorySerializer,
    IngredientSerializer,
    IngredientStockMovementSerializer,
    ProductSerializer,
    PurchaseOrderSerializer,
    RecipeIngredientSerializer,
    StockMovementSerializer,
    supplier_for,
)
from users.permissions import IsStaffOrAdmin


def apply_limit(queryset, request, default=None, maximum=300):
    raw_limit = request.query_params.get('limit')
    if raw_limit is None:
        return queryset[:default] if default else queryset
    try:
        limit = min(max(int(raw_limit), 1), maximum)
    except (TypeError, ValueError):
        return queryset[:default] if default else queryset
    return queryset[:limit]


def normalize_purchase_order_items(items_data):
    normalized = {}
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
        normalized[product_id] = normalized.get(product_id, 0) + quantity

    products = Product.objects.filter(id__in=normalized, item_type=Product.PRODUCT)
    products_by_id = {product.id: product for product in products}
    missing = set(normalized) - set(products_by_id)
    if missing:
        return None, f'Product with ID {next(iter(missing))} was not found.'
    return [
        {'product_id': product_id, 'quantity': quantity, 'product_name': products_by_id[product_id].name}
        for product_id, quantity in normalized.items()
    ], None


class ProductListCreateView(generics.ListCreateAPIView):
    serializer_class = ProductSerializer

    def get_queryset(self):
        queryset = Product.objects.filter(item_type=Product.PRODUCT, is_active=True).order_by('name')
        return apply_limit(queryset, self.request)

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
        return apply_limit(queryset, self.request)

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
        return Response(CategorySerializer(DEFAULT_CATEGORIES, many=True).data)

    def post(self, request):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return Response({"detail": "Categories are fixed in the compact schema."}, status=status.HTTP_400_BAD_REQUEST)


class SupplierListCreateView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        return Response(DEFAULT_SUPPLIERS)

    def post(self, request):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return Response({"detail": "Suppliers are fixed in the compact schema."}, status=status.HTTP_400_BAD_REQUEST)


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
        supplier_id = request.data.get('supplier')
        supplier_details = supplier_for(supplier_id)
        if not supplier_details:
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
        if new_status and new_status not in {'ORDERED', 'RECEIVED', 'CANCELLED'}:
            return Response({"status": "Invalid purchase order status."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                po = InventoryEvent.objects.select_for_update().get(pk=kwargs['pk'], event_type=InventoryEvent.PURCHASE_ORDER)
            except InventoryEvent.DoesNotExist:
                return Response({"detail": "Purchase order not found."}, status=status.HTTP_404_NOT_FOUND)

            if new_status and po.status != new_status:
                if new_status == 'RECEIVED':
                    items, item_error = normalize_purchase_order_items(po.items or [])
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
                        product.save(update_fields=['stock_level'])
                        InventoryEvent.objects.create(
                            event_type=InventoryEvent.STOCK_MOVEMENT,
                            product=product,
                            movement_type='IN',
                            quantity=item['quantity'],
                            reason=f"Restock from PO #{po.id}",
                            user=request.user,
                        )
                po.status = new_status
                po.save(update_fields=['status'])
                AuditLog.objects.create(user=request.user, action="PO_UPDATE", description=f"Updated Purchase Order #{po.id} to {new_status}.")
        return Response(PurchaseOrderSerializer(po).data)
