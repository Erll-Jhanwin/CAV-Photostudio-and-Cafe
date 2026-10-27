import logging

from django.db import transaction
from rest_framework import permissions, status, views
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from audit.models import AuditLog
from users.permissions import IsStaffOrAdmin
from payment.storage import SupabaseStorageError

from .models import GalleryImage
from .serializers import GalleryImageSerializer


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
