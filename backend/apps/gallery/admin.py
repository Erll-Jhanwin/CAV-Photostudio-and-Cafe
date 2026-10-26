from django.contrib import admin

from .models import GalleryImage


@admin.register(GalleryImage)
class GalleryImageAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'is_featured', 'sort_order', 'created_at')
    list_filter = ('category', 'is_featured')
    search_fields = ('title', 'caption', 'alt_text')
    readonly_fields = ('created_at', 'updated_at', 'created_by')
