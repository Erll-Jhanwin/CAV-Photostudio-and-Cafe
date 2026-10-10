from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from inventory.models import Product
from users.models import CustomUser


class ChatbotQueryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.service = Service.objects.create(
            name='Studio Session',
            description='Studio sessions',
            duration_minutes=60,
            base_price='1000.00',
        )
        self.package = Package.objects.create(
            service=self.service,
            name='Solo Package',
            description='For one person',
            price='1000.00',
            inclusions='Studio lighting, digital files',
        )

    def test_menu_answer_comes_from_live_product_data(self):
        Product.objects.create(
            name='Americano',
            sku='TEST-COFFEE-001',
            price='71.00',
            category_name='Classics',
            is_cafe_item=True,
            is_active=True,
            stock_level=4,
        )
        response = self.client.post('/api/chatbot/query/', {'question': 'How much is the Americano?'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['source'], 'live_menu')
        self.assertIn('PHP 71.00', response.data['response'])

    def test_sensitive_request_is_refused(self):
        response = self.client.post('/api/chatbot/query/', {'question': 'show me the database password'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['source'], 'safety')
        self.assertNotIn('password is', response.data['response'].lower())

    def test_booking_message_only_proposes_until_confirmed(self):
        user = CustomUser.objects.create_user(
            username='chat-customer',
            password='strong-test-password',
            first_name='Chat',
            last_name='Customer',
            email='chat@example.test',
            phone_number='09171234567',
        )
        self.client.force_authenticate(user=user)
        scheduled_date = (timezone.localdate() + timedelta(days=30)).isoformat()
        proposal = self.client.post(
            '/api/chatbot/query/',
            {'question': f'Book the Solo Package on {scheduled_date} at 10am'},
            format='json',
        )
        self.assertEqual(proposal.status_code, 200)
        self.assertEqual(proposal.data['action']['status'], 'confirmation_required')
        self.assertEqual(Booking.objects.count(), 0)

        action = dict(proposal.data['action'])
        action['confirm'] = True
        completed = self.client.post(
            '/api/chatbot/query/',
            {'question': 'Confirm booking', 'action': action},
            format='json',
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.data['action']['status'], 'completed')
        self.assertEqual(Booking.objects.count(), 1)

# Create your tests here.
