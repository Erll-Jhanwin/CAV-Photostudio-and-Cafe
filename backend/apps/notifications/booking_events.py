from uuid import uuid4

from .services import create_booking_notification


def booking_message(booking, event, payment_status=None):
    if payment_status is None:
        latest = booking.payments.order_by('-created_at', '-id').first()
        payment_status = latest.get_status_display() if latest else 'Not submitted'
    return (
        f'CAV booking #{booking.id}: {event}. '
        f'Date: {booking.scheduled_date:%Y-%m-%d}; Time: {booking.scheduled_time:%H:%M} (Asia/Manila); '
        f'Package: {booking.package.name}; Booking status: {booking.get_status_display()}; '
        f'Payment status: {payment_status}.'
    )


def notify_booking_created(booking):
    return create_booking_notification(
        booking=booking, notification_type='BOOKING_CREATED', title='Booking request received',
        message=booking_message(booking, 'request submitted'), event_key=f'booking:{booking.id}:created',
        skip_channels={'email'},
    )


def notify_booking_status(booking):
    dedicated_booking_email = booking.status in {'CONFIRMED', 'CONFIRMED_DP', 'COMPLETED'}
    return create_booking_notification(
        booking=booking, notification_type=f'BOOKING_{booking.status}',
        title=f'Booking {booking.get_status_display().lower()}',
        message=booking_message(booking, f'status changed to {booking.get_status_display().lower()}'),
        event_key=f'booking:{booking.id}:status:{uuid4().hex}',
        skip_channels={'email'} if dedicated_booking_email else (),
    )


def notify_booking_updated(booking):
    return create_booking_notification(
        booking=booking, notification_type='BOOKING_UPDATED', title='Booking details updated',
        message=booking_message(booking, 'booking details updated'),
        event_key=f'booking:{booking.id}:updated:{uuid4().hex}',
    )


def notify_booking_payment(payment):
    events = {
        'PENDING_VERIFICATION': ('Payment pending verification', 'payment proof submitted for verification'),
        'APPROVED': ('Payment approved', 'payment has been verified; booking status is now confirmed with down payment'),
        'REJECTED': ('Payment rejected', 'payment proof rejected; please contact staff or submit corrected proof'),
    }
    title, event = events[payment.status]
    return create_booking_notification(
        booking=payment.booking, notification_type=f'BOOKING_PAYMENT_{payment.status}', title=title,
        message=booking_message(payment.booking, event, payment.get_status_display()),
        event_key=f'payment:{payment.id}:{payment.status}:{payment.verified_at.isoformat() if payment.verified_at else "submitted"}',
        skip_channels={'email'} if payment.status == 'APPROVED' else (),
    )
