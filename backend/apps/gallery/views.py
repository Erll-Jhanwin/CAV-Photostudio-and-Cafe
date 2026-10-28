import logging
import mimetypes

from django.db import transaction
from django.http import FileResponse
from rest_framework import permissions, status, views
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from audit.models import AuditLog
from users.permissions import IsStaffOrAdmin
from payment.storage import SupabaseStorageError
from booking.models import Booking
from users.uploads import validate_receipt_image

from .models import CustomerPhoto, GalleryImage
from .serializers import CustomerPhotoSerializer, GalleryImageSerializer


logger = logging.getLogger(__name__)


def storage_error_response(operation, error, image_id=None):
    cause = error.__cause__
    logger.error(
        'Gallery storage operation failed operation=%s record_id=%s exception_type=%s cause_type=%s storage_error=%s.',
        operation,
        image_id,
        type(error).__name__,
        type(cause).__name__ if cause else '',
        str(error),
    )
    return Response(
        {'detail': 'Gallery image storage is temporarily unavailable. Please try again shortly.'},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
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
        except SupabaseStorageError as exc:
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
        except SupabaseStorageError as exc:
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
                    'Gallery storage operation failed operation=delete record_id=%s exception_type=%s storage_error=%s.',
                    image.pk,
                    type(exc).__name__,
                    str(exc),
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


class CustomerPhotoListCreateView(views.APIView):
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = 'sensitive'

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({'detail': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)
        photos = CustomerPhoto.objects.select_related('booking', 'booking__customer', 'uploaded_by')
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
        try:
            booking = Booking.objects.select_related('customer').get(pk=request.data.get('booking'))
        except (Booking.DoesNotExist, TypeError, ValueError):
            return Response({'booking': 'Select a valid booking.'}, status=status.HTTP_400_BAD_REQUEST)
        upload = request.FILES.get('image')
        if not upload:
            return Response({'image': 'Upload a customer photo.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_receipt_image(upload)
            photo = CustomerPhoto.objects.create(
                booking=booking,
                title=str(request.data.get('title') or '').strip()[:160],
                image=upload,
                uploaded_by=request.user,
            )
        except SupabaseStorageError as exc:
            return storage_error_response('customer_photo_upload', exc)
        AuditLog.objects.create(
            user=request.user,
            action='CUSTOMER_PHOTO_UPLOAD',
            description=f'Uploaded a customer photo for booking #{booking.pk}.',
            metadata={'photo_id': photo.pk, 'booking_id': booking.pk, 'customer_id': booking.customer_id},
        )
        return Response(CustomerPhotoSerializer(photo, context={'request': request}).data, status=status.HTTP_201_CREATED)


class CustomerPhotoDownloadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        photos = CustomerPhoto.objects.filter(pk=pk).select_related('booking__customer')
        if request.user.role not in {'STAFF', 'ADMIN'}:
            photos = photos.filter(booking__customer=request.user)
        photo = photos.first()
        if not photo:
            return Response({'detail': 'Photo not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            image = photo.image.open('rb')
        except FileNotFoundError:
            return Response({'detail': 'Photo file not found.'}, status=status.HTTP_404_NOT_FOUND)
        except (SupabaseStorageError, OSError, ValueError) as exc:
            logger.exception('Customer photo retrieval failed for photo_id=%s', photo.pk)
            AuditLog.objects.create(user=request.user, action='CUSTOMER_PHOTO_STORAGE_ERROR', description=f'Customer photo #{photo.pk} could not be retrieved.', metadata={'photo_id': photo.pk, 'issue': type(exc).__name__})
            return Response({'detail': 'Photo storage is temporarily unavailable.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        filename = photo.image.name.rsplit('/', 1)[-1]
        response = FileResponse(image, content_type=mimetypes.guess_type(filename)[0] or 'application/octet-stream', as_attachment=True, filename=filename)
        response['X-Content-Type-Options'] = 'nosniff'
        response['Cache-Control'] = 'private, no-store'
        return response
