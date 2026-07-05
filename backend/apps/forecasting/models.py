from django.db import models
from inventory.models import Product

class SalesPrediction(models.Model):
    target_date = models.DateField(unique=True)
    predicted_sales = models.DecimalField(max_digits=12, decimal_places=2)
    lower_bound = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    upper_bound = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['target_date']

    def __str__(self):
        return f"Sales Forecast for {self.target_date}: PHP {self.predicted_sales}"

class DemandPrediction(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='demand_predictions')
    target_date = models.DateField()
    predicted_quantity = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('product', 'target_date')
        ordering = ['target_date']

    def __str__(self):
        return f"Demand Forecast for {self.product.name} on {self.target_date}: {self.predicted_quantity} units"
