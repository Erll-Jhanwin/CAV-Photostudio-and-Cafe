from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from booking.email_notifications import (
    cancel_booking_reminders,
    queue_booking_approved,
    queue_booking_completed,
    queue_booking_submitted,
    schedule_booking_reminder,
)
from booking.models import Booking


@receiver(pre_save, sender=Booking)
def capture_booking_email_state(sender, instance, **kwargs):
    if not instance.pk:
        instance._email_previous_state = None
        return
    instance._email_previous_state = sender.objects.filter(pk=instance.pk).values(
        'status', 'scheduled_date', 'scheduled_time'
    ).first()


@receiver(post_save, sender=Booking)
def enqueue_booking_lifecycle_emails(sender, instance, created, **kwargs):
    booking = sender.objects.select_related('customer', 'package', 'package__service').get(pk=instance.pk)
    if created:
        queue_booking_submitted(booking)
        return
    previous = getattr(instance, '_email_previous_state', None)
    if not previous:
        return
    status_changed = previous['status'] != instance.status
    schedule_changed = (previous['scheduled_date'], previous['scheduled_time']) != (booking.scheduled_date, booking.scheduled_time)
    if status_changed and booking.status == 'CANCELLED':
        cancel_booking_reminders(booking)
    elif schedule_changed or (status_changed and booking.status in {'PENDING', 'CONFIRMED', 'CONFIRMED_DP'}):
        schedule_booking_reminder(booking)
    if status_changed and booking.status in {'CONFIRMED', 'CONFIRMED_DP'}:
        queue_booking_approved(booking)
    if status_changed and previous['status'] in {'PENDING', 'CONFIRMED', 'CONFIRMED_DP'} and booking.status == 'COMPLETED':
        queue_booking_completed(booking)
