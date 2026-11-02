import logging

from PIL import Image, UnidentifiedImageError
from django.db import transaction
from rest_framework import serializers

from users.uploads import validated_image_format
from payment.storage import SupabaseStorageError
from booking.serializers import BookingSerializer

from .models import CustomerPhoto, GalleryImage


logger = logging.getLogger(__name__)


class GalleryImageSerializer(serializers.ModelSerializer):
    image = serializers.ImageField(write_only=True, required=False)
    image_url = serializers.SerializerMethodField()
    image_missing = serializers.SerializerMethodField()
    source_url = serializers.CharField(read_only=True)
    category_label = serializers.CharField(source='get_category_display', read_only=True)
    created_by = serializers.IntegerField(source='created_by_id', read_only=True, allow_null=True)

    class Meta:
        model = GalleryImage
        fields = (
            'id', 'title', 'category', 'category_label', 'image', 'image_url', 'image_missing', 'source_url',
            'alt_text', 'caption', 'is_featured', 'sort_order', 'created_by',
            'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')

    def get_image_url(self, obj):
        if hasattr(obj, '_gallery_image_url'):
            return obj._gallery_image_url
        try:
            if obj.image:
                url = obj.image.url
                request = self.context.get('request')
                if request and url and url.startswith('/'):
                    url = request.build_absolute_uri(url)
            else:
                # Relative source URLs point at frontend assets. Keep them
                # relative so the browser resolves them on the frontend host,
                # not on the API host.
                url = obj.source_url
        except SupabaseStorageError as exc:
            logger.warning(
                'Gallery image URL unavailable record_id=%s exception_type=%s.',
                obj.pk,
                type(exc).__name__,
            )
            url = None
        obj._gallery_image_url = url or None
        return obj._gallery_image_url

    def get_image_missing(self, obj):
        return not bool(self.get_image_url(obj))

    def validate_image(self, upload):
        try:
            upload.seek(0)
            with Image.open(upload) as image:
                width, height = image.size
        except (UnidentifiedImageError, OSError, ValueError):
            raise serializers.ValidationError('Gallery image must be a valid JPG, PNG, or WEBP image.')
        finally:
            upload.seek(0)
        if width * height > 25_000_000:
            raise serializers.ValidationError('Gallery image dimensions must not exceed 25 megapixels.')
        image_format = validated_image_format(upload, max_size=5 * 1024 * 1024, label='Gallery image')
        extension = {'JPEG': '.jpg', 'PNG': '.png', 'WEBP': '.webp'}[image_format]
        upload.name = f'gallery{extension}'
        return upload

    def validate(self, attrs):
        image_supplied = bool(attrs.get('image'))
        existing_image = bool(getattr(self.instance, 'image', None))
        if not image_supplied and not existing_image and self.instance is None:
            raise serializers.ValidationError({'image': 'Upload a gallery image.'})
        has_public_source = image_supplied or existing_image or bool(getattr(self.instance, 'source_url', ''))
        will_be_featured = attrs.get('is_featured', getattr(self.instance, 'is_featured', True))
        if will_be_featured and not has_public_source:
            raise serializers.ValidationError({'image': 'Upload a replacement image before publishing this record.'})
        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        validated_data['source_url'] = ''
        return super().create(validated_data)

    def update(self, instance, validated_data):
        previous_image = instance.image
        replacing_image = bool(validated_data.get('image'))
        if replacing_image:
            validated_data['source_url'] = ''
        updated = super().update(instance, validated_data)
        if replacing_image and previous_image and previous_image.name != updated.image.name:
            previous_name = previous_image.name
            storage = previous_image.storage

            def remove_replaced_image():
                try:
                    storage.delete(previous_name)
                except OSError as exc:
                    logger.warning(
                        'Could not remove replaced gallery image record_id=%s exception_type=%s.',
                        updated.pk,
                        type(exc).__name__,
                    )

            transaction.on_commit(remove_replaced_image)
        return updated


class CustomerPhotoSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()
    booking_id = serializers.IntegerField(read_only=True)
    booking_scheduled_date = serializers.DateField(source='booking.scheduled_date', read_only=True)
    booking_scheduled_time = serializers.TimeField(source='booking.scheduled_time', read_only=True)
    package_name = serializers.CharField(source='booking.package.name', read_only=True)
    file_name = serializers.SerializerMethodField()

    class Meta:
        model = CustomerPhoto
        fields = (
            'id', 'booking_id', 'booking_scheduled_date', 'booking_scheduled_time', 'package_name',
            'title', 'attachment_type', 'file_name', 'drive_url', 'download_url', 'created_at',
        )
        read_only_fields = fields

    def get_download_url(self, obj):
        if not obj.image:
            return None
        from django.urls import reverse
        request = self.context.get('request')
        url = reverse('customer_photo_download', kwargs={'pk': obj.pk})
        return request.build_absolute_uri(url) if request else url

    def get_file_name(self, obj):
        return obj.original_filename or (obj.image.name.rsplit('/', 1)[-1] if obj.image else '')


class CompletedBookingSerializer(BookingSerializer):
    customer_account_id = serializers.IntegerField(source='customer_id', read_only=True, allow_null=True)
    photo_attachments = serializers.SerializerMethodField()

    class Meta(BookingSerializer.Meta):
        fields = [*BookingSerializer.Meta.fields, 'customer_account_id', 'photo_attachments']

    def get_photo_attachments(self, booking):
        rows = getattr(booking, 'customer_photo_rows', [])
        return CustomerPhotoSerializer(rows, many=True, context=self.context).data
