from rest_framework import generics, permissions, status, views
from rest_framework.response import Response
from django.db import transaction
from decimal import Decimal, InvalidOperation
from inventory.models import (
    Category, Supplier, Product, StockMovement, PurchaseOrder, PurchaseOrderItem,
    Ingredient, RecipeIngredient, IngredientStockMovement
)
from inventory.serializers import (
    CategorySerializer, SupplierSerializer, ProductSerializer,
    StockMovementSerializer, PurchaseOrderSerializer, IngredientSerializer,
    RecipeIngredientSerializer, IngredientStockMovementSerializer
)
from inventory.recipe_defaults import ensure_default_ingredients_and_recipes
from audit.models import AuditLog

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
        queryset = Product.objects.filter(is_active=True).select_related('category', 'supplier').prefetch_related('recipe_items__ingredient').order_by('name')
        return apply_limit(queryset, self.request)

    def get_permissions(self):
        if self.request.method == 'GET':
            # Allow landing page to fetch products (or customers to browse the cafe menu)
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff and admins can create products."}, status=status.HTTP_403_FORBIDDEN)
        
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()

        # Create stock movement for initial stock
        if product.stock_level > 0:
            StockMovement.objects.create(
                product=product,
                movement_type='IN',
                quantity=product.stock_level,
                reason="Initial product creation",
                user=request.user
            )

        AuditLog.objects.create(
            user=request.user,
            action="PRODUCT_CREATE",
            description=f"Created product: {product.name} (SKU: {product.sku}) with stock {product.stock_level}."
        )

        return Response(serializer.data, status=status.HTTP_201_CREATED)

class ProductDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Product.objects.all().select_related('category', 'supplier').prefetch_related('recipe_items__ingredient')
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
        
        # Check if stock level was adjusted directly
        new_stock = updated_product.stock_level
        if old_stock != new_stock:
            diff = new_stock - old_stock
            m_type = 'IN' if diff > 0 else 'OUT'
            StockMovement.objects.create(
                product=updated_product,
                movement_type=m_type,
                quantity=abs(diff),
                reason="Manual inventory adjustment",
                user=request.user
            )
            
            AuditLog.objects.create(
                user=request.user,
                action="INVENTORY_ADJUST",
                description=f"Adjusted stock of {updated_product.name} from {old_stock} to {new_stock}."
            )

        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff and admins can remove products."}, status=status.HTTP_403_FORBIDDEN)
        product = self.get_object()
        product.is_active = False
        product.save(update_fields=['is_active'])
        AuditLog.objects.create(
            user=request.user,
            action="PRODUCT_DEACTIVATE",
            description=f"Deactivated product: {product.name} (SKU: {product.sku})."
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

class StockMovementListView(generics.ListCreateAPIView):
    serializer_class = StockMovementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = StockMovement.objects.select_related('product', 'user').order_by('-timestamp')
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff can log stock movements."}, status=status.HTTP_403_FORBIDDEN)
            
        product_id = request.data.get('product')
        m_type = request.data.get('movement_type')
        try:
            qty = int(request.data.get('quantity', 0))
        except (TypeError, ValueError):
            return Response({"quantity": "Quantity must be a whole number."}, status=status.HTTP_400_BAD_REQUEST)
        if qty <= 0:
            return Response({"quantity": "Quantity must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
        reason = str(request.data.get('reason', 'Manual Update') or 'Manual Update').strip()[:100]
        
        try:
            product = Product.objects.get(id=product_id, is_active=True)
        except Product.DoesNotExist:
            return Response({"detail": "Product not found."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            # Adjust stock level
            if m_type == 'IN':
                product.stock_level += qty
            elif m_type == 'OUT':
                if product.stock_level < qty:
                    return Response({"detail": "Insufficient stock level."}, status=status.HTTP_400_BAD_REQUEST)
                product.stock_level -= qty
            else:
                return Response({"detail": "Invalid movement type."}, status=status.HTTP_400_BAD_REQUEST)
            
            product.save()

            movement = StockMovement.objects.create(
                product=product,
                movement_type=m_type,
                quantity=qty,
                reason=reason,
                user=request.user
            )

            AuditLog.objects.create(
                user=request.user,
                action="STOCK_MOVEMENT",
                description=f"Stock {m_type}: {product.name} x {qty} ({reason})."
            )

        return Response(StockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)

class IngredientListCreateView(generics.ListCreateAPIView):
    serializer_class = IngredientSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Ingredient.objects.all().select_related('category', 'supplier').order_by('name')
        return apply_limit(queryset, self.request)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

class IngredientDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Ingredient.objects.all().select_related('category', 'supplier')
    serializer_class = IngredientSerializer
    permission_classes = [permissions.IsAuthenticated]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)

        ingredient = self.get_object()
        tracked_fields = [
            'name', 'category_id', 'supplier_id', 'base_unit', 'stock_quantity',
            'minimum_stock_level', 'maximum_stock_level', 'expiration_date',
            'purchase_date', 'batch_number', 'storage_location'
        ]
        before = {field: getattr(ingredient, field) for field in tracked_fields}

        response = super().update(request, *args, **kwargs)

        ingredient.refresh_from_db()
        changes = []
        for field in tracked_fields:
            old_value = before[field]
            new_value = getattr(ingredient, field)
            if old_value != new_value:
                changes.append(f"{field}: {old_value or '-'} -> {new_value or '-'}")

        if changes:
            AuditLog.objects.create(
                user=request.user,
                action="INGREDIENT_UPDATE",
                description=f"Updated ingredient {ingredient.name} (#{ingredient.id}): " + "; ".join(changes)
            )

        return response

    def destroy(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

class RecipeIngredientListCreateView(generics.ListCreateAPIView):
    serializer_class = RecipeIngredientSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = RecipeIngredient.objects.all().select_related('product', 'ingredient')
        product_id = self.request.query_params.get('product')
        if product_id:
            queryset = queryset.filter(product_id=product_id)
        return queryset.order_by('product__name', 'ingredient__name')

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

class IngredientStockMovementListView(generics.ListCreateAPIView):
    serializer_class = IngredientStockMovementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = IngredientStockMovement.objects.select_related('ingredient', 'user').order_by('-timestamp')
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)

        ingredient_id = request.data.get('ingredient')
        movement_type = request.data.get('movement_type')
        input_quantity = request.data.get('quantity', request.data.get('input_quantity', 0))
        input_unit = request.data.get('unit', request.data.get('input_unit', '')).upper()
        reason = str(request.data.get('reason', 'Manual ingredient adjustment') or 'Manual ingredient adjustment').strip()[:150]

        if movement_type not in ('IN', 'OUT'):
            return Response({"detail": "Invalid movement type."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                ingredient = Ingredient.objects.select_for_update().get(id=ingredient_id)
                quantity = ingredient.convert_stock_quantity(input_quantity, input_unit)
            except Ingredient.DoesNotExist:
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
            ingredient.save()

            movement = IngredientStockMovement.objects.create(
                ingredient=ingredient,
                movement_type=movement_type,
                quantity=quantity,
                input_quantity=input_quantity,
                input_unit=input_unit,
                reason=reason,
                user=request.user
            )

            AuditLog.objects.create(
                user=request.user,
                action="INGREDIENT_STOCK_MOVEMENT",
                description=f"Ingredient stock {movement_type}: {ingredient.name} {quantity} {ingredient.get_base_unit_display()} ({reason})."
            )

        return Response(IngredientStockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)

class GenerateRecipeIngredientsView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        generated = ensure_default_ingredients_and_recipes()
        if generated:
            AuditLog.objects.create(
                user=request.user,
                action="RECIPE_GENERATE",
                description=f"Generated default ingredient recipes ({generated} new links)."
            )
        return Response({"message": "Raw ingredient list and drink recipes generated.", "created_recipe_items": generated})

class CategoryListCreateView(generics.ListCreateAPIView):
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Category.objects.all().order_by('name')

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

class SupplierListCreateView(generics.ListCreateAPIView):
    serializer_class = SupplierSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Supplier.objects.all().order_by('name')

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

class PurchaseOrderListCreateView(generics.ListCreateAPIView):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = PurchaseOrder.objects.select_related('supplier').prefetch_related('items__product').order_by('-created_at')
        return apply_limit(queryset, self.request, default=100)

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
            
        supplier_id = request.data.get('supplier')
        notes = request.data.get('notes', '')
        items_data = request.data.get('items', [])
        
        if not items_data:
            return Response({"detail": "Cannot create empty purchase order."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(items_data, list):
            return Response({"items": "Items must be a list."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            supplier = Supplier.objects.get(id=supplier_id)
        except Supplier.DoesNotExist:
            return Response({"supplier": "Supplier not found."}, status=status.HTTP_404_NOT_FOUND)

        normalized_items = []
        for item in items_data:
            if not isinstance(item, dict):
                return Response({"items": "Each item must be an object."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                product_id = int(item.get('product_id'))
                quantity = int(item.get('quantity'))
                cost_price = Decimal(str(item.get('cost_price')))
            except (TypeError, ValueError, InvalidOperation):
                return Response({"items": "Each item needs valid product, quantity, and cost price."}, status=status.HTTP_400_BAD_REQUEST)
            if quantity <= 0 or cost_price < 0:
                return Response({"items": "Quantity must be greater than zero and cost price cannot be negative."}, status=status.HTTP_400_BAD_REQUEST)
            if not Product.objects.filter(id=product_id, is_active=True).exists():
                return Response({"product": f"Product with ID {product_id} not found."}, status=status.HTTP_404_NOT_FOUND)
            normalized_items.append({"product_id": product_id, "quantity": quantity, "cost_price": cost_price})

        with transaction.atomic():
            po = PurchaseOrder.objects.create(supplier=supplier, notes=str(notes or '').strip()[:1000])
            for item in normalized_items:
                PurchaseOrderItem.objects.create(
                    purchase_order=po,
                    product_id=item['product_id'],
                    quantity=item['quantity'],
                    cost_price=item['cost_price']
                )
            
            AuditLog.objects.create(
                user=request.user,
                action="PO_CREATE",
                description=f"Created Purchase Order #{po.id} for supplier."
            )

        return Response(PurchaseOrderSerializer(po).data, status=status.HTTP_201_CREATED)

class PurchaseOrderDetailUpdateView(generics.RetrieveUpdateAPIView):
    queryset = PurchaseOrder.objects.all()
    serializer_class = PurchaseOrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)

        po = self.get_object()
        new_status = request.data.get('status')

        if new_status and po.status != new_status:
            if new_status not in {choice[0] for choice in PurchaseOrder.STATUS_CHOICES}:
                return Response({"status": "Invalid purchase order status."}, status=status.HTTP_400_BAD_REQUEST)
            if new_status == 'RECEIVED' and po.status != 'RECEIVED':
                # Mark as received: increment product stock levels
                with transaction.atomic():
                    for item in po.items.select_related('product').select_for_update():
                        product = Product.objects.select_for_update().get(pk=item.product_id)
                        product.stock_level += item.quantity
                        product.save(update_fields=['stock_level'])

                        # Log stock movement
                        StockMovement.objects.create(
                            product=product,
                            movement_type='IN',
                            quantity=item.quantity,
                            reason=f"Restock from PO #{po.id}",
                            user=request.user
                        )
                    
                    po.status = 'RECEIVED'
                    po.save()

                    AuditLog.objects.create(
                        user=request.user,
                        action="PO_RECEIVE",
                        description=f"Received Purchase Order #{po.id}. Stock updated."
                    )
            else:
                po.status = new_status
                po.save()

        return Response(PurchaseOrderSerializer(po).data)
