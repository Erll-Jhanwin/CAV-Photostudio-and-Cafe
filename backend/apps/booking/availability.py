from datetime import date, datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from booking.models import Booking, Package, StudioUnavailableDate

STUDIO_SESSION_SLOT_TIMES = [
    time(9, 0),
    time(10, 0),
    time(11, 0),
    time(13, 0),
    time(14, 0),
    time(15, 0),
    time(16, 0),
    time(17, 0),
    time(18, 0),
]
PHOTO_SERVICE_EVENT_SLOT_TIMES = [
    (time(9, 0), 'Morning'),
    (time(13, 0), 'Afternoon'),
]
BOOKING_SLOT_TIMES = STUDIO_SESSION_SLOT_TIMES
BUSINESS_OPEN_TIME = STUDIO_SESSION_SLOT_TIMES[0]
BUSINESS_CLOSE_TIME = time(19, 0)
ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CONFIRMED_DP']


def parse_date_value(value):
    if isinstance(value, date):
        return value
    return datetime.strptime(value, '%Y-%m-%d').date()


def parse_time_value(value):
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    return datetime.strptime(str(value)[:5], '%H:%M').time()


def get_booking_window(day, start_time, duration_minutes):
    start_dt = datetime.combine(day, start_time)
    end_dt = start_dt + timedelta(minutes=duration_minutes)
    return start_dt, end_dt


def slot_overlaps(slot_day, slot_time, duration_minutes, existing_booking):
    slot_start, slot_end = get_booking_window(slot_day, slot_time, duration_minutes)
    existing_duration = existing_booking.package.service.duration_minutes or 30
    existing_start, existing_end = get_booking_window(
        existing_booking.scheduled_date,
        existing_booking.scheduled_time,
        existing_duration
    )
    return slot_start < existing_end and slot_end > existing_start


def is_photo_service_event_package(package):
    service_name = (getattr(package.service, 'name', '') or '').casefold()
    package_name = (getattr(package, 'name', '') or '').casefold()
    text = f'{service_name} {package_name}'
    return (
        'photo service' in text
        or 'event' in text
        or 'extended photoshoot' in text
    )


def is_studio_session_package(package):
    service_name = (getattr(package.service, 'name', '') or '').casefold()
    package_name = (getattr(package, 'name', '') or '').casefold()
    text = f'{service_name} {package_name}'
    return 'studio session' in text or 'studio' in text


def get_package_slot_times(package):
    if is_photo_service_event_package(package):
        return [
            {
                'time': slot_time,
                'label': label,
                'period': label.upper(),
            }
            for slot_time, label in PHOTO_SERVICE_EVENT_SLOT_TIMES
        ]
    return [
        {
            'time': slot_time,
            'label': slot_time.strftime('%I:%M %p'),
            'period': '',
        }
        for slot_time in STUDIO_SESSION_SLOT_TIMES
    ]


def get_existing_bookings(day, exclude_booking_id=None):
    queryset = Booking.objects.filter(
        scheduled_date=day,
        status__in=ACTIVE_BOOKING_STATUSES
    ).select_related('package', 'package__service')
    if exclude_booking_id:
        queryset = queryset.exclude(id=exclude_booking_id)
    return queryset


def get_studio_unavailable_reason(day, existing_bookings=None):
    manual_block = StudioUnavailableDate.objects.filter(date=day).first()
    if manual_block:
        return manual_block.reason
    for booking in existing_bookings if existing_bookings is not None else get_existing_bookings(day):
        if is_photo_service_event_package(booking.package):
            return 'Unavailable due to an event photoshoot.'
    return ''


def has_active_studio_bookings(existing_bookings):
    return any(is_studio_session_package(booking.package) for booking in existing_bookings)


def get_available_slots(package_id, day, exclude_booking_id=None):
    package = Package.objects.select_related('service').get(id=package_id)
    duration_minutes = package.service.duration_minutes or 30
    now = timezone.localtime()
    existing_bookings = list(get_existing_bookings(day, exclude_booking_id))
    studio_unavailable_reason = (
        get_studio_unavailable_reason(day, existing_bookings)
        if is_studio_session_package(package)
        else ''
    )
    event_unavailable_reason = (
        'Studio sessions already booked on this date.'
        if is_photo_service_event_package(package) and has_active_studio_bookings(existing_bookings)
        else ''
    )
    slots = []

    for slot_definition in get_package_slot_times(package):
        slot_time = slot_definition['time']
        slot_start, slot_end = get_booking_window(day, slot_time, duration_minutes)
        aware_slot_start = timezone.make_aware(slot_start, timezone.get_current_timezone())
        is_past = aware_slot_start <= now
        is_outside_hours = slot_start.time() < BUSINESS_OPEN_TIME or slot_end.time() > BUSINESS_CLOSE_TIME
        is_booked = any(slot_overlaps(day, slot_time, duration_minutes, booking) for booking in existing_bookings)
        if is_past or is_outside_hours:
            status = 'UNAVAILABLE'
            reason = ''
        elif studio_unavailable_reason:
            status = 'STUDIO_UNAVAILABLE'
            reason = studio_unavailable_reason
        elif event_unavailable_reason:
            status = 'BOOKED'
            reason = event_unavailable_reason
        elif is_booked:
            status = 'BOOKED'
            reason = ''
        else:
            status = 'AVAILABLE'
            reason = ''
        slots.append({
            'time': slot_time.strftime('%H:%M:%S'),
            'label': slot_definition['label'],
            'display_time': slot_time.strftime('%I:%M %p'),
            'period': slot_definition['period'],
            'status': status,
            'reason': reason,
            'notice': reason,
            'available': status == 'AVAILABLE',
        })

    return slots


def is_slot_available(package_id, day, slot_time, exclude_booking_id=None):
    slot_time = parse_time_value(slot_time)
    return any(
        slot['time'] == slot_time.strftime('%H:%M:%S') and slot['available']
        for slot in get_available_slots(package_id, day, exclude_booking_id)
    )
