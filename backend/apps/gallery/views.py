import logging
import mimetypes
import os
import re
import tempfile
import zipfile
from urllib.parse import urlsplit

from django.db.models import Prefetch
from django.db import transaction
from django.http import FileResponse
from PIL import Image, UnidentifiedImageError
from rest_framework import permissions, status, views
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from audit.models import AuditLog
from users.permissions import IsAdmin, IsStaffOrAdmin
from payment.storage import SupabaseStorageError
from booking.models import Booking
from users.uploads import validate_receipt_image

from .models import CustomerPhoto, GalleryImage
from .serializers import CompletedBookingSerializer, CustomerPhotoSerializer, GalleryImageSerializer


logger = logging.getLogger(__name__)

MAX_CUSTOMER_IMAGE_SIZE = 5 * 1024 * 1024
MAX_CUSTOMER_UPLOAD_SIZE = 50 * 1024 * 1024
MAX_CUSTOMER_IMAGES_PER_UPLOAD = 20
MAX_ARCHIVE_UNCOMPRESSED_SIZE = 250 * 1024 * 1024
MAX_CUSTOMER_IMAGE_PIXELS = 25_000_000
ALLOWED_ARCHIVE_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}


def validate_customer_photo_archive(upload):
    if not upload or not str(upload.name or '').lower().endswith('.zip'):
        return {'archive': 'Upload a ZIP file.'}
    if upload.size > MAX_CUSTOMER_UPLOAD_SIZE:
        return {'archive': 'ZIP files must be 50 MB or smaller.'}
    try:
        upload.seek(0)
        with zipfile.ZipFile(upload) as archive:
            entries = [entry for entry in archive.infolist() if not entry.is_dir()]
            image_entries = [
                entry for entry in entries
                if entry.filename.rsplit('/', 1)[-1].lower().endswith(tuple(ALLOWED_ARCHIVE_IMAGE_EXTENSIONS))
            ]
            uncompressed_size = sum(entry.file_size for entry in entries)
            if not entries or not image_entries:
                return {'archive': 'The ZIP must contain at least one JPG, PNG, or WEBP photo.'}
            if len(entries) > 1000 or uncompressed_size > MAX_ARCHIVE_UNCOMPRESSED_SIZE:
                return {'archive': 'The ZIP contains too many files or expands beyond the 250 MB limit.'}
            if any(entry.flag_bits & 0x1 for entry in entries):
                return {'archive': 'Password-protected ZIP files are not supported.'}
            if any(entry.file_size > 0 and entry.file_size / max(entry.compress_size, 1) > 200 for entry in entries):
                return {'archive': 'The ZIP contains an unusually compressed file and was rejected.'}
            if archive.testzip() is not None:
                return {'archive': 'The ZIP file is damaged. Please create a new archive and retry.'}
    except (OSError, ValueError, zipfile.BadZipFile, zipfile.LargeZipFile):
        return {'archive': 'Upload a valid, readable ZIP file.'}
    finally:
        upload.seek(0)
    upload.name = 'customer-photos.zip'
    return None


def validate_google_drive_url(value):
    value = str(value or '').strip()
    if len(value) > 1000:
        return False
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme != 'https'
            or parsed.hostname not in {'drive.google.com', 'docs.google.com'}
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
        ):
            return False
    except (TypeError, ValueError):
        return False
    return bool(re.fullmatch(
        r'/(?:file/d|drive/(?:d|folders)|drive/u/\d+/folders|document/d|spreadsheets/d|presentation/d)/[A-Za-z0-9_-]+(?:/.*)?',
        parsed.path,
    ))


def validate_customer_photo_image(upload):
    validate_receipt_image(upload)
    try:
        with Image.open(upload) as image:
            width, height = image.size
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError):
        raise ValidationError('Each photo must be a readable JPG, PNG, or WEBP image.')
    finally:
        upload.seek(0)
    if width * height > MAX_CUSTOMER_IMAGE_PIXELS:
        raise ValidationError('Each photo must be 25 megapixels or smaller.')
    return upload


def storage_error_response(operation, error, image_id=None):
    cause = error.__cause__
    logger.error(
        'Gallery storage operation failed operation=%s record_id=%s exception_type=%s cause_type=%s.',
        operation,
        image_id,
        type(error).__name__,
        type(cause).__name__ if cause else '',
    )
    return Response(
        {'detail': 'Gallery image storage is temporarily unavailable. Please try again shortly.'},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
        headers={'Retry-After': '1'},
    )


class GalleryImageListView(views.APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = 'sensitive'

    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.AllowAny()]
        return [IsStaffOrAdmin()]

    def get(self, request):
        images = GalleryImage.objects.all()
        include_unfeatured = request.query_params.get('include_unfeatured', '').lower() in {'1', 'true', 'yes'}
        if include_unfeatured:
            if not request.user.is_authenticated or request.user.role not in {'STAFF', 'ADMIN'}:
                return Response({'detail': 'Staff access required.'}, status=status.HTTP_403_FORBIDDEN)
        else:
            images = images.filter(is_featured=True).exclude(image='', source_url='')

        category = (request.query_params.get('category') or '').strip().upper()
        valid_categories = {value for value, _ in GalleryImage.CATEGORY_CHOICES}
        if category and category != 'ALL':
            if category not in valid_categories:
                return Response({'category': 'Unsupported gallery category.'}, status=status.HTTP_400_BAD_REQUEST)
            images = images.filter(category=category)

        try:
            limit = min(max(int(request.query_params.get('limit', 60)), 1), 200)
        except (TypeError, ValueError):
            limit = 60
        try:
            offset = min(max(int(request.query_params.get('offset', 0)), 0), 100000)
        except (TypeError, ValueError):
            offset = 0
        images = images[offset:offset + limit]
        serializer = GalleryImageSerializer(images, many=True, context={'request': request})
        return Response(serializer.data)

    def post(self, request):
        serializer = GalleryImageSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                image = serializer.save()
                AuditLog.objects.create(
                    user=request.user,
                    action='GALLERY_IMAGE_CREATE',
                    description=f'Created gallery image #{image.pk}.',
                    metadata={'record_id': image.pk, 'category': image.category},
                )
        except OSError as exc:
            return storage_error_response('upload', exc)
        return Response(
            GalleryImageSerializer(image, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class GalleryImageDetailView(views.APIView):
    permission_classes = [IsStaffOrAdmin]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = 'sensitive'

    @staticmethod
    def get_object(pk):
        try:
            return GalleryImage.objects.get(pk=pk)
        except GalleryImage.DoesNotExist:
            return None

    def patch(self, request, pk):
        return self._update(request, pk, partial=True)

    def put(self, request, pk):
        return self._update(request, pk, partial=False)

    def _update(self, request, pk, *, partial):
        image = self.get_object(pk)
        if image is None:
            return Response({'detail': 'Gallery image not found.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = GalleryImageSerializer(
            image,
            data=request.data,
            partial=partial,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                updated = serializer.save()
                AuditLog.objects.create(
                    user=request.user,
                    action='GALLERY_IMAGE_UPDATE',
                    description=f'Updated gallery image #{updated.pk}.',
                    metadata={'record_id': updated.pk, 'category': updated.category},
                )
        except OSError as exc:
            return storage_error_response('update', exc, image_id=image.pk)
        return Response(GalleryImageSerializer(updated, context={'request': request}).data)

    def delete(self, request, pk):
        image = self.get_object(pk)
        if image is None:
            return Response({'detail': 'Gallery image not found.'}, status=status.HTTP_404_NOT_FOUND)
        if image.image:
            try:
                image.image.storage.delete(image.image.name)
            except OSError as exc:
                logger.error(
                    'Gallery storage operation failed operation=delete record_id=%s exception_type=%s.',
                    image.pk,
                    type(exc).__name__,
                )
                return Response(
                    {'detail': 'The image could not be removed from storage. The gallery record was kept.'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        image_id = image.pk
        image.delete()
        AuditLog.objects.create(
            user=request.user,
            action='GALLERY_IMAGE_DELETE',
            description=f'Deleted gallery image #{image_id}.',
            metadata={'record_id': image_id},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class CompletedBookingListView(views.APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        try:
            limit = min(max(int(request.query_params.get('limit', 50)), 1), 100)
            offset = min(max(int(request.query_params.get('offset', 0)), 0), 1_000_000)
        except (TypeError, ValueError):
            return Response({'detail': 'Use a positive limit and a non-negative offset.'}, status=status.HTTP_400_BAD_REQUEST)

        bookings = Booking.objects.filter(status='COMPLETED').select_related(
            'customer', 'package', 'package__service', 'review'
        ).prefetch_related(
            'payments',
            Prefetch(
                'delivered_photos',
                queryset=CustomerPhoto.objects.select_related('booking__package').order_by('created_at', 'id'),
                to_attr='customer_photo_rows',
            ),
        ).order_by('-scheduled_date', '-scheduled_time', '-id')
        total = bookings.count()
        rows = bookings[offset:offset + limit]
        return Response({
            'count': total,
            'next_offset': offset + limit if offset + limit < total else None,
            'results': CompletedBookingSerializer(rows, many=True, context={'request': request}).data,
        })


class CustomerPhotoListCreateView(views.APIView):
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = 'sensitive'

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({'detail': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)
        photos = CustomerPhoto.objects.select_related('booking', 'booking__customer', 'booking__package', 'uploaded_by')
        if request.user.role in {'STAFF', 'ADMIN'}:
            booking_id = request.query_params.get('booking')
            if booking_id:
                photos = photos.filter(booking_id=booking_id)
        else:
            photos = photos.filter(booking__customer=request.user)
        return Response(CustomerPhotoSerializer(photos[:300], many=True, context={'request': request}).data)

    def post(self, request):
        if not request.user.is_authenticated or request.user.role not in {'STAFF', 'ADMIN'}:
            return Response({'detail': 'Staff access required.'}, status=status.HTTP_403_FORBIDDEN)
        managed_delivery = 'attachment_type' in request.data
        if managed_delivery and request.user.role != 'ADMIN':
            return Response({'detail': 'Admin access required to manage completed-session photo deliveries.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            booking = Booking.objects.select_related('customer').get(pk=request.data.get('booking'))
        except (Booking.DoesNotExist, TypeError, ValueError):
            return Response({'booking': 'Select a valid booking.'}, status=status.HTTP_400_BAD_REQUEST)

        attachment_type = str(request.data.get('attachment_type') or CustomerPhoto.ATTACHMENT_IMAGE).strip().upper()
        if attachment_type not in {CustomerPhoto.ATTACHMENT_IMAGE, CustomerPhoto.ATTACHMENT_ZIP, CustomerPhoto.ATTACHMENT_DRIVE}:
            return Response({'attachment_type': 'Choose images, a ZIP archive, or a Google Drive link.'}, status=status.HTTP_400_BAD_REQUEST)
        if managed_delivery and (booking.status != 'COMPLETED' or not booking.customer_id):
            return Response({'booking': 'Photo delivery requires a completed booking linked to a customer account.'}, status=status.HTTP_400_BAD_REQUEST)

        title = str(request.data.get('title') or '').strip()[:160]
        uploads = []
        drive_url = ''
        if attachment_type == CustomerPhoto.ATTACHMENT_IMAGE:
            uploads = request.FILES.getlist('images') or ([request.FILES['image']] if request.FILES.get('image') else [])
            if not uploads:
                return Response({'images': 'Select at least one JPG, PNG, or WEBP image.'}, status=status.HTTP_400_BAD_REQUEST)
            if len(uploads) > MAX_CUSTOMER_IMAGES_PER_UPLOAD:
                return Response({'images': f'Upload no more than {MAX_CUSTOMER_IMAGES_PER_UPLOAD} images at a time.'}, status=status.HTTP_400_BAD_REQUEST)
            if sum(upload.size for upload in uploads) > MAX_CUSTOMER_UPLOAD_SIZE:
                return Response({'images': 'The combined image upload must be 50 MB or smaller.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                for upload in uploads:
                    upload.customer_original_filename = safe_customer_photo_filename(upload.name)
                    if upload.size > MAX_CUSTOMER_IMAGE_SIZE:
                        return Response({'images': 'Each image must be 5 MB or smaller.'}, status=status.HTTP_400_BAD_REQUEST)
                    validate_customer_photo_image(upload)
            except ValidationError as exc:
                return Response({'images': exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        elif attachment_type == CustomerPhoto.ATTACHMENT_ZIP:
            archive = request.FILES.get('archive') or request.FILES.get('image')
            if archive:
                archive.customer_original_filename = safe_customer_photo_filename(archive.name)
            archive_error = validate_customer_photo_archive(archive)
            if archive_error:
                return Response(archive_error, status=status.HTTP_400_BAD_REQUEST)
            uploads = [archive]
        else:
            drive_url = str(request.data.get('drive_url') or '').strip()
            if not validate_google_drive_url(drive_url):
                return Response({'drive_url': 'Use a valid HTTPS Google Drive or Docs sharing URL.'}, status=status.HTTP_400_BAD_REQUEST)
            if request.FILES:
                return Response({'drive_url': 'Remove uploaded files when delivering a Google Drive link.'}, status=status.HTTP_400_BAD_REQUEST)

        created_photos = []
        try:
            with transaction.atomic():
                if attachment_type == CustomerPhoto.ATTACHMENT_DRIVE:
                    created_photos.append(CustomerPhoto.objects.create(
                        booking=booking,
                        title=title or 'Google Drive photo set',
                        attachment_type=attachment_type,
                        drive_url=drive_url,
                        uploaded_by=request.user,
                    ))
                else:
                    for index, upload in enumerate(uploads, start=1):
                        photo_title = title
                        if attachment_type == CustomerPhoto.ATTACHMENT_IMAGE and len(uploads) > 1 and not photo_title:
                            photo_title = f'Photo {index}'
                        elif attachment_type == CustomerPhoto.ATTACHMENT_ZIP and not photo_title:
                            photo_title = 'ZIP photo set'
                        created_photos.append(CustomerPhoto.objects.create(
                            booking=booking,
                            title=photo_title,
                            original_filename=getattr(upload, 'customer_original_filename', '') or safe_customer_photo_filename(upload.name),
                            attachment_type=attachment_type,
                            image=upload,
                            uploaded_by=request.user,
                        ))
        except SupabaseStorageError as exc:
            for saved_photo in created_photos:
                try:
                    saved_photo.image.storage.delete(saved_photo.image.name)
                except OSError as cleanup_exc:
                    logger.error('Could not clean up a partial customer photo upload booking_id=%s exception_type=%s.', booking.pk, type(cleanup_exc).__name__)
            return storage_error_response('customer_photo_upload', exc)
        AuditLog.objects.create(
            user=request.user,
            action='CUSTOMER_PHOTO_UPLOAD',
            description=f'Added {len(created_photos)} customer photo attachment(s) for booking #{booking.pk}.',
            metadata={
                'photo_ids': [photo.pk for photo in created_photos],
                'booking_id': booking.pk,
                'customer_id': booking.customer_id,
                'attachment_type': attachment_type,
            },
        )
        serialized = CustomerPhotoSerializer(created_photos, many=True, context={'request': request}).data
        if not managed_delivery and attachment_type == CustomerPhoto.ATTACHMENT_IMAGE and len(serialized) == 1:
            return Response(serialized[0], status=status.HTTP_201_CREATED)
        return Response({'results': serialized, 'count': len(serialized)}, status=status.HTTP_201_CREATED)


class CustomerPhotoDownloadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if getattr(self.request.user, 'role', None) == 'STAFF':
            return [IsStaffOrAdmin()]
        return super().get_permissions()

    def get(self, request, pk):
        photos = CustomerPhoto.objects.filter(pk=pk).select_related('booking__customer')
        if request.user.role not in {'STAFF', 'ADMIN'}:
            photos = photos.filter(booking__customer=request.user)
        photo = photos.first()
        if not photo:
            return Response({'detail': 'Photo not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not photo.image:
            return Response({'detail': 'This attachment is not a downloadable file.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            image = photo.image.open('rb')
        except FileNotFoundError:
            return Response({'detail': 'Photo file not found.'}, status=status.HTTP_404_NOT_FOUND)
        except (SupabaseStorageError, OSError, ValueError) as exc:
            logger.error('Customer photo retrieval failed photo_id=%s exception_type=%s.', photo.pk, type(exc).__name__)
            AuditLog.objects.create(user=request.user, action='CUSTOMER_PHOTO_STORAGE_ERROR', description=f'Customer photo #{photo.pk} could not be retrieved.', metadata={'photo_id': photo.pk, 'issue': type(exc).__name__})
            return Response({'detail': 'Photo storage is temporarily unavailable.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        filename = photo.image.name.rsplit('/', 1)[-1]
        response = FileResponse(image, content_type=mimetypes.guess_type(filename)[0] or 'application/octet-stream', as_attachment=True, filename=filename)
        response['X-Content-Type-Options'] = 'nosniff'
        response['Cache-Control'] = 'private, no-store'
        return response


def safe_customer_photo_filename(value):
    name = str(value or '').replace('\\', '/').rsplit('/', 1)[-1]
    name = ''.join(character for character in name if character.isprintable() and character not in {'/', '\\'})
    name = name.strip().strip('.')[:255]
    return name or 'photo'


def unique_archive_name(filename, used_names):
    safe_name = safe_customer_photo_filename(filename)
    stem, extension = os.path.splitext(safe_name)
    candidate = safe_name
    suffix = 2
    while candidate.casefold() in used_names:
        candidate = f'{stem} ({suffix}){extension}'
        suffix += 1
    used_names.add(candidate.casefold())
    return candidate


class CustomerPhotoBookingDownloadAllView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'sensitive'

    def get(self, request, booking_id):
        if request.user.role != 'CUSTOMER':
            return Response({'detail': 'Photo archive not found.'}, status=status.HTTP_404_NOT_FOUND)
        booking = Booking.objects.filter(pk=booking_id, customer=request.user).first()
        if not booking:
            return Response({'detail': 'Photo archive not found.'}, status=status.HTTP_404_NOT_FOUND)

        attachments = CustomerPhoto.objects.filter(
            booking=booking,
            image__gt='',
        ).exclude(attachment_type=CustomerPhoto.ATTACHMENT_DRIVE)
        existing_zip = attachments.filter(attachment_type=CustomerPhoto.ATTACHMENT_ZIP).order_by('-created_at', '-id').first()
        if existing_zip:
            try:
                file_handle = existing_zip.image.open('rb')
            except (FileNotFoundError, SupabaseStorageError, OSError, ValueError) as exc:
                logger.error('Existing customer photo ZIP could not be opened booking_id=%s photo_id=%s exception_type=%s.', booking.pk, existing_zip.pk, type(exc).__name__)
                return Response({'detail': 'The photo ZIP could not be downloaded. Please try again.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            response = FileResponse(
                file_handle,
                as_attachment=True,
                filename=existing_zip.original_filename or f'booking-{booking.pk}-photos.zip',
                content_type='application/zip',
            )
            response['Cache-Control'] = 'private, no-store'
            response['X-Content-Type-Options'] = 'nosniff'
            return response

        photos = list(
            attachments.filter(attachment_type=CustomerPhoto.ATTACHMENT_IMAGE)
            .order_by('created_at', 'id')
        )
        if not photos:
            return Response({'detail': 'No downloadable photos are available for this booking.'}, status=status.HTTP_404_NOT_FOUND)

        archive_file = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode='w+b')
        used_names = set()
        try:
            with zipfile.ZipFile(archive_file, mode='w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                for photo in photos:
                    entry_name = unique_archive_name(
                        photo.original_filename or (photo.image.name.rsplit('/', 1)[-1] if photo.image else ''),
                        used_names,
                    )
                    with photo.image.open('rb') as source, archive.open(entry_name, mode='w', force_zip64=True) as target:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            target.write(chunk)
            archive_file.seek(0)
        except (SupabaseStorageError, OSError, ValueError, RuntimeError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
            archive_file.close()
            logger.error('Customer photo ZIP creation failed booking_id=%s photo_count=%s exception_type=%s.', booking.pk, len(photos), type(exc).__name__)
            return Response({'detail': 'The photo ZIP could not be created. Please try again.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        response = FileResponse(
            archive_file,
            as_attachment=True,
            filename=f'booking-{booking.pk}-photos.zip',
            content_type='application/zip',
        )
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
