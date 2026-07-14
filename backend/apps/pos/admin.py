from django.contrib import admin
from pos.models import Order, OrderItem, Payment, EndOfDayReport


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ('product', 'quantity', 'price', 'subtotal')


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    readonly_fields = ('amount', 'method', 'transaction_id', 'timestamp')


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ('id', 'transaction_id', 'staff', 'total', 'payment_status', 'order_type', 'created_at')
    list_filter = ('payment_status', 'order_type', 'created_at')
    search_fields = ('transaction_id', 'staff__username')
    readonly_fields = ('transaction_id', 'completed_at')
    inlines = [OrderItemInline, PaymentInline]


@admin.register(EndOfDayReport)
class EndOfDayReportAdmin(admin.ModelAdmin):
    list_display = ('report_date', 'staff_name', 'gross_sales', 'opening_cash', 'expected_cash', 'actual_cash', 'cash_difference', 'created_at')
    list_filter = ('report_date', 'created_at')
    search_fields = ('staff_name', 'closed_by__username')
    readonly_fields = ('best_selling_items', 'print_status', 'created_at', 'printed_at')
