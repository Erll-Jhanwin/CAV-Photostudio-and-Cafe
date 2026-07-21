from rest_framework import permissions, views
from rest_framework.response import Response

from gallery.serializers import GalleryImageSerializer


GALLERY_IMAGES = [
    {
        "id": 1,
        "title": "Self-Shoot Studio",
        "category": "STUDIO",
        "category_label": "Studio",
        "image_url": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?q=80&w=1200",
        "alt_text": "Photo studio camera setup",
        "caption": "Private studio sessions with professional lights.",
        "sort_order": 1,
    },
    {
        "id": 2,
        "title": "Cafe Bar",
        "category": "CAFE",
        "category_label": "Cafe",
        "image_url": "https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=1200",
        "alt_text": "Iced coffee on a cafe table",
        "caption": "Coffee and snacks for guests and walk-ins.",
        "sort_order": 2,
    },
]


class GalleryImageListView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        category = (request.query_params.get('category') or '').upper()
        rows = GALLERY_IMAGES
        if category and category != 'ALL':
            rows = [row for row in rows if row['category'] == category]
        return Response(GalleryImageSerializer(rows, many=True).data)
