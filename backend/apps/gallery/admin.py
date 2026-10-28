from django.contrib import admin

from .models import CustomerPhoto, GalleryImage


@admin.register(GalleryImage)
class GalleryImageAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'is_featured', 'sort_order', 'created_at')
    list_filter = ('category', 'is_featured')
    search_fields = ('title', 'caption', 'alt_text')
    readonly_fields = ('created_at', 'updated_at', 'created_by')


@admin.register(CustomerPhoto)
class CustomerPhotoAdmin(admin.ModelAdmin):
    list_display = ('id', 'booking', 'title', 'uploaded_by', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('booking__customer__username', 'booking__customer__email', 'title')
    readonly_fields = ('created_at',)
