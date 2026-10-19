"""Explicit-confirmation booking actions exposed through the chatbot."""

import re

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from audit.models import AuditLog
from booking.availability import is_slot_available, parse_date_value, parse_time_value
from booking.models import Booking, BookingDateLock, Package
from booking.serializers import BookingSerializer
from chatbot.booking_assistant import get_matching_packages, parse_requested_date, parse_requested_time


class ChatActionError(Exception):
    def __init__(self, message, action=None, status='invalid'):
        super().__init__(message)
        self.message = message
        self.action = action
        self.status = status


def _lang_text(lang, en, tl):
    return tl if lang == 'tl' else en


def _int(value, field):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ChatActionError(f'{field} must be a valid number.')


def _package(action):
    package_id = action.get('package_id') or action.get('package')
    if not package_id:
        raise ChatActionError('Please provide a package.')
    try:
        return Package.objects.select_related('service').get(id=int(package_id))
    except (Package.DoesNotExist, TypeError, ValueError):
        raise ChatActionError('That package is not available in the database.')


def _schedule(action, fallback=None):
    fallback_date = getattr(fallback, 'scheduled_date', None)
    fallback_time = getattr(fallback, 'scheduled_time', None)
    try:
        day = parse_date_value(action.get('scheduled_date') or action.get('date') or fallback_date)
        clock = parse_time_value(action.get('scheduled_time') or action.get('time') or fallback_time)
    except (TypeError, ValueError):
        raise ChatActionError('Please provide a valid date (YYYY-MM-DD) and time (HH:MM).')
    return day, clock


def _public_action(action, package=None, booking=None):
    result = {
        'type': action.get('type'),
        'status': action.get('status', 'proposed'),
    }
    if package:
        result.update({'package_id': package.id, 'package_name': package.name, 'price': str(package.price)})
    if booking:
        result.update({'booking_id': booking.id, 'current_status': booking.status})
    for key in ('scheduled_date', 'scheduled_time', 'notes'):
        if key in action and action[key] is not None:
            result[key] = str(action[key])
    return result


def _availability_message(package, day, clock, lang, exclude_booking_id=None):
    if is_slot_available(package.id, day, clock, exclude_booking_id=exclude_booking_id):
        return None
    return _lang_text(
        lang,
        f'{package.name} is not available on {day.isoformat()} at {clock.strftime("%I:%M %p").lstrip("0")}. Please choose another slot.',
        f'Hindi available ang {package.name} sa {day.isoformat()} ng {clock.strftime("%I:%M %p").lstrip("0")}. Pumili ng ibang slot.',
    )


def _profile_payload(user, package, day, clock, idempotency_key):
    return {
        'package': package.id,
        'scheduled_date': day.isoformat(),
        'scheduled_time': clock.strftime('%H:%M'),
        'first_name': user.first_name or user.get_full_name() or user.username,
        'last_name': user.last_name or '',
        'email': user.email or '',
        'phone_number': user.phone_number or '',
        'idempotency_key': idempotency_key,
        'items': [],
    }


@transaction.atomic
def execute_chat_action(action, request, lang='en'):
    """Execute only an authenticated, explicitly confirmed action."""
    if not request.user or not request.user.is_authenticated:
        raise ChatActionError(
            _lang_text(lang, 'Please log in before creating or changing a booking.', 'Mag-log in muna bago gumawa o magbago ng booking.'),
            status='authentication_required',
        )
    if not isinstance(action, dict):
        raise ChatActionError('Action must be an object.')
    action = {str(key): value for key, value in action.items()}
    action_type = str(action.get('type') or '').upper()
    if action_type not in {'CREATE_BOOKING', 'UPDATE_BOOKING', 'CANCEL_BOOKING'}:
        raise ChatActionError('This booking action is not supported.')
    if not action.get('confirm'):
        raise ChatActionError('Confirmation is required before changing a booking.', status='confirmation_required')

    if action_type == 'CANCEL_BOOKING':
        booking_id = _int(action.get('booking_id'), 'booking_id')
        try:
            booking = Booking.objects.select_for_update().get(id=booking_id, customer=request.user)
        except Booking.DoesNotExist:
            raise ChatActionError('That booking was not found or is not yours.')
        if booking.status not in {'PENDING', 'CANCELLED'}:
            raise ChatActionError('Only pending bookings can be cancelled from chat. Please contact staff for help.')
        if booking.status != 'CANCELLED':
            booking.status = 'CANCELLED'
            booking.save(update_fields=['status'])
            AuditLog.objects.create(user=request.user, action='BOOKING_CANCEL', description=f'Customer cancelled booking #{booking.id} through chatbot.')
            from notifications.booking_events import notify_booking_status
            notify_booking_status(booking)
        return {
            'response': _lang_text(lang, f'Booking #{booking.id} has been cancelled.', f'Nakansela na ang booking #{booking.id}.'),
            'action': _public_action({'type': action_type, 'status': 'completed'}, booking=booking),
            'source': 'booking_action',
        }

    try:
        booking = None
        if action_type == 'UPDATE_BOOKING':
            booking_id = _int(action.get('booking_id'), 'booking_id')
            booking = Booking.objects.select_for_update().get(id=booking_id, customer=request.user)
            if not booking.is_customer_editable:
                raise ChatActionError(booking.customer_edit_lock_reason or 'This booking can no longer be edited.')
        package = _package(action) if action_type == 'CREATE_BOOKING' or action.get('package_id') or action.get('package') else booking.package
        day, clock = _schedule(action, booking)
    except ChatActionError:
        raise
    except Booking.DoesNotExist:
        raise ChatActionError('That booking was not found or is not yours.')

    if action_type == 'CREATE_BOOKING' and not user_profile_complete(request.user):
        raise ChatActionError(
            _lang_text(lang, 'Please complete your profile name, email, and phone number before booking through chat.', 'Kumpletuhin muna ang pangalan, email, at phone number sa profile bago mag-book sa chat.'),
            status='profile_required',
        )

    idempotency_key = str(action.get('idempotency_key') or f'chat-{request.user.id}-{package.id}-{day.isoformat()}-{clock.strftime("%H%M")}')[:100]
    if action_type == 'CREATE_BOOKING':
        existing = Booking.objects.filter(customer=request.user, idempotency_key=idempotency_key).first()
        if existing:
            return {
                'response': _lang_text(lang, f'Booking #{existing.id} was already created.', f'Nagawa na ang booking #{existing.id}.'),
                'action': _public_action({'type': action_type, 'status': 'completed'}, existing.package, existing),
                'source': 'booking_action',
            }
    conflict = _availability_message(package, day, clock, lang, booking.id if booking else None)
    if conflict:
        raise ChatActionError(conflict, status='slot_unavailable')

    if action_type == 'UPDATE_BOOKING':
        payload = {
            'package': package.id,
            'scheduled_date': day.isoformat(),
            'scheduled_time': clock.strftime('%H:%M'),
        }
        if action.get('notes') is not None:
            payload['notes'] = str(action.get('notes'))[:1000]
        serializer = BookingSerializer(booking, data=payload, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            lock, _ = BookingDateLock.objects.get_or_create(scheduled_date=day)
            BookingDateLock.objects.select_for_update().get(pk=lock.pk)
            if not is_slot_available(package.id, day, clock, exclude_booking_id=booking.id):
                raise ChatActionError(_lang_text(lang, 'That slot was just taken. Please choose another one.', 'Kinuha na ang slot. Pumili ng iba.'), status='slot_unavailable')
            old_values = {field: str(booking.package_id if field == 'package' else getattr(booking, field) or '') for field in payload}
            updated = serializer.save()
            new_values = {field: str(updated.package_id if field == 'package' else getattr(updated, field) or '') for field in payload}
            changed = [field for field in old_values if old_values[field] != new_values[field]]
            if changed:
                history = list(updated.change_history or [])
                history.insert(0, {
                    'id': len(history) + 1, 'changed_by': request.user.id,
                    'changed_by_name': request.user.get_full_name() or request.user.username,
                    'old_values': {field: old_values[field] for field in changed},
                    'new_values': {field: new_values[field] for field in changed},
                    'reason': 'Customer updated booking through chat', 'created_at': timezone.now().isoformat(),
                })
                updated.change_history = history
                updated.save(update_fields=['change_history'])
                AuditLog.objects.create(user=request.user, action='BOOKING_UPDATE', description=f'Updated booking #{updated.id} through chatbot.')
                from notifications.booking_events import notify_booking_updated
                notify_booking_updated(updated)
        return {
            'response': _lang_text(lang, f'Booking #{updated.id} was updated successfully.', f'Na-update na ang booking #{updated.id}.'),
            'action': _public_action({'type': action_type, 'status': 'completed', 'scheduled_date': day, 'scheduled_time': clock}, package, updated),
            'source': 'booking_action',
        }

    idempotency_key = str(action.get('idempotency_key') or f'chat-{request.user.id}-{package.id}-{day.isoformat()}-{clock.strftime("%H%M")}')[:100]
    payload = _profile_payload(request.user, package, day, clock, idempotency_key)
    serializer = BookingSerializer(data=payload, context={'request': request})
    serializer.is_valid(raise_exception=True)
    try:
        with transaction.atomic():
            lock, _ = BookingDateLock.objects.get_or_create(scheduled_date=day)
            BookingDateLock.objects.select_for_update().get(pk=lock.pk)
            existing = Booking.objects.filter(customer=request.user, idempotency_key=idempotency_key).first()
            if existing:
                booking = existing
            else:
                if not is_slot_available(package.id, day, clock):
                    raise ChatActionError(_lang_text(lang, 'That slot was just taken. Please choose another one.', 'Kinuha na ang slot. Pumili ng iba.'), status='slot_unavailable')
                booking = serializer.save(items=[])
                AuditLog.objects.create(user=request.user, action='BOOKING_CREATE', description=f'Created booking #{booking.id} through chatbot.')
                from notifications.booking_events import notify_booking_created
                notify_booking_created(booking)
    except IntegrityError:
        raise ChatActionError(_lang_text(lang, 'That slot was just taken. Please choose another one.', 'Kinuha na ang slot. Pumili ng iba.'), status='slot_unavailable')
    return {
        'response': _lang_text(lang, f'Booking #{booking.id} was created successfully for {package.name} on {day.isoformat()} at {clock.strftime("%I:%M %p").lstrip("0")}.', f'Nagawa na ang booking #{booking.id} para sa {package.name} sa {day.isoformat()} ng {clock.strftime("%I:%M %p").lstrip("0")}.'),
        'action': _public_action({'type': action_type, 'status': 'completed', 'scheduled_date': day, 'scheduled_time': clock}, package, booking),
        'source': 'booking_action',
    }


def user_profile_complete(user):
    return bool((user.get_full_name() or user.username).strip() and str(user.email or '').strip() and str(user.phone_number or '').strip())


def propose_chat_action(action, request, lang='en'):
    """Validate a proposed action and return a safe confirmation payload."""
    if not request.user or not request.user.is_authenticated:
        return {
            'response': _lang_text(lang, 'Please log in before creating or changing a booking.', 'Mag-log in muna bago gumawa o magbago ng booking.'),
            'action': {'type': action.get('type'), 'status': 'authentication_required'},
            'source': 'booking_action',
        }
    action = dict(action)
    action['confirm'] = False
    action_type = str(action.get('type') or '').upper()
    if action_type == 'CANCEL_BOOKING':
        booking_id = _int(action.get('booking_id'), 'booking_id')
        try:
            booking = Booking.objects.get(id=booking_id, customer=request.user)
        except Booking.DoesNotExist:
            raise ChatActionError('That booking was not found or is not yours.')
        return {
            'response': _lang_text(lang, f'Please confirm cancelling booking #{booking.id}.', f'Kumpirmahin ang pagkansela ng booking #{booking.id}.'),
            'action': _public_action({'type': action_type, 'status': 'confirmation_required'}, booking=booking),
            'source': 'booking_action',
        }

    if action_type == 'UPDATE_BOOKING':
        try:
            booking = Booking.objects.get(id=_int(action.get('booking_id'), 'booking_id'), customer=request.user)
        except Booking.DoesNotExist:
            raise ChatActionError('That booking was not found or is not yours.')
        if not booking.is_customer_editable:
            raise ChatActionError(booking.customer_edit_lock_reason or 'This booking can no longer be edited.')
        package = _package(action) if action.get('package_id') or action.get('package') else booking.package
    else:
        booking = None
        package = _package(action)
        day, clock = _schedule(action, booking)
    conflict = _availability_message(package, day, clock, lang, booking.id if booking else None)
    if conflict:
        raise ChatActionError(conflict, status='slot_unavailable')
    summary = _lang_text(
        lang,
        f'Please confirm {"updating" if booking else "creating"} {package.name} on {day.isoformat()} at {clock.strftime("%I:%M %p").lstrip("0")}.',
        f'Kumpirmahin ang {"pag-update" if booking else "paggawa"} ng {package.name} sa {day.isoformat()} ng {clock.strftime("%I:%M %p").lstrip("0")}.',
    )
    return {
        'response': summary,
        'action': _public_action({**action, 'type': action_type, 'status': 'confirmation_required', 'scheduled_date': day, 'scheduled_time': clock}, package, booking),
        'source': 'booking_action',
    }


def draft_action_from_question(question, request):
    """Create a proposal only when the message contains unambiguous booking data."""
    q = str(question or '').casefold()
    booking_match = re.search(r'\b(?:booking|reservation)\s*#?\s*(\d+)\b', q)
    if booking_match and any(term in q for term in ('cancel', 'cancellation', 'kansela')):
        return {'type': 'CANCEL_BOOKING', 'booking_id': int(booking_match.group(1))}
    if booking_match and any(term in q for term in ('change', 'reschedule', 'move', 'update', 'modify', 'ilipat', 'baguhin')):
        day = parse_requested_date(question)
        clock = parse_requested_time(question)
        packages = get_matching_packages(question)
        if (day or clock or len(packages) == 1):
            action = {
                'type': 'UPDATE_BOOKING',
                'booking_id': int(booking_match.group(1)),
            }
            if day:
                action['scheduled_date'] = day.isoformat()
            if clock:
                action['scheduled_time'] = clock.strftime('%H:%M')
            if len(packages) == 1:
                action['package_id'] = packages[0].id
            return action
    if not any(term in q for term in ('book ', 'book me', 'reserve', 'mag book', 'mag-book')):
        return None
    day = parse_requested_date(question)
    clock = parse_requested_time(question)
    packages = get_matching_packages(question)
    if not day or not clock or len(packages) != 1:
        return None
    return {
        'type': 'CREATE_BOOKING',
        'package_id': packages[0].id,
        'scheduled_date': day.isoformat(),
        'scheduled_time': clock.strftime('%H:%M'),
    }
