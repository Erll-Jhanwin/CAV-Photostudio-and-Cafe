import logging

from PIL import Image, UnidentifiedImageError
from rest_framework import serializers

from users.uploads import validated_image_format

from .models import GalleryImage


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
        if obj.image:
            url = obj.image.url
        else:
            url = obj.source_url
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request and url.startswith('/') else url

    def get_image_missing(self, obj):
        return not bool(obj.image or obj.source_url)

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
            try:
                previous_image.storage.delete(previous_image.name)
            except OSError:
                logger.warning('Could not remove replaced gallery image from storage.')
        return updated
