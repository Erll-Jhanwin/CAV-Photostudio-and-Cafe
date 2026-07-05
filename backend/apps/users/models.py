from django.db import models
from django.contrib.auth.models import AbstractUser

class CustomUser(AbstractUser):
    ROLE_CHOICES = (
        ('CUSTOMER', 'Customer'),
        ('STAFF', 'Staff'),
        ('ADMIN', 'Admin'),
    )
    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default='CUSTOMER')
    phone_number = models.CharField(max_length=20, blank=True, null=True)
    address = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

class Customer(models.Model):
    user = models.OneToOneField(CustomUser, on_delete=models.CASCADE, related_name='customer_profile')
    points = models.IntegerField(default=0)
    birthdate = models.DateField(null=True, blank=True)
    loyalty_tier = models.CharField(max_length=20, default='Bronze')
    notes = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"Customer Profile: {self.user.username}"
