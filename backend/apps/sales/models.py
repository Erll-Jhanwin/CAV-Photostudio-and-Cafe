from django.db import models

class DailySalesSummary(models.Model):
    date = models.DateField(unique=True)
    total_revenue = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    pos_revenue = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    booking_revenue = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    transaction_count = models.IntegerField(default=0)

    class Meta:
        verbose_name_plural = "Daily Sales Summaries"
        ordering = ['-date']

    def __str__(self):
        return f"Daily Summary: {self.date} - Total: PHP {self.total_revenue}"
