from rest_framework import serializers


class GalleryImageSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    category = serializers.CharField()
    category_label = serializers.CharField()
    image_url = serializers.CharField(allow_null=True)
    alt_text = serializers.CharField(allow_blank=True)
    caption = serializers.CharField(allow_blank=True)
    sort_order = serializers.IntegerField()
