from django.db import models
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from decimal import Decimal

class Supplier(models.Model):
    name = models.CharField(max_length=150)
    contact_person = models.CharField(max_length=100, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=30, blank=True, null=True)
    address = models.TextField(blank=True, null=True)

    def __str__(self):
        return self.name

class Category(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "Categories"

    def __str__(self):
        return self.name

class Product(models.Model):
    name = models.CharField(max_length=150)
    sku = models.CharField(max_length=50, unique=True, blank=True, null=True)
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='products')
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, blank=True, null=True, related_name='products')
    unit = models.CharField(max_length=30, default='pcs')
    cost = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    stock_level = models.IntegerField(default=0)
    reorder_point = models.IntegerField(default=5)
    maximum_stock_level = models.IntegerField(default=100)
    expiration_date = models.DateField(blank=True, null=True)
    purchase_date = models.DateField(blank=True, null=True)
    batch_number = models.CharField(max_length=80, blank=True)
    storage_location = models.CharField(max_length=120, blank=True)
    is_cafe_item = models.BooleanField(default=True, help_text="True if sold in café, False if studio prop or equipment")
    is_active = models.BooleanField(default=True)
    image_url = models.CharField(max_length=500, blank=True, null=True)

    def __str__(self):
        return self.name

    @property
    def days_until_expiry(self):
        if not self.expiration_date:
            return None
        return (self.expiration_date - timezone.localdate()).days

    @property
    def inventory_status(self):
        today = timezone.localdate()
        if self.expiration_date and self.expiration_date < today:
            return 'EXPIRED'
        if self.expiration_date and self.expiration_date <= today + timedelta(days=7):
            return 'NEAR_EXPIRY'
        if self.stock_level <= self.reorder_point:
            return 'LOW_STOCK'
        if self.maximum_stock_level and self.stock_level > self.maximum_stock_level:
            return 'OVERSTOCKED'
        return 'IN_STOCK'

    @property
    def inventory_status_label(self):
        labels = {
            'IN_STOCK': 'In Stock (Good Condition)',
            'LOW_STOCK': 'Low Stock',
            'NEAR_EXPIRY': 'Near Expiry',
            'EXPIRED': 'Expired',
            'OVERSTOCKED': 'Overstocked',
        }
        return labels[self.inventory_status]

    @property
    def suggested_action(self):
        actions = {
            'LOW_STOCK': 'Reorder',
            'NEAR_EXPIRY': 'Prioritize Usage',
            'EXPIRED': 'Remove from Sale',
            'OVERSTOCKED': 'Reduce Purchasing',
            'IN_STOCK': 'Maintain Stock',
        }
        return actions[self.inventory_status]

class Ingredient(models.Model):
    UNIT_CHOICES = (
        ('G', 'g'),
        ('ML', 'mL'),
    )
    name = models.CharField(max_length=150, unique=True)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, blank=True, null=True, related_name='ingredients')
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, blank=True, null=True, related_name='ingredients')
    base_unit = models.CharField(max_length=2, choices=UNIT_CHOICES)
    stock_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    minimum_stock_level = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    maximum_stock_level = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    expiration_date = models.DateField(blank=True, null=True)
    purchase_date = models.DateField(blank=True, null=True)
    batch_number = models.CharField(max_length=80, blank=True)
    storage_location = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.get_base_unit_display()})"

    @staticmethod
    def convert_to_base_quantity(quantity, unit):
        unit = unit.upper()
        value = Decimal(str(quantity))
        if unit == 'KG':
            return value * Decimal('1000')
        if unit == 'L':
            return value * Decimal('1000')
        if unit in ('G', 'ML'):
            return value
        raise ValueError("Unit must be kg, g, L, or mL.")

    def convert_stock_quantity(self, quantity, unit):
        unit = unit.upper()
        if self.base_unit == 'G' and unit not in ('KG', 'G'):
            raise ValueError("Dry ingredients only accept kg or g.")
        if self.base_unit == 'ML' and unit not in ('L', 'ML'):
            raise ValueError("Liquid ingredients only accept L or mL.")
        return self.convert_to_base_quantity(quantity, unit)

    @property
    def days_until_expiry(self):
        if not self.expiration_date:
            return None
        return (self.expiration_date - timezone.localdate()).days

    @property
    def inventory_status(self):
        today = timezone.localdate()
        if self.expiration_date and self.expiration_date < today:
            return 'EXPIRED'
        if self.expiration_date and self.expiration_date <= today + timedelta(days=7):
            return 'NEAR_EXPIRY'
        if self.stock_quantity <= self.minimum_stock_level:
            return 'LOW_STOCK'
        if self.maximum_stock_level and self.stock_quantity > self.maximum_stock_level:
            return 'OVERSTOCKED'
        return 'IN_STOCK'

    @property
    def inventory_status_label(self):
        labels = {
            'IN_STOCK': 'In Stock (Good Condition)',
            'LOW_STOCK': 'Low Stock',
            'NEAR_EXPIRY': 'Near Expiry',
            'EXPIRED': 'Expired',
            'OVERSTOCKED': 'Overstocked',
        }
        return labels[self.inventory_status]

    @property
    def suggested_action(self):
        actions = {
            'LOW_STOCK': 'Reorder',
            'NEAR_EXPIRY': 'Prioritize Usage',
            'EXPIRED': 'Remove from Sale',
            'OVERSTOCKED': 'Reduce Purchasing',
            'IN_STOCK': 'Maintain Stock',
        }
        return actions[self.inventory_status]

class RecipeIngredient(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='recipe_items')
    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name='recipe_items')
    quantity = models.DecimalField(max_digits=10, decimal_places=2, help_text="Quantity in ingredient base unit per drink")

    class Meta:
        unique_together = ('product', 'ingredient')

    def __str__(self):
        return f"{self.product.name}: {self.quantity} {self.ingredient.get_base_unit_display()} {self.ingredient.name}"

class IngredientStockMovement(models.Model):
    MOVEMENT_TYPES = (
        ('IN', 'Stock In'),
        ('OUT', 'Stock Out'),
    )
    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name='movements')
    movement_type = models.CharField(max_length=3, choices=MOVEMENT_TYPES)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    input_quantity = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    input_unit = models.CharField(max_length=3, blank=True)
    reason = models.CharField(max_length=150)
    timestamp = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)

    def __str__(self):
        return f"{self.ingredient.name} - {self.get_movement_type_display()} {self.quantity} {self.ingredient.get_base_unit_display()}"

class StockMovement(models.Model):
    MOVEMENT_TYPES = (
        ('IN', 'Stock In'),
        ('OUT', 'Stock Out'),
    )
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='movements')
    movement_type = models.CharField(max_length=3, choices=MOVEMENT_TYPES)
    quantity = models.IntegerField()
    reason = models.CharField(max_length=100, help_text="e.g. Sale, Damage, Restock")
    timestamp = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)

    def __str__(self):
        return f"{self.product.name} - {self.get_movement_type_display()} x {self.quantity} on {self.timestamp.date()}"

class PurchaseOrder(models.Model):
    STATUS_CHOICES = (
        ('ORDERED', 'Ordered'),
        ('RECEIVED', 'Received'),
        ('CANCELLED', 'Cancelled'),
    )
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='purchase_orders')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='ORDERED')
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"PO #{self.id} - {self.supplier.name} ({self.get_status_display()})"

class PurchaseOrderItem(models.Model):
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    quantity = models.IntegerField()
    cost_price = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"PO #{self.purchase_order.id} item: {self.product.name} x {self.quantity}"
