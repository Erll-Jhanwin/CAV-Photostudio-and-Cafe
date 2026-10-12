from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from users.models import PasswordResetOTP, PrivacyRequest


class Command(BaseCommand):
    help = 'Review or apply narrowly scoped privacy retention rules. Dry-run is the default.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Apply eligible cleanup after review.')

    def handle(self, *args, **options):
        now = timezone.now()
        reset_cutoff = now - timezone.timedelta(days=settings.PASSWORD_RESET_RETENTION_DAYS)
        request_cutoff = now - timezone.timedelta(days=settings.PRIVACY_REQUEST_RETENTION_DAYS)
        expired_reset = PasswordResetOTP.objects.filter(created_at__lt=reset_cutoff)
        completed_requests = PrivacyRequest.objects.filter(status__in=['COMPLETED', 'REJECTED'], updated_at__lt=request_cutoff)
        self.stdout.write(f'Password reset records eligible: {expired_reset.count()}')
        self.stdout.write(f'Completed privacy requests eligible: {completed_requests.count()}')
        if not options['apply']:
            self.stdout.write(self.style.WARNING('Dry-run only. Re-run with --apply after documented approval.'))
            return
        expired_reset.delete()
        completed_requests.delete()
        self.stdout.write(self.style.SUCCESS('Approved retention cleanup applied. Audit logs were not deleted.'))
