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


def apply_limit(queryset, request, default=None, maximum=300):
    raw_limit = request.query_params.get('limit')
    if raw_limit is None:
        return queryset[:default] if default else queryset
    try:
        limit = min(max(int(raw_limit), 1), maximum)
    except (TypeError, ValueError):
        return queryset[:default] if default else queryset
    return queryset[:limit]


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
    permission_classes = [permissions.IsAuthenticated]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff and admins can modify products."}, status=status.HTTP_403_FORBIDDEN)
        product = self.get_object()
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
        return Response(serializer.data)

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
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = InventoryEvent.objects.filter(event_type=InventoryEvent.STOCK_MOVEMENT).select_related('product', 'user')
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff can log stock movements."}, status=status.HTTP_403_FORBIDDEN)
        try:
            product = Product.objects.select_for_update().get(id=request.data.get('product'), item_type=Product.PRODUCT, is_active=True)
            qty = int(request.data.get('quantity', 0))
        except Product.DoesNotExist:
            return Response({"detail": "Product not found."}, status=status.HTTP_404_NOT_FOUND)
        except (TypeError, ValueError):
            return Response({"quantity": "Quantity must be a whole number."}, status=status.HTTP_400_BAD_REQUEST)
        if qty <= 0:
            return Response({"quantity": "Quantity must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
        movement_type = request.data.get('movement_type')
        with transaction.atomic():
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
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Product.objects.filter(item_type=Product.INGREDIENT).order_by('name')
        return apply_limit(queryset, self.request)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)


class IngredientDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Product.objects.filter(item_type=Product.INGREDIENT)
    serializer_class = IngredientSerializer
    permission_classes = [permissions.IsAuthenticated]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class RecipeIngredientListCreateView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

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
    permission_classes = [permissions.IsAuthenticated]

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
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        generated = ensure_default_ingredients_and_recipes()
        AuditLog.objects.create(user=request.user, action="RECIPE_GENERATE", description=f"Generated default ingredient recipes ({generated} new links).")
        return Response({"message": "Raw ingredient list and drink recipes generated.", "created_recipe_items": generated})


class CategoryListCreateView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(CategorySerializer(DEFAULT_CATEGORIES, many=True).data)

    def post(self, request):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return Response({"detail": "Categories are fixed in the compact schema."}, status=status.HTTP_400_BAD_REQUEST)


class SupplierListCreateView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(DEFAULT_SUPPLIERS)

    def post(self, request):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return Response({"detail": "Suppliers are fixed in the compact schema."}, status=status.HTTP_400_BAD_REQUEST)


class PurchaseOrderListCreateView(generics.ListCreateAPIView):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [permissions.IsAuthenticated]

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
        event = InventoryEvent.objects.create(
            event_type=InventoryEvent.PURCHASE_ORDER,
            supplier=supplier_id,
            supplier_details=supplier_for(supplier_id) or {},
            status='ORDERED',
            notes=str(request.data.get('notes', '') or '').strip()[:1000],
            items=items_data,
            user=request.user,
        )
        AuditLog.objects.create(user=request.user, action="PO_CREATE", description=f"Created Purchase Order #{event.id}.")
        return Response(PurchaseOrderSerializer(event).data, status=status.HTTP_201_CREATED)


class PurchaseOrderDetailUpdateView(generics.RetrieveUpdateAPIView):
    queryset = InventoryEvent.objects.filter(event_type=InventoryEvent.PURCHASE_ORDER)
    serializer_class = PurchaseOrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        po = self.get_object()
        new_status = request.data.get('status')
        if new_status and po.status != new_status:
            if new_status not in {'ORDERED', 'RECEIVED', 'CANCELLED'}:
                return Response({"status": "Invalid purchase order status."}, status=status.HTTP_400_BAD_REQUEST)
            if new_status == 'RECEIVED' and po.status != 'RECEIVED':
                with transaction.atomic():
                    for item in po.items:
                        product = Product.objects.select_for_update().get(pk=item.get('product_id') or item.get('product'))
                        quantity = int(item.get('quantity'))
                        product.stock_level += quantity
                        product.save(update_fields=['stock_level'])
                        InventoryEvent.objects.create(
                            event_type=InventoryEvent.STOCK_MOVEMENT,
                            product=product,
                            movement_type='IN',
                            quantity=quantity,
                            reason=f"Restock from PO #{po.id}",
                            user=request.user,
                        )
            po.status = new_status
            po.save(update_fields=['status'])
            AuditLog.objects.create(user=request.user, action="PO_UPDATE", description=f"Updated Purchase Order #{po.id} to {new_status}.")
        return Response(PurchaseOrderSerializer(po).data)
