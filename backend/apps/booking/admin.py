from django.contrib import admin

from booking.models import Booking, BookingEmail, BookingReview, Package, Service, StudioUnavailableDate


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


@admin.register(BookingReview)
class BookingReviewAdmin(admin.ModelAdmin):
    list_display = ('id', 'booking', 'customer', 'rating', 'created_at')
    list_filter = ('rating', 'created_at')
    search_fields = ('customer__username', 'customer__email', 'feedback', 'suggestions')


@admin.register(BookingEmail)
class BookingEmailAdmin(admin.ModelAdmin):
    list_display = ('id', 'booking', 'event_type', 'recipient', 'status', 'attempt_count', 'scheduled_for', 'sent_at')
    list_filter = ('event_type', 'status')
    search_fields = ('recipient', 'event_key', 'last_error')
    readonly_fields = ('booking', 'event_type', 'event_key', 'recipient', 'scheduled_for', 'status', 'attempt_count',
                       'next_retry_at', 'sent_at', 'last_error', 'payload', 'created_at', 'updated_at')

    def has_add_permission(self, request):
        return False


@admin.register(StudioUnavailableDate)
class StudioUnavailableDateAdmin(admin.ModelAdmin):
    list_display = ('date', 'reason', 'created_by', 'created_at')
    list_filter = ('date',)
    search_fields = ('reason', 'created_by__username')
