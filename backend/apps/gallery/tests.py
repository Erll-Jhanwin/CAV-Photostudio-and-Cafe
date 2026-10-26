from io import BytesIO
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .models import GalleryImage
from .storage import SupabaseGalleryStorage


def png_upload(name='gallery.png', color=(90, 40, 20)):
    image = Image.new('RGB', (2, 2), color=color)
    content = BytesIO()
    image.save(content, format='PNG')
    return SimpleUploadedFile(name, content.getvalue(), content_type='image/png')


class GalleryImageAPITests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.customer = User.objects.create_user('gallery-customer', password='Customer123!', role='CUSTOMER')
        self.staff = User.objects.create_user('gallery-staff', password='Staff123!', role='STAFF')
        self.admin = User.objects.create_user('gallery-admin', password='Admin123!', role='ADMIN')
        self.client = APIClient()

    def test_public_list_shows_only_featured_images_and_filters_categories(self):
        GalleryImage.objects.create(title='Studio feature', category='STUDIO', image=png_upload())
        GalleryImage.objects.create(
            title='Hidden café image', category='CAFE', is_featured=False, image=png_upload('hidden.png')
        )

        response = self.client.get('/api/gallery/images/')
        self.assertEqual(response.status_code, 200)
        listed_titles = {item['title'] for item in response.data}
        self.assertIn('Studio feature', listed_titles)
        self.assertIn('Studio Session', listed_titles)
        self.assertNotIn('Hidden café image', listed_titles)
        uploaded_record = next(item for item in response.data if item['title'] == 'Studio feature')
        self.assertEqual(uploaded_record['category_label'], 'Studio')
        self.assertTrue(uploaded_record['image_url'].endswith('.png'))

        self.client.force_authenticate(self.staff)
        staff_response = self.client.get('/api/gallery/images/?include_unfeatured=true&category=CAFE')
        self.assertEqual(staff_response.status_code, 200)
        self.assertIn('Hidden café image', {item['title'] for item in staff_response.data})

    def test_unfeatured_access_and_invalid_category_are_rejected(self):
        self.client.force_authenticate(self.customer)
        self.assertEqual(self.client.get('/api/gallery/images/?include_unfeatured=true').status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/gallery/images/?category=UNKNOWN').status_code, 400)

    def test_staff_can_create_edit_replace_and_delete_uploaded_image(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post('/api/gallery/images/', {
            'title': 'Studio portrait',
            'category': 'STUDIO',
            'alt_text': 'Two people in a studio',
            'caption': 'Sample caption',
            'sort_order': '3',
            'image': png_upload(),
        }, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        image_id = response.data['id']
        record = GalleryImage.objects.get(pk=image_id)
        self.assertEqual(record.created_by, self.staff)
        original_name = record.image.name

        updated = self.client.patch(f'/api/gallery/images/{image_id}/', {
            'title': 'Updated portrait',
            'image': png_upload('replacement.png', color=(10, 80, 110)),
        }, format='multipart')
        self.assertEqual(updated.status_code, 200, updated.data)
        record.refresh_from_db()
        self.assertEqual(record.title, 'Updated portrait')
        self.assertNotEqual(record.image.name, original_name)
        self.assertFalse(record.image.storage.exists(original_name))

        self.assertEqual(self.client.delete(f'/api/gallery/images/{image_id}/').status_code, 204)
        self.assertFalse(GalleryImage.objects.filter(pk=image_id).exists())

    def test_customer_cannot_mutate_gallery_and_invalid_upload_is_rejected(self):
        self.client.force_authenticate(self.customer)
        denied = self.client.post('/api/gallery/images/', {'title': 'Forbidden'}, format='multipart')
        self.assertEqual(denied.status_code, 403)

        self.client.force_authenticate(self.admin)
        invalid = self.client.post('/api/gallery/images/', {
            'title': 'Bad upload', 'category': 'STUDIO',
            'image': SimpleUploadedFile('fake.png', b'not an image', content_type='image/png'),
        }, format='multipart')
        self.assertEqual(invalid.status_code, 400)
        too_large = self.client.post('/api/gallery/images/', {
            'title': 'Large upload', 'category': 'STUDIO',
            'image': SimpleUploadedFile('large.png', b'x' * (5 * 1024 * 1024 + 1), content_type='image/png'),
        }, format='multipart')
        self.assertEqual(too_large.status_code, 400)

    @patch('gallery.views.GalleryImage.objects.get')
    def test_storage_failure_keeps_database_record_on_delete(self, mocked_get):
        record = Mock()
        record.pk = 42
        record.image = Mock()
        record.image.name = 'gallery/42.png'
        record.image.storage.delete.side_effect = OSError('unavailable')
        mocked_get.return_value = record
        self.client.force_authenticate(self.admin)

        response = self.client.delete('/api/gallery/images/42/')
        self.assertEqual(response.status_code, 503)
        record.delete.assert_not_called()


class SupabaseGalleryStorageTests(TestCase):
    @override_settings(
        DEBUG=False,
        SUPABASE_URL='https://project.example.test',
        SUPABASE_SERVICE_ROLE_KEY='test-only-secret',
        SUPABASE_GALLERY_BUCKET='gallery-public',
        IS_TESTING=False,
    )
    @patch('payment.storage.requests.post')
    def test_upload_uses_server_credentials_and_public_url_never_contains_key(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200)
        storage = SupabaseGalleryStorage()
        saved = storage.save('gallery/example.png', ContentFile(b'image-bytes', name='example.png'))

        self.assertEqual(saved, 'gallery/example.png')
        self.assertEqual(
            mocked_post.call_args.args[0],
            'https://project.example.test/storage/v1/object/gallery-public/gallery/example.png',
        )
        self.assertEqual(mocked_post.call_args.kwargs['timeout'], 30)
        public_url = storage.url(saved)
        self.assertEqual(
            public_url,
            'https://project.example.test/storage/v1/object/public/gallery-public/gallery/example.png',
        )
        self.assertNotIn('test-only-secret', public_url)

    @override_settings(
        DEBUG=False,
        SUPABASE_URL='http://untrusted.example.test',
        SUPABASE_SERVICE_ROLE_KEY='test-only-secret',
        SUPABASE_GALLERY_BUCKET='gallery-public',
    )
    def test_production_gallery_storage_rejects_insecure_endpoint(self):
        with self.assertRaises(OSError):
            SupabaseGalleryStorage().url('gallery/image.png')
