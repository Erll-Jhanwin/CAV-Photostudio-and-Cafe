from django.contrib import admin

from payment.models import Payment


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ('id', 'payment_type', 'amount', 'method', 'status', 'created_at')
    list_filter = ('payment_type', 'method', 'status')
    search_fields = ('reference_number', 'transaction_id')

