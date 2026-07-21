from django.contrib import admin

from booking.models import Booking, Package, Service, StudioUnavailableDate


class PackageInline(admin.TabularInline):
    model = Package
    extra = 0


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ('name', 'duration_minutes', 'base_price')
    search_fields = ('name',)
    inlines = [PackageInline]


@admin.register(Package)
class PackageAdmin(admin.ModelAdmin):
    list_display = ('name', 'service', 'price')
    list_filter = ('service',)
    search_fields = ('name', 'service__name')


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ('id', 'customer', 'package', 'scheduled_date', 'scheduled_time', 'status', 'created_at')
    list_filter = ('status', 'scheduled_date')
    search_fields = ('customer__username', 'customer__email', 'package__name')


@admin.register(StudioUnavailableDate)
class StudioUnavailableDateAdmin(admin.ModelAdmin):
    list_display = ('date', 'reason', 'created_by', 'created_at')
    list_filter = ('date',)
    search_fields = ('reason', 'created_by__username')
