from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone


class Product(models.Model):
    PRODUCT = 'PRODUCT'
    INGREDIENT = 'INGREDIENT'
    ITEM_TYPES = (
        (PRODUCT, 'Product'),
        (INGREDIENT, 'Ingredient'),
    )

    name = models.CharField(max_length=150)
    sku = models.CharField(max_length=50, unique=True, blank=True, null=True)
    item_type = models.CharField(max_length=16, choices=ITEM_TYPES, default=PRODUCT)
    category = models.PositiveIntegerField(blank=True, null=True)
    category_name = models.CharField(max_length=100, blank=True)
    category_description = models.TextField(blank=True)
    supplier = models.PositiveIntegerField(blank=True, null=True)
    supplier_details = models.JSONField(default=dict, blank=True)
    unit = models.CharField(max_length=30, default='pcs')
    base_unit = models.CharField(max_length=2, blank=True)
    cost = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    stock_level = models.IntegerField(default=0)
    stock_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    reorder_point = models.IntegerField(default=5)
    minimum_stock_level = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    maximum_stock_level = models.DecimalField(max_digits=12, decimal_places=2, default=100)
    expiration_date = models.DateField(blank=True, null=True)
    purchase_date = models.DateField(blank=True, null=True)
    batch_number = models.CharField(max_length=80, blank=True)
    storage_location = models.CharField(max_length=120, blank=True)
    recipe_data = models.JSONField(default=list, blank=True)
    is_cafe_item = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    image_url = models.CharField(max_length=500, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    @staticmethod
    def convert_to_base_quantity(quantity, unit):
        unit = str(unit or '').upper()
        value = Decimal(str(quantity))
        if unit == 'KG':
            return value * Decimal('1000')
        if unit == 'L':
            return value * Decimal('1000')
        if unit in ('G', 'ML'):
            return value
        raise ValueError("Unit must be kg, g, L, or mL.")

    def convert_stock_quantity(self, quantity, unit):
        unit = str(unit or '').upper()
        if self.base_unit == 'G' and unit not in ('KG', 'G'):
            raise ValueError("Dry ingredients only accept kg or g.")
        if self.base_unit == 'ML' and unit not in ('L', 'ML'):
            raise ValueError("Liquid ingredients only accept L or mL.")
        return self.convert_to_base_quantity(quantity, unit)

    def get_base_unit_display(self):
        return {'G': 'g', 'ML': 'mL'}.get(self.base_unit, self.base_unit)

    @property
    def days_until_expiry(self):
        if not self.expiration_date:
            return None
        return (self.expiration_date - timezone.localdate()).days

    @property
    def tracked_quantity(self):
        return self.stock_quantity if self.item_type == self.INGREDIENT else Decimal(str(self.stock_level))

    @property
    def tracked_minimum(self):
        return self.minimum_stock_level if self.item_type == self.INGREDIENT else Decimal(str(self.reorder_point))

    @property
    def inventory_status(self):
        today = timezone.localdate()
        if self.expiration_date and self.expiration_date < today:
            return 'EXPIRED'
        if self.expiration_date and self.expiration_date <= today + timedelta(days=7):
            return 'NEAR_EXPIRY'
        if self.tracked_quantity <= self.tracked_minimum:
            return 'LOW_STOCK'
        if self.maximum_stock_level and self.tracked_quantity > self.maximum_stock_level:
            return 'OVERSTOCKED'
        return 'IN_STOCK'

    @property
    def inventory_status_label(self):
        return {
            'IN_STOCK': 'In Stock (Good Condition)',
            'LOW_STOCK': 'Low Stock',
            'NEAR_EXPIRY': 'Near Expiry',
            'EXPIRED': 'Expired',
            'OVERSTOCKED': 'Overstocked',
        }[self.inventory_status]

    @property
    def suggested_action(self):
        return {
            'LOW_STOCK': 'Reorder',
            'NEAR_EXPIRY': 'Prioritize Usage',
            'EXPIRED': 'Remove from Sale',
            'OVERSTOCKED': 'Reduce Purchasing',
            'IN_STOCK': 'Maintain Stock',
        }[self.inventory_status]


class InventoryEvent(models.Model):
    STOCK_MOVEMENT = 'STOCK_MOVEMENT'
    INGREDIENT_MOVEMENT = 'INGREDIENT_MOVEMENT'
    PURCHASE_ORDER = 'PURCHASE_ORDER'
    EVENT_TYPES = (
        (STOCK_MOVEMENT, 'Stock movement'),
        (INGREDIENT_MOVEMENT, 'Ingredient movement'),
        (PURCHASE_ORDER, 'Purchase order'),
    )

    event_type = models.CharField(max_length=32, choices=EVENT_TYPES)
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    movement_type = models.CharField(max_length=3, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    input_quantity = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    input_unit = models.CharField(max_length=3, blank=True)
    reason = models.CharField(max_length=150, blank=True)
    supplier = models.PositiveIntegerField(blank=True, null=True)
    supplier_details = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=15, blank=True)
    notes = models.TextField(blank=True, null=True)
    items = models.JSONField(default=list, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def timestamp(self):
        return self.created_at

    def __str__(self):
        return f"{self.event_type} #{self.id}"
