from rest_framework import serializers
from inventory.models import Category, Supplier, Product, StockMovement, PurchaseOrder, PurchaseOrderItem

class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'description']

class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ['id', 'name', 'contact_person', 'email', 'phone', 'address']

class ProductSerializer(serializers.ModelSerializer):
    category_details = CategorySerializer(source='category', read_only=True)
    supplier_details = SupplierSerializer(source='supplier', read_only=True)

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'sku', 'category', 'category_details', 'supplier', 
            'supplier_details', 'cost', 'price', 'stock_level', 'reorder_point', 
            'is_cafe_item', 'image_url'
        ]

class StockMovementSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = StockMovement
        fields = ['id', 'product', 'product_name', 'movement_type', 'quantity', 'reason', 'timestamp', 'user_name']

class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = ['id', 'product', 'product_name', 'quantity', 'cost_price']

class PurchaseOrderSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    items = PurchaseOrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = ['id', 'supplier', 'supplier_name', 'status', 'notes', 'created_at', 'updated_at', 'items']
