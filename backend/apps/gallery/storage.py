"""Public image storage for the customer-facing gallery."""

import re
from urllib.parse import quote, urlparse

from django.conf import settings

from payment.storage import SupabaseStorageError, SupabasePaymentProofStorage


class SupabaseGalleryStorage(SupabasePaymentProofStorage):
    """Store gallery images in a public Supabase bucket using server credentials.

    The bucket must be configured as public in Supabase. The service role key is
    used only for writes and is never included in the public image URL.
    """

    def _config(self):
        base_url = str(getattr(settings, 'SUPABASE_URL', '') or '').strip().rstrip('/')
        api_key = str(
            getattr(settings, 'SUPABASE_SECRET_KEY', '')
            or getattr(settings, 'SUPABASE_SERVICE_ROLE_KEY', '')
            or ''
        ).strip()
        bucket = str(getattr(settings, 'SUPABASE_GALLERY_BUCKET', 'gallery') or '').strip()
        if not base_url or not api_key:
            raise SupabaseStorageError('Supabase gallery storage is not configured.')
        if not bucket or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for char in bucket):
            raise SupabaseStorageError('Supabase gallery bucket configuration is invalid.')
        parsed_url = urlparse(base_url)
        local_http = getattr(settings, 'DEBUG', False) and bool(
            re.fullmatch(r'http://(localhost|127\.0\.0\.1)(:\d+)?', base_url)
        )
        secure_https = parsed_url.scheme == 'https' and bool(parsed_url.hostname)
        if not secure_https and not local_http:
            raise SupabaseStorageError('Supabase gallery storage requires HTTPS.')
        return base_url, api_key, bucket

    def url(self, name):
        base_url, _, bucket = self._config()
        safe_name = self._safe_name(name)
        return (
            f'{base_url}/storage/v1/object/public/{quote(bucket, safe="")}/'
            f'{quote(safe_name, safe="/")}'
        )
