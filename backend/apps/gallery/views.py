from rest_framework import generics, permissions
from gallery.models import GalleryImage
from gallery.serializers import GalleryImageSerializer


class GalleryImageListView(generics.ListAPIView):
    serializer_class = GalleryImageSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        queryset = GalleryImage.objects.filter(is_featured=True)
        category = self.request.query_params.get('category')
        if category and category.upper() != GalleryImage.CATEGORY_ALL:
            queryset = queryset.filter(category=category.upper())
        return queryset.order_by('sort_order', '-created_at')
