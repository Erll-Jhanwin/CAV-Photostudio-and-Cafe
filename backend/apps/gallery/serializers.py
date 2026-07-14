from rest_framework import serializers
from gallery.models import GalleryImage


class GalleryImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    category_label = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = GalleryImage
        fields = [
            'id',
            'title',
            'category',
            'category_label',
            'image_url',
            'alt_text',
            'caption',
            'sort_order',
        ]

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get('request')
        url = obj.image.url
        return request.build_absolute_uri(url) if request else url
