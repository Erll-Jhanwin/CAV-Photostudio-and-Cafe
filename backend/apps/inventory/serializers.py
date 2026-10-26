from decimal import Decimal

from rest_framework import serializers

from inventory.models import Category, InventoryEvent, Product, Supplier


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
    category = Category.objects.filter(pk=category_id).values(
        'id', 'name', 'description', 'is_active'
    ).first()
    if category:
        return category
    return next((item for item in DEFAULT_CATEGORIES if item['id'] == category_id), None)


def supplier_for(supplier_id):
    try:
        supplier_id = int(supplier_id)
    except (TypeError, ValueError):
        return None
    supplier = Supplier.objects.filter(pk=supplier_id).values(
        'id', 'name', 'contact_person', 'email', 'phone', 'address', 'is_active'
    ).first()
    if supplier:
        return supplier
    return next((item for item in DEFAULT_SUPPLIERS if item['id'] == supplier_id), None)


def _reference_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def prime_product_reference_cache(context, products, *, include_recipes=True, include_suppliers=True):
    """Bulk-load catalog references used by product serializers."""
    category_ids, supplier_ids, ingredient_ids = set(), set(), set()
    for product in products:
        category_id = _reference_id(product.category)
        supplier_id = _reference_id(product.supplier)
        if category_id is not None:
            category_ids.add(category_id)
        if include_suppliers and supplier_id is not None and not product.supplier_details:
            supplier_ids.add(supplier_id)
        if include_recipes:
            for recipe_item in product.recipe_data or []:
                ingredient_id = _reference_id(recipe_item.get('ingredient')) if isinstance(recipe_item, dict) else None
                if ingredient_id is not None:
                    ingredient_ids.add(ingredient_id)

    context['_inventory_category_cache'] = {
        row['id']: row for row in Category.objects.filter(pk__in=category_ids).values(
            'id', 'name', 'description', 'is_active'
        )
    }
    context['_inventory_supplier_cache'] = {
        row['id']: row for row in Supplier.objects.filter(pk__in=supplier_ids).values(
            'id', 'name', 'contact_person', 'email', 'phone', 'address', 'is_active'
        )
    }
    context['_inventory_ingredient_cache'] = {
        ingredient.id: ingredient
        for ingredient in Product.objects.filter(pk__in=ingredient_ids, item_type=Product.INGREDIENT)
    }


def _reference_from_cache(context, cache_key, value, defaults, fallback):
    reference_id = _reference_id(value)
    if reference_id is None:
        return None
    if cache_key not in context:
        return fallback(value)
    return context[cache_key].get(reference_id) or next(
        (item for item in defaults if item['id'] == reference_id), None
    )


class ProductReferenceListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        rows = list(data)
        prime_product_reference_cache(
            self.context,
            rows,
            include_recipes=getattr(self.child, 'preload_recipe_references', True),
            include_suppliers=getattr(self.child, 'preload_supplier_references', True),
        )
        return super().to_representation(rows)


def active_category(category_id):
    if category_id in (None, ''):
        return None
    return Category.objects.filter(pk=category_id, is_active=True).first()


def active_supplier(supplier_id):
    if supplier_id in (None, ''):
        return None
    return Supplier.objects.filter(pk=supplier_id, is_active=True).first()


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'description', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Category name is required.')
        return value


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            'id', 'name', 'contact_person', 'email', 'phone', 'address',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Supplier name is required.')
        return value


class IngredientSerializer(serializers.ModelSerializer):
    preload_recipe_references = False
    category_details = serializers.SerializerMethodField()
    supplier_details = serializers.SerializerMethodField()
    inventory_status = serializers.CharField(read_only=True)
    inventory_status_label = serializers.CharField(read_only=True)
    suggested_action = serializers.CharField(read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        list_serializer_class = ProductReferenceListSerializer
        fields = [
            'id', 'name', 'category', 'category_details', 'supplier', 'supplier_details',
            'base_unit', 'stock_quantity', 'minimum_stock_level', 'maximum_stock_level',
            'expiration_date', 'purchase_date', 'batch_number', 'storage_location',
            'inventory_status', 'inventory_status_label', 'suggested_action', 'days_until_expiry',
            'created_at', 'updated_at'
        ]

    def get_category_details(self, obj):
        return _reference_from_cache(
            self.context, '_inventory_category_cache', obj.category, DEFAULT_CATEGORIES, category_for
        ) or {'id': obj.category, 'name': obj.category_name or 'Uncategorized', 'description': obj.category_description}

    def get_supplier_details(self, obj):
        return obj.supplier_details or _reference_from_cache(
            self.context, '_inventory_supplier_cache', obj.supplier, DEFAULT_SUPPLIERS, supplier_for
        )

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
        category_id = attrs.get('category', getattr(self.instance, 'category', None))
        supplier_id = attrs.get('supplier', getattr(self.instance, 'supplier', None))
        if category_id is not None and not active_category(category_id):
            field_errors['category'] = 'Select an active category.'
        if supplier_id is not None and not active_supplier(supplier_id):
            field_errors['supplier'] = 'Select an active supplier.'
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

    def update(self, instance, validated_data):
        updated = super().update(instance, validated_data)
        category = category_for(updated.category)
        updated.category_name = category.get('name', '') if category else ''
        updated.category_description = category.get('description', '') if category else ''
        updated.supplier_details = supplier_for(updated.supplier) or {}
        updated.save(update_fields=['category_name', 'category_description', 'supplier_details', 'updated_at'])
        return updated


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
        list_serializer_class = ProductReferenceListSerializer
        fields = [
            'id', 'name', 'sku', 'category', 'category_details', 'supplier',
            'supplier_details', 'unit', 'cost', 'price', 'stock_level', 'reorder_point',
            'minimum_stock_level', 'maximum_stock_level', 'expiration_date', 'purchase_date',
            'batch_number', 'storage_location', 'inventory_status', 'inventory_status_label',
            'suggested_action', 'days_until_expiry', 'recipe_items', 'available_servings',
            'is_cafe_item', 'is_active', 'image_url'
        ]

    def get_category_details(self, obj):
        return _reference_from_cache(
            self.context, '_inventory_category_cache', obj.category, DEFAULT_CATEGORIES, category_for
        ) or {'id': obj.category, 'name': obj.category_name or 'Uncategorized', 'description': obj.category_description}

    def get_supplier_details(self, obj):
        return obj.supplier_details or _reference_from_cache(
            self.context, '_inventory_supplier_cache', obj.supplier, DEFAULT_SUPPLIERS, supplier_for
        )

    def get_recipe_items(self, obj):
        by_id = self._ingredients_by_id(obj)
        rows = []
        for index, item in enumerate(obj.recipe_data or [], start=1):
            ingredient = by_id.get(item.get('ingredient'))
            rows.append({
                'id': item.get('id') or index,
                'product': obj.id,
                'ingredient': item.get('ingredient'),
                'ingredient_details': IngredientSerializer(ingredient, context=self.context).data if ingredient else None,
                'ingredient_name': ingredient.name if ingredient else item.get('ingredient_name', ''),
                'quantity': item.get('quantity'),
                'base_unit': ingredient.base_unit if ingredient else item.get('base_unit', ''),
            })
        return rows

    def get_available_servings(self, obj):
        recipe_items = obj.recipe_data or []
        if not recipe_items:
            return obj.stock_level
        by_id = self._ingredients_by_id(obj)
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

    def _ingredients_by_id(self, obj):
        if '_inventory_ingredient_cache' in self.context:
            return self.context['_inventory_ingredient_cache']
        ingredient_ids = {
            _reference_id(item.get('ingredient'))
            for item in obj.recipe_data or []
            if isinstance(item, dict)
        }
        ingredient_ids.discard(None)
        by_id = {
            ingredient.id: ingredient
            for ingredient in Product.objects.filter(pk__in=ingredient_ids, item_type=Product.INGREDIENT)
        }
        self.context['_inventory_ingredient_cache'] = by_id
        return by_id

    def validate(self, attrs):
        minimum = attrs.get('reorder_point', getattr(self.instance, 'reorder_point', 0))
        maximum = attrs.get('maximum_stock_level', getattr(self.instance, 'maximum_stock_level', 0))
        quantity = attrs.get('stock_level', getattr(self.instance, 'stock_level', 0))
        if minimum < 0 or maximum < 0 or quantity < 0:
            raise serializers.ValidationError("Quantity and stock thresholds cannot be negative.")
        if maximum < minimum:
            raise serializers.ValidationError({"maximum_stock_level": "Maximum Stock Level must be greater than or equal to Minimum Stock Level."})
        category_id = attrs.get('category', getattr(self.instance, 'category', None))
        supplier_id = attrs.get('supplier', getattr(self.instance, 'supplier', None))
        reference_errors = {}
        if category_id is not None and not active_category(category_id):
            reference_errors['category'] = 'Select an active category.'
        if supplier_id is not None and not active_supplier(supplier_id):
            reference_errors['supplier'] = 'Select an active supplier.'
        if reference_errors:
            raise serializers.ValidationError(reference_errors)
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

    def update(self, instance, validated_data):
        updated = super().update(instance, validated_data)
        category = category_for(updated.category)
        updated.category_name = category.get('name', '') if category else ''
        updated.category_description = category.get('description', '') if category else ''
        updated.supplier_details = supplier_for(updated.supplier) or {}
        updated.save(update_fields=['category_name', 'category_description', 'supplier_details', 'updated_at'])
        return updated


class PublicProductSerializer(serializers.ModelSerializer):
    """Expose only menu-safe fields to anonymous visitors."""

    preload_recipe_references = False
    preload_supplier_references = False
    category_details = serializers.SerializerMethodField()

    class Meta:
        model = Product
        list_serializer_class = ProductReferenceListSerializer
        fields = ['id', 'name', 'category', 'category_details', 'price', 'is_cafe_item', 'is_active', 'image_url']

    def get_category_details(self, obj):
        return _reference_from_cache(
            self.context, '_inventory_category_cache', obj.category, DEFAULT_CATEGORIES, category_for
        ) or {'id': obj.category, 'name': obj.category_name or 'Uncategorized', 'description': obj.category_description}


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
    supplier_details = serializers.JSONField(read_only=True)
    total_quantity = serializers.SerializerMethodField()
    total_value = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = InventoryEvent
        fields = [
            'id', 'supplier', 'supplier_name', 'supplier_details', 'status', 'notes',
            'created_at', 'updated_at', 'items', 'total_quantity', 'total_value', 'can_edit'
        ]

    def get_supplier_name(self, obj):
        supplier = obj.supplier_details or supplier_for(obj.supplier) or {}
        return supplier.get('name', '')

    def get_total_quantity(self, obj):
        return sum(int(item.get('quantity') or 0) for item in (obj.items or []) if isinstance(item, dict))

    def get_total_value(self, obj):
        return sum(Decimal(str(item.get('line_total') or 0)) for item in (obj.items or []) if isinstance(item, dict))

    def get_can_edit(self, obj):
        return obj.status == 'ORDERED'
