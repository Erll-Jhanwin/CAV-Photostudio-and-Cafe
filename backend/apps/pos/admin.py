from django.contrib import admin

from pos.models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ('id', 'transaction_id', 'staff', 'order_type', 'payment_status', 'total', 'created_at')
    list_filter = ('order_type', 'payment_status')
    search_fields = ('transaction_id', 'staff__username')
