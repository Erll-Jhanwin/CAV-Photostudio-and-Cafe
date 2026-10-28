from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from audit.models import AuditLog
from audit.recorder import module_for_action, safe_change_details


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

    def test_audit_logs_cannot_be_deleted(self):
        record = AuditLog.objects.create(user=self.admin, action='TEST', description='immutable')
        with self.assertRaises(PermissionError):
            AuditLog.objects.filter(pk=record.pk).delete()
        with self.assertRaises(PermissionError):
            record.delete()
        with self.assertRaises(PermissionError):
            AuditLog.objects.filter(pk=record.pk).update(description='changed')
        with self.assertRaises(PermissionError):
            record.description = 'changed'

    def test_admin_can_search_and_page_audit_logs(self):
        for index in range(27):
            AuditLog.objects.create(
                user=self.admin,
                action='BOOKING_UPDATE' if index < 2 else 'INVENTORY_ADJUST',
                description=f'Activity {index}',
                module='bookings' if index < 2 else 'inventory',
                record_reference=str(index),
            )

        response = self.client.get('/api/audit/logs/?search=Activity&page=2&page_size=10')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 27)
        self.assertEqual(len(response.data['results']), 10)

        filtered = self.client.get('/api/audit/logs/?module=bookings')
        self.assertEqual(filtered.data['count'], 2)
        self.assertTrue(all(row['role'] == 'ADMIN' for row in filtered.data['results']))

    def test_customer_cannot_read_audit_logs(self):
        customer = get_user_model().objects.create_user(username='audit-customer', password='CustomerPass123!', role='CUSTOMER')
        self.client.force_authenticate(customer)
        self.assertEqual(self.client.get('/api/audit/logs/').status_code, 403)

    def test_admin_error_filter_includes_payment_verification_issues(self):
        issue = AuditLog.objects.create(
            user=self.admin,
            action='BOOKING_PAYMENT_REJECTED',
            description='A previously approved payment was rejected after review.',
            metadata={'payment_id': 5, 'booking_id': 7, 'verification_issue': True},
        )
        AuditLog.objects.create(user=self.admin, action='BOOKING_CREATE', description='Booking created.')
        response = self.client.get('/api/audit/logs/?kind=errors')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data['results']], [issue.id])

        staff = get_user_model().objects.create_user(username='audit-staff', role='STAFF')
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get('/api/audit/logs/?kind=errors').status_code, 403)

    def test_change_details_never_include_sensitive_fields_or_values(self):
        details = safe_change_details({'status': 'CONFIRMED', 'password': 'secret', 'otp_code': '123456', 'payment_reference': 'ABC'})
        self.assertEqual(details, {'changed_fields': ['payment_reference', 'status']})

    def test_historical_action_module_is_inferred_without_rewriting_the_record(self):
        self.assertEqual(module_for_action('BOOKING_PAYMENT_SUBMIT'), 'bookings')
        self.assertEqual(module_for_action('POS_PAYMENT'), 'pos')

    def test_persisted_audit_record_redacts_sensitive_metadata(self):
        record = AuditLog.objects.create(
            user=self.admin,
            action='TEST',
            description='Bearer abc.def.ghi was removed',
            metadata={'otp': '123456', 'safe': 'ok', 'nested': {'refresh_token': 'secret'}},
        )
        self.assertEqual(record.metadata, {'safe': 'ok', 'nested': {}})
        self.assertNotIn('abc.def.ghi', record.description)

    def test_actor_snapshot_survives_account_deletion(self):
        actor_id = self.admin.pk
        record = AuditLog.objects.create(user=self.admin, action='ADMIN_ACCOUNT_DELETE', description='Account deleted')
        self.admin.delete()
        record.refresh_from_db()
        self.assertIsNone(record.user)
        self.assertEqual(record.actor_user_id, actor_id)
        self.assertEqual(record.actor_name, 'runtime-admin')

    def test_health_endpoint_exposes_only_service_status(self):
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data if hasattr(response, 'data') else response.json(), {'status': 'ok', 'database': 'ok'})
