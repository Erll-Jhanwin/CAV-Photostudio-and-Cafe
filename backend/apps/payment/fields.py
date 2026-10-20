from django.db import models

from payment.storage import SupabasePaymentProofStorage


class SupabaseReceiptFileField(models.FileField):
    """FileField persisted as its existing name column, stored remotely."""

    def __init__(self, *args, **kwargs):
        kwargs['storage'] = SupabasePaymentProofStorage()
        super().__init__(*args, **kwargs)

    def deconstruct(self):
        name, _path, args, kwargs = super().deconstruct()
        # Storage is an operational backend, not a database schema change.
        # Keep migration state identical to the existing Django FileField.
        kwargs.pop('storage', None)
        return name, 'django.db.models.FileField', args, kwargs
