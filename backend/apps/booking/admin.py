from django.contrib import admin
from booking.models import Service, Package, Booking, BookingItem, BookingPayment, BookingChangeLog


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ('name', 'duration_minutes', 'base_price')
    search_fields = ('name', 'description')


@admin.register(Package)
class PackageAdmin(admin.ModelAdmin):
    list_display = ('name', 'service', 'price')
    list_filter = ('service',)
    search_fields = ('name', 'description', 'inclusions')


class BookingItemInline(admin.TabularInline):
    model = BookingItem
    extra = 0


class BookingChangeLogInline(admin.TabularInline):
    model = BookingChangeLog
    extra = 0
    readonly_fields = ('changed_by', 'old_values', 'new_values', 'reason', 'created_at')
    can_delete = False


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ('id', 'customer', 'package', 'scheduled_date', 'scheduled_time', 'status', 'can_edit_display')
    list_filter = ('status', 'scheduled_date', 'package__service')
    search_fields = ('customer__username', 'customer__email', 'package__name')
    inlines = [BookingItemInline, BookingChangeLogInline]

    def can_edit_display(self, obj):
        return obj.is_customer_editable
    can_edit_display.boolean = True
    can_edit_display.short_description = 'Customer editable'


@admin.register(BookingPayment)
class BookingPaymentAdmin(admin.ModelAdmin):
    list_display = ('reference_number', 'booking', 'amount', 'status', 'paid_at', 'verified_by')
    list_filter = ('status', 'paid_at')
    search_fields = ('reference_number', 'booking__customer__username', 'booking__customer__email')


@admin.register(BookingChangeLog)
class BookingChangeLogAdmin(admin.ModelAdmin):
    list_display = ('booking', 'changed_by', 'reason', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('booking__customer__username', 'reason')
