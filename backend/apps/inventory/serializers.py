from decimal import Decimal

from rest_framework import serializers

from inventory.models import InventoryEvent, Product


DEFAULT_CATEGORIES = [
    {'id': 1, 'name': 'Beverages', 'description': 'Espresso-based coffees, teas, and refreshers'},
    {'id': 2, 'name': 'Snacks', 'description': 'Freshly baked pastries and sandwiches'},
    {'id': 3, 'name': 'Photo Supplies', 'description': 'Studio printing paper, frames, and print assets'},
    {'id': 4, 'name': 'Raw Ingredients', 'description': 'Cafe drink and food ingredients'},
]

DEFAULT_SUPPLIERS = [
    {'id': 1, 'name': 'Manila Coffee Roasters', 'contact_person': 'Juan Dela Cruz', 'email': 'juan@manilacoffee.com', 'phone': '+639171234567', 'address': 'Quezon City, Metro Manila'},
    {'id': 2, 'name': 'Studio Paper Supplies Corp', 'contact_person': 'Maria Santos', 'email': 'maria@studiosupplies.com', 'phone': '+639187654321', 'address': 'Pasig City, Metro Manila'},
]


def category_for(category_id):
    try:
        category_id = int(category_id)
    except (TypeError, ValueError):
        return None
    return next((item for item in DEFAULT_CATEGORIES if item['id'] == category_id), None)


def supplier_for(supplier_id):
    try:
        supplier_id = int(supplier_id)
    except (TypeError, ValueError):
        return None
    return next((item for item in DEFAULT_SUPPLIERS if item['id'] == supplier_id), None)


class CategorySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)


class SupplierSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    contact_person = serializers.CharField(allow_blank=True, allow_null=True)
    email = serializers.EmailField(allow_blank=True, allow_null=True)
    phone = serializers.CharField(allow_blank=True, allow_null=True)
    address = serializers.CharField(allow_blank=True, allow_null=True)


class IngredientSerializer(serializers.ModelSerializer):
    category_details = serializers.SerializerMethodField()
    supplier_details = serializers.SerializerMethodField()
    inventory_status = serializers.CharField(read_only=True)
    inventory_status_label = serializers.CharField(read_only=True)
    suggested_action = serializers.CharField(read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'category', 'category_details', 'supplier', 'supplier_details',
            'base_unit', 'stock_quantity', 'minimum_stock_level', 'maximum_stock_level',
            'expiration_date', 'purchase_date', 'batch_number', 'storage_location',
            'inventory_status', 'inventory_status_label', 'suggested_action', 'days_until_expiry',
            'created_at', 'updated_at'
        ]

    def get_category_details(self, obj):
        return category_for(obj.category) or {'id': obj.category, 'name': obj.category_name or 'Uncategorized', 'description': obj.category_description}

    def get_supplier_details(self, obj):
        return obj.supplier_details or supplier_for(obj.supplier)

    def validate(self, attrs):
        minimum = attrs.get('minimum_stock_level', getattr(self.instance, 'minimum_stock_level', 0))
        maximum = attrs.get('maximum_stock_level', getattr(self.instance, 'maximum_stock_level', 0))
        quantity = attrs.get('stock_quantity', getattr(self.instance, 'stock_quantity', 0))
        required = {
            'name': 'Ingredient name is required.',
            'category': 'Category is required.',
            'supplier': 'Supplier is required.',
            'base_unit': 'Base unit is required.',
            'purchase_date': 'Purchase date is required.',
            'batch_number': 'Batch number is required.',
            'storage_location': 'Storage location is required.',
        }
        field_errors = {}
        for field, message in required.items():
            value = attrs.get(field, getattr(self.instance, field, None))
            if value in (None, ''):
                field_errors[field] = message
        if minimum < 0 or maximum < 0 or quantity < 0:
            field_errors['stock_quantity'] = "Stock quantities cannot be negative."
        if maximum and maximum < minimum:
            field_errors["maximum_stock_level"] = "Maximum Stock Level must be greater than or equal to Minimum Stock Level."
        purchase_date = attrs.get('purchase_date', getattr(self.instance, 'purchase_date', None))
        expiration_date = attrs.get('expiration_date', getattr(self.instance, 'expiration_date', None))
        if purchase_date and expiration_date and expiration_date < purchase_date:
            field_errors['expiration_date'] = "Expiration date cannot be before purchase date."
        if field_errors:
            raise serializers.ValidationError(field_errors)
        return attrs

    def create(self, validated_data):
        validated_data['item_type'] = Product.INGREDIENT
        validated_data['price'] = validated_data.get('price') or Decimal('0.00')
        category = category_for(validated_data.get('category'))
        if category:
            validated_data['category_name'] = category['name']
            validated_data['category_description'] = category['description']
        supplier = supplier_for(validated_data.get('supplier'))
        if supplier:
            validated_data['supplier_details'] = supplier
        return super().create(validated_data)


class RecipeIngredientSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    product = serializers.IntegerField()
    ingredient = serializers.IntegerField()
    ingredient_details = IngredientSerializer(read_only=True)
    ingredient_name = serializers.CharField(read_only=True)
    quantity = serializers.DecimalField(max_digits=10, decimal_places=2)
    base_unit = serializers.CharField(read_only=True)


class ProductSerializer(serializers.ModelSerializer):
    category_details = serializers.SerializerMethodField()
    supplier_details = serializers.SerializerMethodField()
    minimum_stock_level = serializers.IntegerField(source='reorder_point', required=False)
    inventory_status = serializers.CharField(read_only=True)
    inventory_status_label = serializers.CharField(read_only=True)
    suggested_action = serializers.CharField(read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)
    recipe_items = serializers.SerializerMethodField()
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

    def get_category_details(self, obj):
        return category_for(obj.category) or {'id': obj.category, 'name': obj.category_name or 'Uncategorized', 'description': obj.category_description}

    def get_supplier_details(self, obj):
        return obj.supplier_details or supplier_for(obj.supplier)

    def get_recipe_items(self, obj):
        ingredient_ids = [item.get('ingredient') for item in obj.recipe_data or []]
        ingredients = Product.objects.filter(id__in=ingredient_ids, item_type=Product.INGREDIENT)
        by_id = {ingredient.id: ingredient for ingredient in ingredients}
        rows = []
        for index, item in enumerate(obj.recipe_data or [], start=1):
            ingredient = by_id.get(item.get('ingredient'))
            rows.append({
                'id': item.get('id') or index,
                'product': obj.id,
                'ingredient': item.get('ingredient'),
                'ingredient_details': IngredientSerializer(ingredient).data if ingredient else None,
                'ingredient_name': ingredient.name if ingredient else item.get('ingredient_name', ''),
                'quantity': item.get('quantity'),
                'base_unit': ingredient.base_unit if ingredient else item.get('base_unit', ''),
            })
        return rows

    def get_available_servings(self, obj):
        recipe_items = obj.recipe_data or []
        if not recipe_items:
            return obj.stock_level
        ingredient_ids = [item.get('ingredient') for item in recipe_items]
        ingredients = Product.objects.filter(id__in=ingredient_ids, item_type=Product.INGREDIENT)
        by_id = {ingredient.id: ingredient for ingredient in ingredients}
        servings = []
        for item in recipe_items:
            ingredient = by_id.get(item.get('ingredient'))
            try:
                quantity = Decimal(str(item.get('quantity') or '0'))
            except Exception:
                quantity = Decimal('0')
            if ingredient and quantity > 0:
                servings.append(int(ingredient.stock_quantity // quantity))
        return min(servings) if servings else obj.stock_level

    def validate(self, attrs):
        minimum = attrs.get('reorder_point', getattr(self.instance, 'reorder_point', 0))
        maximum = attrs.get('maximum_stock_level', getattr(self.instance, 'maximum_stock_level', 0))
        quantity = attrs.get('stock_level', getattr(self.instance, 'stock_level', 0))
        if minimum < 0 or maximum < 0 or quantity < 0:
            raise serializers.ValidationError("Quantity and stock thresholds cannot be negative.")
        if maximum < minimum:
            raise serializers.ValidationError({"maximum_stock_level": "Maximum Stock Level must be greater than or equal to Minimum Stock Level."})
        return attrs

    def create(self, validated_data):
        validated_data['item_type'] = Product.PRODUCT
        category = category_for(validated_data.get('category'))
        if category:
            validated_data['category_name'] = category['name']
            validated_data['category_description'] = category['description']
        supplier = supplier_for(validated_data.get('supplier'))
        if supplier:
            validated_data['supplier_details'] = supplier
        return super().create(validated_data)


class StockMovementSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)
    product = serializers.IntegerField(source='product_id')

    class Meta:
        model = InventoryEvent
        fields = ['id', 'product', 'product_name', 'movement_type', 'quantity', 'reason', 'timestamp', 'user_name']


class IngredientStockMovementSerializer(serializers.ModelSerializer):
    ingredient = serializers.IntegerField(source='product_id')
    ingredient_name = serializers.CharField(source='product.name', read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = InventoryEvent
        fields = [
            'id', 'ingredient', 'ingredient_name', 'movement_type', 'quantity',
            'input_quantity', 'input_unit', 'reason', 'timestamp', 'user_name'
        ]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    supplier_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryEvent
        fields = ['id', 'supplier', 'supplier_name', 'status', 'notes', 'created_at', 'updated_at', 'items']

    def get_supplier_name(self, obj):
        supplier = obj.supplier_details or supplier_for(obj.supplier) or {}
        return supplier.get('name', '')
