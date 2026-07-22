from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from rest_framework import serializers


IMAGE_FORMATS = {
    'JPEG': {'mime': 'image/jpeg', 'extensions': {'.jpg', '.jpeg'}},
    'PNG': {'mime': 'image/png', 'extensions': {'.png'}},
    'WEBP': {'mime': 'image/webp', 'extensions': {'.webp'}},
}
MAX_PROFILE_PICTURE_SIZE = 2 * 1024 * 1024
MAX_RECEIPT_SIZE = 5 * 1024 * 1024


def _rewind(upload):
    try:
        upload.seek(0)
    except (AttributeError, OSError):
        pass


def validated_image_format(upload, *, max_size, label):
    if not upload:
        raise serializers.ValidationError(f'{label} is required.')
    if upload.size > max_size:
        raise serializers.ValidationError(f'{label} is too large.')

    try:
        image = Image.open(upload)
        image.verify()
        image_format = image.format
    except (UnidentifiedImageError, OSError, ValueError):
        raise serializers.ValidationError(f'{label} must be a valid JPG, PNG, or WEBP image.')
    finally:
        _rewind(upload)

    if image_format not in IMAGE_FORMATS:
        raise serializers.ValidationError(f'{label} must be a valid JPG, PNG, or WEBP image.')

    declared_type = getattr(upload, 'content_type', '') or ''
    expected_type = IMAGE_FORMATS[image_format]['mime']
    if declared_type and declared_type != expected_type:
        raise serializers.ValidationError(f'{label} file type does not match its contents.')
    return image_format


def validate_profile_picture(upload):
    validated_image_format(upload, max_size=MAX_PROFILE_PICTURE_SIZE, label='Profile picture')
    return upload


def validate_receipt_image(upload):
    validated_image_format(upload, max_size=MAX_RECEIPT_SIZE, label='Receipt')
    return upload


def validate_receipt_upload(upload):
    if not upload:
        return upload
    if upload.size > MAX_RECEIPT_SIZE:
        raise serializers.ValidationError('Receipt file must be 5MB or smaller.')

    head = upload.read(8)
    _rewind(upload)
    declared_type = getattr(upload, 'content_type', '') or ''
    if head.startswith(b'%PDF-'):
        if declared_type and declared_type != 'application/pdf':
            raise serializers.ValidationError('Receipt file type does not match its contents.')
        return upload

    return validate_receipt_image(upload)


def safe_image_extension(filename):
    extension = Path(str(filename or '')).suffix.lower()
    return extension if extension in {'.jpg', '.jpeg', '.png', '.webp'} else '.jpg'


def safe_receipt_extension(filename):
    extension = Path(str(filename or '')).suffix.lower()
    return extension if extension in {'.jpg', '.jpeg', '.png', '.webp', '.pdf'} else '.bin'


def profile_picture_upload_path(instance, filename):
    return f'profile_pictures/user_{instance.pk or "new"}/{uuid4().hex}{safe_image_extension(filename)}'


def receipt_upload_path(instance, filename):
    return f'booking_receipts/{uuid4().hex}{safe_receipt_extension(filename)}'
