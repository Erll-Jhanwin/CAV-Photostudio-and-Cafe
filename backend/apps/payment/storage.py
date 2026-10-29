"""Private, persistent receipt storage backed by Supabase Storage."""

from __future__ import annotations

import io
import mimetypes
import re
import time
from urllib.parse import quote

import requests
from django.conf import settings
from django.core.files.storage import Storage
from django.core.files.storage import default_storage
from django.utils.deconstruct import deconstructible


class SupabaseStorageError(OSError):
    """Storage is unavailable or Supabase rejected an operation."""


class SupabaseObjectNotFound(FileNotFoundError):
    """The referenced receipt path does not exist in the configured bucket."""


@deconstructible
class SupabasePaymentProofStorage(Storage):
    """Use a private bucket; Django's receipt endpoint controls file access."""

    timeout = 30
    upload_attempts = 2
    upload_timeout = 20
    upload_upsert = True

    def _test_storage(self):
        # Tests use isolated in-memory storage and local development can use
        # MEDIA_ROOT. Deployed environments always use the private bucket.
        return default_storage if (
            getattr(settings, 'IS_TESTING', False) or getattr(settings, 'DEBUG', False)
        ) else None

    def _config(self):
        base_url = str(getattr(settings, 'SUPABASE_URL', '') or '').strip().rstrip('/')
        api_key = str(
            getattr(settings, 'SUPABASE_SECRET_KEY', '')
            or getattr(settings, 'SUPABASE_SERVICE_ROLE_KEY', '')
            or ''
        ).strip()
        bucket = str(getattr(settings, 'SUPABASE_PAYMENT_PROOFS_BUCKET', 'payment-proofs') or '').strip()
        if not base_url or not api_key:
            raise SupabaseStorageError('Supabase receipt storage is not configured.')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', bucket):
            raise SupabaseStorageError('Supabase receipt storage bucket configuration is invalid.')
        if not base_url.startswith('https://') and not (
            getattr(settings, 'DEBUG', False)
            and re.match(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$', base_url)
        ):
            raise SupabaseStorageError('Supabase receipt storage requires HTTPS.')
        return base_url, api_key, bucket

    @staticmethod
    def _safe_name(name):
        value = str(name or '').replace('\\', '/')
        parts = value.split('/')
        if not value or value.startswith('/') or any(part in {'', '.', '..'} for part in parts):
            raise SupabaseStorageError('Invalid receipt storage path.')
        return value

    def _object_url(self, base_url, bucket, name):
        safe_name = self._safe_name(name)
        return f'{base_url}/storage/v1/object/{quote(bucket, safe="")}/{quote(safe_name, safe="/")}'

    @staticmethod
    def _headers(api_key, content_type=None):
        # Current Supabase secret keys (sb_secret_...) are API keys, not JWTs;
        # sending one as a Bearer token causes Supabase to reject it as an
        # invalid JWT. Legacy service_role keys remain JWTs and use both headers.
        headers = {'apikey': api_key}
        if not api_key.startswith('sb_secret_'):
            headers['Authorization'] = f'Bearer {api_key}'
        if content_type:
            headers['Content-Type'] = content_type
        return headers

    def _save(self, name, content):
        test_storage = self._test_storage()
        if test_storage:
            return test_storage.save(name, content)

        base_url, api_key, bucket = self._config()
        safe_name = self._safe_name(name)
        content_type = getattr(content, 'content_type', '') or mimetypes.guess_type(safe_name)[0] or 'application/octet-stream'
        if hasattr(content, 'chunks'):
            body = b''.join(content.chunks())
        else:
            body = content.read()
        url = self._object_url(base_url, bucket, safe_name)
        last_error = None
        for attempt in range(self.upload_attempts):
            try:
                response = requests.post(
                    url,
                    data=body,
                    # A retry can follow a timeout after Supabase stored the
                    # first request. Upsert makes replaying this UUID path safe.
                    headers={**self._headers(api_key, content_type), 'x-upsert': str(self.upload_upsert).lower()},
                    timeout=self.upload_timeout,
                )
                if response.status_code in (200, 201):
                    return safe_name
                if response.status_code not in (408, 425, 429, 500, 502, 503, 504):
                    raise SupabaseStorageError(f'Supabase Storage upload failed ({response.status_code}).')
                last_error = SupabaseStorageError(
                    f'Supabase Storage upload failed ({response.status_code}).'
                )
            except requests.RequestException as exc:
                last_error = exc
            if attempt + 1 < self.upload_attempts:
                time.sleep(0.25 * (attempt + 1))
        raise SupabaseStorageError('Supabase Storage upload failed after retry.') from last_error

    def _open(self, name, mode='rb'):
        if mode not in {'rb', 'r'}:
            raise ValueError('Payment proofs are read-only through this storage backend.')
        test_storage = self._test_storage()
        if test_storage:
            return test_storage.open(name, mode)

        base_url, api_key, bucket = self._config()
        try:
            response = requests.get(
                self._object_url(base_url, bucket, name),
                headers=self._headers(api_key),
                timeout=self.timeout,
            )
            if response.status_code == 404:
                raise SupabaseObjectNotFound('Payment proof object was not found.')
            if response.status_code != 200:
                raise SupabaseStorageError(f'Supabase Storage download failed ({response.status_code}).')
        except requests.RequestException as exc:
            raise SupabaseStorageError('Supabase Storage download failed.') from exc
        return io.BytesIO(response.content)

    def delete(self, name):
        test_storage = self._test_storage()
        if test_storage:
            return test_storage.delete(name)

        base_url, api_key, bucket = self._config()
        safe_name = self._safe_name(name)
        try:
            response = requests.delete(
                f'{base_url}/storage/v1/object/{quote(bucket, safe="")}',
                json={'prefixes': [safe_name]},
                headers=self._headers(api_key),
                timeout=self.timeout,
            )
            if response.status_code not in (200, 201, 204):
                raise SupabaseStorageError(f'Supabase Storage delete failed ({response.status_code}).')
        except requests.RequestException as exc:
            raise SupabaseStorageError('Supabase Storage delete failed.') from exc

    def exists(self, name):
        test_storage = self._test_storage()
        if test_storage:
            return test_storage.exists(name)
        # Receipt names contain random UUIDs and are never overwritten. Avoid
        # a listing request (which would require broader bucket permissions).
        return False

    def url(self, name):
        raise ValueError('Payment proofs are private; use the authenticated Django receipt endpoint.')

    def path(self, name):
        raise ValueError('Payment proofs are stored in Supabase Storage, not on the local filesystem.')
