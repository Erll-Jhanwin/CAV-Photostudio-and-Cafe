from django.core import mail
from django.test import TestCase, override_settings
from unittest.mock import patch

from users.email_delivery import EmailDeliveryError, send_password_reset_email, send_transactional_email


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    EMAIL_HOST='smtp.example.test',
    EMAIL_PORT=587,
    EMAIL_HOST_USER='smtp-user',
    EMAIL_HOST_PASSWORD='smtp-secret',
    EMAIL_USE_TLS=True,
    EMAIL_USE_SSL=False,
    DEFAULT_FROM_EMAIL='CAV Photo Studio <studio@example.test>',
    PASSWORD_RESET_OTP_TTL_MINUTES=10,
)
class DjangoSmtpEmailTests(TestCase):
    def test_password_reset_uses_django_email_backend(self):
        send_password_reset_email('customer@example.test', '123456')

        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ['customer@example.test'])
        self.assertEqual(message.from_email, 'CAV Photo Studio <studio@example.test>')
        self.assertIn('123456', message.body)
        self.assertIn('10 minutes', message.body)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend')
    @patch('django.core.mail.backends.smtp.smtplib.SMTP')
    def test_django_smtp_backend_uses_tls_and_environment_settings(self, smtp_class):
        connection = smtp_class.return_value
        connection.sendmail.return_value = {}
        send_transactional_email('customer@example.test', 'Subject', 'Message')

        smtp_class.assert_called_once()
        self.assertEqual(smtp_class.call_args.args, ('smtp.example.test', 587))
        self.assertEqual(smtp_class.call_args.kwargs['timeout'], 20)
        connection.starttls.assert_called_once()
        connection.login.assert_called_once_with('smtp-user', 'smtp-secret')
        connection.sendmail.assert_called_once()

    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend',
        EMAIL_PORT=465,
        EMAIL_USE_TLS=False,
        EMAIL_USE_SSL=True,
    )
    @patch('django.core.mail.backends.smtp.smtplib.SMTP_SSL')
    def test_django_smtp_backend_supports_ssl(self, smtp_ssl_class):
        connection = smtp_ssl_class.return_value
        connection.sendmail.return_value = {}
        send_transactional_email('customer@example.test', 'Subject', 'Message')

        smtp_ssl_class.assert_called_once()
        self.assertEqual(smtp_ssl_class.call_args.args, ('smtp.example.test', 465))
        self.assertEqual(smtp_ssl_class.call_args.kwargs['timeout'], 20)
        self.assertIsNotNone(smtp_ssl_class.call_args.kwargs['context'])
        connection.starttls.assert_not_called()
        connection.login.assert_called_once_with('smtp-user', 'smtp-secret')

    @patch('users.email_delivery.send_mail', side_effect=OSError('auth failed: smtp-secret'))
    def test_smtp_failures_return_safe_error_without_credentials(self, mocked_send_mail):
        with self.assertRaises(EmailDeliveryError) as raised:
            send_transactional_email('customer@example.test', 'Test', 'Body')

        self.assertEqual(str(raised.exception), 'SMTP email delivery failed.')
        self.assertNotIn('smtp-secret', str(raised.exception))
        mocked_send_mail.assert_called_once()
