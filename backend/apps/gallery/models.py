from django.db import models


class GalleryImage(models.Model):
    CATEGORY_ALL = 'ALL'
    CATEGORY_STUDIO = 'STUDIO'
    CATEGORY_CAFE = 'CAFE'
    CATEGORY_EVENTS = 'EVENTS'
    CATEGORY_BEHIND_THE_SCENES = 'BEHIND_THE_SCENES'

    CATEGORY_CHOICES = (
        (CATEGORY_STUDIO, 'Studio'),
        (CATEGORY_CAFE, 'Café'),
        (CATEGORY_EVENTS, 'Events'),
        (CATEGORY_BEHIND_THE_SCENES, 'Behind the Scenes'),
    )

    title = models.CharField(max_length=160)
    category = models.CharField(max_length=24, choices=CATEGORY_CHOICES, default=CATEGORY_STUDIO)
    image = models.FileField(upload_to='gallery/')
    alt_text = models.CharField(max_length=220, blank=True)
    caption = models.TextField(blank=True)
    is_featured = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sort_order', '-created_at']
        verbose_name = 'Gallery image'
        verbose_name_plural = 'Gallery images'

    def __str__(self):
        return self.title
