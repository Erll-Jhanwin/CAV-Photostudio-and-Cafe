from io import BytesIO
import zipfile
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from payment.storage import SupabaseStorageError

from booking.models import Booking, Package, Service
from .models import CustomerPhoto, GalleryImage
from .serializers import GalleryImageSerializer
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

    def create_booking(self, customer, name):
        service = Service.objects.create(name=f'{name} Studio', base_price='1000.00')
        package = Package.objects.create(service=service, name=f'{name} Package', price='1000.00', inclusions='Digital photos')
        from django.utils import timezone
        from datetime import timedelta
        return Booking.objects.create(customer=customer, package=package, scheduled_date=timezone.localdate() + timedelta(days=2), scheduled_time='09:00')

    def test_customer_photo_delivery_is_private_to_booking_owner(self):
        booking = self.create_booking(self.customer, 'PhotoOwner')
        self.client.force_authenticate(self.staff)
        created = self.client.post('/api/gallery/customer-photos/', {
            'booking': booking.pk, 'title': 'Edited portrait', 'image': png_upload('portrait.png'),
        }, format='multipart')
        self.assertEqual(created.status_code, 201, created.data)
        photo = CustomerPhoto.objects.get(pk=created.data['id'])
        self.assertTrue(photo.image.name.startswith(f'customer_photos/booking_{booking.pk}/'))

        self.client.force_authenticate(self.customer)
        listed = self.client.get('/api/gallery/customer-photos/')
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([row['id'] for row in listed.data], [photo.pk])
        downloaded = self.client.get(created.data['download_url'])
        self.assertEqual(downloaded.status_code, 200)

        other = get_user_model().objects.create_user('photo-other-customer', role='CUSTOMER')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/gallery/customer-photos/').data, [])
        self.assertEqual(self.client.get(created.data['download_url']).status_code, 404)

    def test_completed_booking_photo_batch_flows_from_admin_to_customer_gallery(self):
        booking = self.create_booking(self.customer, 'CompletedPhotoBatch')
        booking.status = 'COMPLETED'
        booking.save(update_fields=['status'])
        self.client.force_authenticate(self.admin)

        listed = self.client.get('/api/gallery/completed-bookings/?limit=10')
        self.assertEqual(listed.status_code, 200)
        booking_row = next(row for row in listed.data['results'] if row['id'] == booking.pk)
        self.assertEqual(booking_row['status'], 'COMPLETED')
        self.assertEqual(booking_row['photo_attachments'], [])

        uploaded = self.client.post('/api/gallery/customer-photos/', {
            'booking': booking.pk,
            'attachment_type': 'IMAGE',
            'title': 'Finished portraits',
            'images': [png_upload('portrait-one.png'), png_upload('portrait-two.png')],
        }, format='multipart')
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        self.assertEqual(uploaded.data['count'], 2)

        refreshed = self.client.get('/api/gallery/completed-bookings/?limit=10')
        delivered = next(row for row in refreshed.data['results'] if row['id'] == booking.pk)['photo_attachments']
        self.assertEqual(len(delivered), 2)
        self.assertEqual({row['attachment_type'] for row in delivered}, {'IMAGE'})
        self.assertTrue(all(row['download_url'] for row in delivered))

        self.client.force_authenticate(self.customer)
        customer_photos = self.client.get('/api/gallery/customer-photos/')
        self.assertEqual(customer_photos.status_code, 200)
        self.assertEqual(len(customer_photos.data), 2)
        self.assertEqual(customer_photos.data[0]['package_name'], booking.package.name)
        self.assertEqual(customer_photos.data[0]['booking_scheduled_date'], booking.scheduled_date.isoformat())

        other_customer = get_user_model().objects.create_user('photo-batch-other', role='CUSTOMER')
        self.client.force_authenticate(other_customer)
        self.assertEqual(self.client.get('/api/gallery/customer-photos/').data, [])
        self.assertEqual(self.client.get(delivered[0]['download_url']).status_code, 404)

    def test_customer_can_download_all_original_images_in_owner_scoped_zip(self):
        booking = self.create_booking(self.customer, 'PhotoArchive')
        booking.status = 'COMPLETED'
        booking.save(update_fields=['status'])
        uploads = [png_upload('portrait one.png'), png_upload('portrait-two.png')]
        expected_contents = {}
        for upload in uploads:
            expected_contents[upload.name] = upload.read()
            upload.seek(0)

        self.client.force_authenticate(self.admin)
        uploaded = self.client.post('/api/gallery/customer-photos/', {
            'booking': booking.pk,
            'attachment_type': 'IMAGE',
            'images': uploads,
        }, format='multipart')
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        self.assertEqual(
            {photo['file_name'] for photo in uploaded.data['results']},
            set(expected_contents),
        )

        self.client.force_authenticate(self.customer)
        response = self.client.get(f'/api/gallery/customer-photos/booking/{booking.pk}/download-all/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/zip')
        with zipfile.ZipFile(BytesIO(b''.join(response.streaming_content))) as archive:
            self.assertEqual(set(archive.namelist()), set(expected_contents))
            for filename, contents in expected_contents.items():
                self.assertEqual(archive.read(filename), contents)

        other_customer = get_user_model().objects.create_user('photo-archive-other', role='CUSTOMER')
        self.client.force_authenticate(other_customer)
        self.assertEqual(
            self.client.get(f'/api/gallery/customer-photos/booking/{booking.pk}/download-all/').status_code,
            404,
        )
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(f'/api/gallery/customer-photos/booking/{booking.pk}/download-all/').status_code,
            401,
        )

    def test_completed_booking_zip_and_drive_attachments_are_validated_and_owner_scoped(self):
        booking = self.create_booking(self.customer, 'CompletedPhotoDelivery')
        booking.status = 'COMPLETED'
        booking.save(update_fields=['status'])
        image = png_upload('inside.png')
        archive_bytes = BytesIO()
        with zipfile.ZipFile(archive_bytes, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('session/inside.png', image.read())
        archive_upload = SimpleUploadedFile('session-photos.zip', archive_bytes.getvalue(), content_type='application/zip')

        self.client.force_authenticate(self.admin)
        zip_response = self.client.post('/api/gallery/customer-photos/', {
            'booking': booking.pk, 'attachment_type': 'ZIP', 'archive': archive_upload,
        }, format='multipart')
        self.assertEqual(zip_response.status_code, 201, zip_response.data)
        self.assertEqual(zip_response.data['results'][0]['attachment_type'], 'ZIP')
        self.assertTrue(zip_response.data['results'][0]['download_url'])

        drive_response = self.client.post('/api/gallery/customer-photos/', {
            'booking': booking.pk,
            'attachment_type': 'GOOGLE_DRIVE',
            'drive_url': 'https://drive.google.com/file/d/Abc_123/view?usp=sharing',
        }, format='multipart')
        self.assertEqual(drive_response.status_code, 201, drive_response.data)
        self.assertEqual(drive_response.data['results'][0]['drive_url'], 'https://drive.google.com/file/d/Abc_123/view?usp=sharing')

        invalid_link = self.client.post('/api/gallery/customer-photos/', {
            'booking': booking.pk,
            'attachment_type': 'GOOGLE_DRIVE',
            'drive_url': 'https://drive.google.com.evil.example/file/d/Abc_123/view',
        }, format='multipart')
        self.assertEqual(invalid_link.status_code, 400)

        self.client.force_authenticate(self.customer)
        received = self.client.get('/api/gallery/customer-photos/')
        self.assertEqual({row['attachment_type'] for row in received.data}, {'ZIP', 'GOOGLE_DRIVE'})
        archive_download = self.client.get(f'/api/gallery/customer-photos/booking/{booking.pk}/download-all/')
        self.assertEqual(archive_download.status_code, 200)
        self.assertEqual(b''.join(archive_download.streaming_content), archive_bytes.getvalue())

        other_customer = get_user_model().objects.create_user('photo-delivery-other', role='CUSTOMER')
        self.client.force_authenticate(other_customer)
        self.assertEqual(self.client.get('/api/gallery/customer-photos/').data, [])

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
        studio_sample = next(item for item in response.data if item['title'] == 'Studio Session')
        self.assertEqual(studio_sample['image_url'], '/assets/pics/solo/solo%20pic%20landscape.jpg')
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

        with self.captureOnCommitCallbacks(execute=True):
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

    @patch.object(GalleryImageSerializer, 'create', side_effect=SupabaseStorageError('Supabase Storage upload failed (403).'))
    def test_upload_storage_permission_failure_returns_retryable_status(self, _storage_create):
        self.client.force_authenticate(self.staff)
        initial_count = GalleryImage.objects.count()
        response = self.client.post('/api/gallery/images/', {
            'title': 'Storage failure',
            'category': 'STUDIO',
            'image': png_upload(),
        }, format='multipart')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Retry-After'], '1')
        self.assertEqual(
            response.data['detail'],
            'Gallery image storage is temporarily unavailable. Please try again shortly.',
        )
        self.assertEqual(GalleryImage.objects.count(), initial_count)

    @patch.object(GalleryImageSerializer, 'update', side_effect=SupabaseStorageError('Supabase Storage upload failed (403).'))
    def test_update_storage_failure_preserves_the_existing_record(self, _storage_update):
        image = GalleryImage.objects.create(title='Existing image', image=png_upload())
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f'/api/gallery/images/{image.pk}/', {
            'title': 'Updated title',
            'image': png_upload('replacement.png'),
        }, format='multipart')

        self.assertEqual(response.status_code, 503)
        image.refresh_from_db()
        self.assertEqual(image.title, 'Existing image')

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
        self.assertEqual(mocked_post.call_args.kwargs['headers']['x-upsert'], 'true')
        public_url = storage.url(saved)
        self.assertEqual(
            public_url,
            'https://project.example.test/storage/v1/object/public/gallery-public/gallery/example.png',
        )
        self.assertNotIn('test-only-secret', public_url)

    @override_settings(
        DEBUG=False,
        SUPABASE_URL='https://project.example.test',
        SUPABASE_SERVICE_ROLE_KEY='test-only-secret',
        SUPABASE_GALLERY_BUCKET='gallery-public',
        IS_TESTING=False,
    )
    @patch('payment.storage.time.sleep')
    @patch('payment.storage.requests.post')
    def test_upload_retries_a_temporary_storage_error_with_same_object_path(self, mocked_post, _sleep):
        mocked_post.side_effect = [Mock(status_code=503), Mock(status_code=201)]

        saved = SupabaseGalleryStorage().save(
            'gallery/retry-safe.png', ContentFile(b'image-bytes', name='retry-safe.png')
        )

        self.assertEqual(saved, 'gallery/retry-safe.png')
        self.assertEqual(mocked_post.call_count, 2)
        self.assertEqual(mocked_post.call_args_list[0].args[0], mocked_post.call_args_list[1].args[0])
        self.assertEqual(mocked_post.call_args_list[0].kwargs['data'], mocked_post.call_args_list[1].kwargs['data'])

    @override_settings(
        DEBUG=False,
        SUPABASE_URL='https://project.example.test',
        SUPABASE_SECRET_KEY='sb_secret_test-only',
        SUPABASE_SERVICE_ROLE_KEY='',
        SUPABASE_GALLERY_BUCKET='gallery-public',
        IS_TESTING=False,
    )
    @patch('payment.storage.requests.post')
    def test_current_supabase_secret_key_is_sent_as_apikey_only(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200)
        SupabaseGalleryStorage().save('gallery/secret-key.png', ContentFile(b'image-bytes', name='image.png'))

        headers = mocked_post.call_args.kwargs['headers']
        self.assertEqual(headers['apikey'], 'sb_secret_test-only')
        self.assertNotIn('Authorization', headers)

    @override_settings(
        DEBUG=False,
        SUPABASE_URL='https://project.example.test',
        SUPABASE_SERVICE_ROLE_KEY='legacy-service-role-test',
        SUPABASE_GALLERY_BUCKET='gallery-public',
        IS_TESTING=False,
    )
    @patch('payment.storage.requests.delete')
    def test_delete_uses_server_credentials_and_scoped_object_path(self, mocked_delete):
        mocked_delete.return_value = Mock(status_code=200)
        SupabaseGalleryStorage().delete('gallery/remove-me.png')

        self.assertEqual(
            mocked_delete.call_args.args[0],
            'https://project.example.test/storage/v1/object/gallery-public',
        )
        self.assertEqual(mocked_delete.call_args.kwargs['json'], {'prefixes': ['gallery/remove-me.png']})
        self.assertEqual(
            mocked_delete.call_args.kwargs['headers']['Authorization'],
            'Bearer legacy-service-role-test',
        )

    @override_settings(
        DEBUG=False,
        SUPABASE_URL='http://untrusted.example.test',
        SUPABASE_SERVICE_ROLE_KEY='test-only-secret',
        SUPABASE_GALLERY_BUCKET='gallery-public',
    )
    def test_production_gallery_storage_rejects_insecure_endpoint(self):
        with self.assertRaises(OSError):
            SupabaseGalleryStorage().url('gallery/image.png')
