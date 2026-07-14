from rest_framework import serializers
from inventory.models import (
    Category, Supplier, Product, StockMovement, PurchaseOrder, PurchaseOrderItem,
    Ingredient, RecipeIngredient, IngredientStockMovement
)

class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'description']

class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ['id', 'name', 'contact_person', 'email', 'phone', 'address']

class IngredientSerializer(serializers.ModelSerializer):
    category_details = CategorySerializer(source='category', read_only=True)
    supplier_details = SupplierSerializer(source='supplier', read_only=True)
    inventory_status = serializers.CharField(read_only=True)
    inventory_status_label = serializers.CharField(read_only=True)
    suggested_action = serializers.CharField(read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)

    class Meta:
        model = Ingredient
        fields = [
            'id', 'name', 'category', 'category_details', 'supplier', 'supplier_details',
            'base_unit', 'stock_quantity', 'minimum_stock_level', 'maximum_stock_level',
            'expiration_date', 'purchase_date', 'batch_number', 'storage_location',
            'inventory_status', 'inventory_status_label', 'suggested_action', 'days_until_expiry',
            'created_at', 'updated_at'
        ]

    def validate(self, attrs):
        if self.instance is None:
            required_fields = {
                'name': 'Ingredient Name is required.',
                'category': 'Category is required.',
                'supplier': 'Supplier is required.',
                'base_unit': 'Unit is required.',
                'stock_quantity': 'Quantity is required.',
                'minimum_stock_level': 'Minimum Stock Level is required.',
                'maximum_stock_level': 'Maximum Stock Level is required.',
                'purchase_date': 'Purchase Date is required.',
                'batch_number': 'Batch Number is required.',
                'storage_location': 'Storage Location is required.',
            }
            errors = {}
            for field, message in required_fields.items():
                if field not in attrs or attrs.get(field) in ('', None):
                    errors[field] = message
            if errors:
                raise serializers.ValidationError(errors)

        minimum = attrs.get('minimum_stock_level', getattr(self.instance, 'minimum_stock_level', 0))
        maximum = attrs.get('maximum_stock_level', getattr(self.instance, 'maximum_stock_level', 0))
        quantity = attrs.get('stock_quantity', getattr(self.instance, 'stock_quantity', 0))
        if minimum < 0 or maximum < 0 or quantity < 0:
            raise serializers.ValidationError("Stock quantities cannot be negative.")
        if maximum and maximum < minimum:
            raise serializers.ValidationError({"maximum_stock_level": "Maximum Stock Level must be greater than or equal to Minimum Stock Level."})
        return attrs

class RecipeIngredientSerializer(serializers.ModelSerializer):
    ingredient_details = IngredientSerializer(source='ingredient', read_only=True)
    ingredient_name = serializers.CharField(source='ingredient.name', read_only=True)
    base_unit = serializers.CharField(source='ingredient.base_unit', read_only=True)

    class Meta:
        model = RecipeIngredient
        fields = ['id', 'product', 'ingredient', 'ingredient_details', 'ingredient_name', 'quantity', 'base_unit']

class ProductSerializer(serializers.ModelSerializer):
    category_details = CategorySerializer(source='category', read_only=True)
    supplier_details = SupplierSerializer(source='supplier', read_only=True)
    recipe_items = RecipeIngredientSerializer(many=True, read_only=True)
    minimum_stock_level = serializers.IntegerField(source='reorder_point', required=False)
    inventory_status = serializers.CharField(read_only=True)
    inventory_status_label = serializers.CharField(read_only=True)
    suggested_action = serializers.CharField(read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)
    available_servings = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'sku', 'category', 'category_details', 'supplier', 
            'supplier_details', 'unit', 'cost', 'price', 'stock_level', 'reorder_point',
            'minimum_stock_level', 'maximum_stock_level', 'expiration_date', 'purchase_date',
            'batch_number', 'storage_location', 'inventory_status', 'inventory_status_label',
            'suggested_action', 'days_until_expiry', 'recipe_items', 'available_servings',
            'is_cafe_item', 'is_active', 'image_url'
        ]

    def get_available_servings(self, obj):
        recipe_items = list(getattr(obj, 'recipe_items', []).all()) if hasattr(getattr(obj, 'recipe_items', None), 'all') else []
        if not recipe_items:
            return obj.stock_level
        servings = []
        for recipe_item in recipe_items:
            if recipe_item.quantity <= 0:
                continue
            servings.append(int(recipe_item.ingredient.stock_quantity // recipe_item.quantity))
        return min(servings) if servings else 0

    def validate(self, attrs):
        if self.instance is None:
            required_fields = {
                'name': 'Product Name is required.',
                'category': 'Category is required.',
                'supplier': 'Supplier is required.',
                'unit': 'Unit is required.',
                'stock_level': 'Quantity is required.',
                'reorder_point': 'Minimum Stock Level is required.',
                'maximum_stock_level': 'Maximum Stock Level is required.',
                'purchase_date': 'Purchase Date is required.',
                'batch_number': 'Batch Number is required.',
                'storage_location': 'Storage Location is required.',
            }
            errors = {}
            for field, message in required_fields.items():
                if field not in attrs or attrs.get(field) in ('', None):
                    errors[field] = message
            if errors:
                raise serializers.ValidationError(errors)

        minimum = attrs.get('reorder_point', getattr(self.instance, 'reorder_point', 0))
        maximum = attrs.get('maximum_stock_level', getattr(self.instance, 'maximum_stock_level', 0))
        quantity = attrs.get('stock_level', getattr(self.instance, 'stock_level', 0))
        if minimum < 0 or maximum < 0 or quantity < 0:
            raise serializers.ValidationError("Quantity and stock thresholds cannot be negative.")
        if maximum < minimum:
            raise serializers.ValidationError({"maximum_stock_level": "Maximum Stock Level must be greater than or equal to Minimum Stock Level."})
        return attrs

class StockMovementSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = StockMovement
        fields = ['id', 'product', 'product_name', 'movement_type', 'quantity', 'reason', 'timestamp', 'user_name']

class IngredientStockMovementSerializer(serializers.ModelSerializer):
    ingredient_name = serializers.CharField(source='ingredient.name', read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = IngredientStockMovement
        fields = [
            'id', 'ingredient', 'ingredient_name', 'movement_type', 'quantity',
            'input_quantity', 'input_unit', 'reason', 'timestamp', 'user_name'
        ]

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
