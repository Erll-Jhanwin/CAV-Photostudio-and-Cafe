from django.contrib import admin
from gallery.models import GalleryImage


@admin.register(GalleryImage)
class GalleryImageAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'is_featured', 'sort_order', 'created_at')
    list_filter = ('category', 'is_featured', 'created_at')
    search_fields = ('title', 'caption', 'alt_text')
    list_editable = ('is_featured', 'sort_order')
    ordering = ('sort_order', '-created_at')
