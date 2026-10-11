from .models import Notification


def create_booking_notification(*, booking, notification_type, title, message):
    """Persist a notification for the customer who owns a booking."""
    return Notification.objects.create(
        user_id=booking.customer_id,
        booking_id=booking.id,
        notification_type=notification_type,
        title=title,
        message=message,
    )
