from django.contrib import admin

from pos.models import Order, POSStockAction


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ('id', 'transaction_id', 'staff', 'order_type', 'payment_status', 'total', 'created_at')
    list_filter = ('order_type', 'payment_status')
    search_fields = ('transaction_id', 'staff__username')


@admin.register(POSStockAction)
class POSStockActionAdmin(admin.ModelAdmin):
    list_display = ('id', 'action_type', 'transaction_id', 'staff_name', 'created_at')
    list_filter = ('action_type', 'created_at')
    search_fields = ('transaction_id', 'staff_name', 'reason')
    readonly_fields = (
        'order', 'staff', 'staff_name', 'action_type', 'transaction_id', 'reason',
        'idempotency_key', 'request_fingerprint', 'items', 'created_at',
    )

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
