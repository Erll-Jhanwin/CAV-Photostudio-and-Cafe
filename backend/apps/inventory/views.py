from rest_framework import generics, permissions, status
from rest_framework.response import Response
from django.db import transaction
from inventory.models import Category, Supplier, Product, StockMovement, PurchaseOrder, PurchaseOrderItem
from inventory.serializers import (
    CategorySerializer, SupplierSerializer, ProductSerializer, 
    StockMovementSerializer, PurchaseOrderSerializer
)
from audit.models import AuditLog

class ProductListCreateView(generics.ListCreateAPIView):
    queryset = Product.objects.all().select_related('category', 'supplier')
    serializer_class = ProductSerializer

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
    queryset = Product.objects.all()
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

class StockMovementListView(generics.ListCreateAPIView):
    queryset = StockMovement.objects.all().select_related('product', 'user').order_by('-timestamp')
    serializer_class = StockMovementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff can log stock movements."}, status=status.HTTP_403_FORBIDDEN)
            
        product_id = request.data.get('product')
        m_type = request.data.get('movement_type')
        qty = int(request.data.get('quantity', 0))
        reason = request.data.get('reason', 'Manual Update')
        
        try:
            product = Product.objects.get(id=product_id)
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

class CategoryListCreateView(generics.ListCreateAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

class SupplierListCreateView(generics.ListCreateAPIView):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

class PurchaseOrderListCreateView(generics.ListCreateAPIView):
    queryset = PurchaseOrder.objects.all().prefetch_related('items').order_by('-created_at')
    serializer_class = PurchaseOrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)
            
        supplier_id = request.data.get('supplier')
        notes = request.data.get('notes', '')
        items_data = request.data.get('items', [])
        
        if not items_data:
            return Response({"detail": "Cannot create empty purchase order."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            po = PurchaseOrder.objects.create(supplier_id=supplier_id, notes=notes)
            for item in items_data:
                PurchaseOrderItem.objects.create(
                    purchase_order=po,
                    product_id=item.get('product_id'),
                    quantity=item.get('quantity'),
                    cost_price=item.get('cost_price')
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
            if new_status == 'RECEIVED' and po.status != 'RECEIVED':
                # Mark as received: increment product stock levels
                with transaction.atomic():
                    for item in po.items.all():
                        product = item.product
                        product.stock_level += item.quantity
                        product.save()

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
