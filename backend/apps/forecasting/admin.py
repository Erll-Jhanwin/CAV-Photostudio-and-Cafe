from django.contrib import admin
from .models import SalesHistoryImport, SalesHistoryRecord


@admin.register(SalesHistoryImport)
class SalesHistoryImportAdmin(admin.ModelAdmin):
    list_display = ('source_name', 'source_filename', 'status', 'is_active', 'imported_row_count', 'created_at')
    list_filter = ('source_name', 'status', 'is_active')
    search_fields = ('source_filename', 'source_hash')
    readonly_fields = ('source_hash', 'created_at', 'completed_at')


@admin.register(SalesHistoryRecord)
class SalesHistoryRecordAdmin(admin.ModelAdmin):
    list_display = ('sale_date', 'transaction_number', 'quantity', 'total', 'import_batch')
    list_filter = ('status', 'sale_date')
    search_fields = ('transaction_number', 'items_description')
