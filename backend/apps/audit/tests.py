from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from audit.models import AuditLog


class ClientRuntimeErrorViewTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(
            username='runtime-admin',
            password='AdminPass123!',
            role='ADMIN',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_admin_can_record_and_review_a_client_runtime_error(self):
        response = self.client.post('/api/audit/client-runtime-errors/', {
            'message': 'Cannot read properties of undefined',
            'component_stack': 'at AdminDashboard',
            'route': '/admin',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        record = AuditLog.objects.get(action='CLIENT_RUNTIME_ERROR')
        self.assertEqual(record.user, self.admin)
        self.assertEqual(record.metadata['route'], '/admin')

        list_response = self.client.get('/api/audit/client-runtime-errors/')
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data[0]['id'], record.id)

    def test_non_admin_cannot_access_client_runtime_errors(self):
        customer = get_user_model().objects.create_user(
            username='runtime-customer',
            password='CustomerPass123!',
            role='CUSTOMER',
        )
        self.client.force_authenticate(customer)

        response = self.client.post('/api/audit/client-runtime-errors/', {
            'message': 'Client error',
            'route': '/admin',
        }, format='json')

        self.assertEqual(response.status_code, 403)
