from uuid import uuid4

from django.conf import settings
from django.db import models

from users.uploads import safe_image_extension
from .storage import SupabaseCustomerPhotoStorage


def gallery_image_upload_path(instance, filename):
    return f'gallery/{uuid4().hex}{safe_image_extension(filename)}'


class GalleryImage(models.Model):
    CATEGORY_CHOICES = (
        ('STUDIO', 'Studio'),
        ('CAFE', 'Café'),
        ('EVENTS', 'Events'),
        ('BEHIND_THE_SCENES', 'Behind the Scenes'),
    )

    title = models.CharField(max_length=160)
    category = models.CharField(max_length=24, choices=CATEGORY_CHOICES, default='STUDIO')
    image = models.ImageField(upload_to=gallery_image_upload_path, blank=True)
    source_url = models.CharField(max_length=1000, blank=True)
    legacy_image_path = models.CharField(max_length=500, blank=True)
    alt_text = models.CharField(max_length=220, blank=True)
    caption = models.TextField(blank=True)
    is_featured = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='gallery_images',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sort_order', '-created_at', '-id']
        indexes = [
            models.Index(fields=['is_featured', 'sort_order', '-created_at'], name='gallery_featured_order_idx'),
        ]

    def __str__(self):
        return self.title


def customer_photo_upload_path(instance, filename):
    return f'customer_photos/booking_{instance.booking_id or "new"}/{uuid4().hex}{safe_image_extension(filename)}'


class CustomerPhoto(models.Model):
    booking = models.ForeignKey('booking.Booking', on_delete=models.CASCADE, related_name='delivered_photos')
    title = models.CharField(max_length=160, blank=True)
    image = models.FileField(upload_to=customer_photo_upload_path, storage=SupabaseCustomerPhotoStorage())
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return self.title or f'Photo for booking #{self.booking_id}'
