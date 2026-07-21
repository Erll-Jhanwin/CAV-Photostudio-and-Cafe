import re
from datetime import date, datetime, timedelta

from django.utils import timezone

from booking.availability import (
    ACTIVE_BOOKING_STATUSES,
    BOOKING_SLOT_TIMES,
    BUSINESS_CLOSE_TIME,
    BUSINESS_OPEN_TIME,
    get_available_slots,
    parse_time_value,
)
from booking.models import Booking, Package, Service


TAGALOG_MARKERS = {
    'ako', 'akin', 'ang', 'ano', 'anong', 'araw', 'ba', 'bakante', 'bukas',
    'gusto', 'hanggang', 'kailan', 'kailangan', 'kamusta', 'kung', 'lang',
    'may', 'meron', 'ng', 'ngayon', 'oras', 'pa', 'pakete', 'para', 'petsa',
    'po', 'puwede', 'pwede', 'sa', 'saan',
    'sinong', 'tanong', 'wala',
}

BOOKING_TERMS = {
    'appointment', 'appointments', 'availability', 'available', 'book',
    'booked', 'booking', 'bookings', 'date', 'dates', 'hour', 'hours',
    'open', 'package', 'packages', 'reservation', 'reserve', 'schedule',
    'scheduled', 'slot', 'slots', 'time', 'times', 'unavailable',
    'oras', 'bukas', 'sarado', 'iskedyul', 'petsa', 'pakete', 'bakante',
    'libre', 'available', 'availability', 'reserba',
    'service', 'services',
}

PACKAGE_STOPWORDS = {
    'and', 'ang', 'available', 'availability', 'book', 'booking', 'cav',
    'check', 'date', 'for', 'is', 'ng', 'package', 'packages', 'photo',
    'sa', 'schedule', 'service', 'session', 'slot', 'slots', 'studio',
    'the', 'time',
}

OBSOLETE_SERVICE_NAMES = ['Self-Shoot Studio', 'Boutique Portrait']

WEEKDAYS = {
    'monday': 0, 'mon': 0,
    'tuesday': 1, 'tue': 1,
    'wednesday': 2, 'wed': 2,
    'thursday': 3, 'thu': 3,
    'friday': 4, 'fri': 4,
    'saturday': 5, 'sat': 5,
    'sunday': 6, 'sun': 6,
}

MONTHS = {
    'january': 1, 'jan': 1,
    'february': 2, 'feb': 2,
    'march': 3, 'mar': 3,
    'april': 4, 'apr': 4,
    'may': 5,
    'june': 6, 'jun': 6,
    'july': 7, 'jul': 7,
    'august': 8, 'aug': 8,
    'september': 9, 'sep': 9, 'sept': 9,
    'october': 10, 'oct': 10,
    'november': 11, 'nov': 11,
    'december': 12, 'dec': 12,
}


def normalize_text(value):
    return re.sub(r'[^a-z0-9:/\-\s]', ' ', value.lower())


def detect_language(question):
    words = set(normalize_text(question).split())
    tagalog_hits = len(words.intersection(TAGALOG_MARKERS))
    return 'tl' if tagalog_hits >= 1 else 'en'


def is_booking_related(question):
    words = set(normalize_text(question).split())
    q = normalize_text(question)
    return bool(words.intersection(BOOKING_TERMS)) or any(term in q for term in ['walk in', 'walk-in'])


def format_time(value):
    return value.strftime('%I:%M %p').lstrip('0')


def business_hours_text(lang):
    open_text = format_time(BUSINESS_OPEN_TIME)
    close_text = format_time(BUSINESS_CLOSE_TIME)
    last_text = format_time(max(BOOKING_SLOT_TIMES))
    if lang == 'tl':
        return f"Open kami araw-araw mula {open_text} hanggang {close_text} Philippine time (Asia/Manila, UTC+8). Ang huling regular one-hour booking slot ay {last_text}."
    return f"We are open daily from {open_text} to {close_text} Philippine time (Asia/Manila, UTC+8). The last regular one-hour booking slot starts at {last_text}."


def parse_requested_date(question):
    q = normalize_text(question)
    today = timezone.localdate()

    iso_match = re.search(r'\b(20\d{2})-(\d{1,2})-(\d{1,2})\b', q)
    if iso_match:
        try:
            return date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))
        except ValueError:
            return None

    slash_match = re.search(r'\b(\d{1,2})/(\d{1,2})/(20\d{2})\b', q)
    if slash_match:
        first = int(slash_match.group(1))
        second = int(slash_match.group(2))
        year = int(slash_match.group(3))
        for month, day in ((first, second), (second, first)):
            try:
                return date(year, month, day)
            except ValueError:
                continue

    if any(word in q.split() for word in ['today', 'ngayon']):
        return today
    if 'day after tomorrow' in q or 'makalawa' in q:
        return today + timedelta(days=2)
    if any(word in q.split() for word in ['tomorrow', 'bukas']):
        return today + timedelta(days=1)

    month_match = re.search(
        r'\b(' + '|'.join(MONTHS.keys()) + r')\s+(\d{1,2})(?:\s*,?\s*(20\d{2}))?\b',
        q
    )
    if month_match:
        month = MONTHS[month_match.group(1)]
        day = int(month_match.group(2))
        year = int(month_match.group(3) or today.year)
        try:
            parsed = date(year, month, day)
            if parsed < today and not month_match.group(3):
                parsed = date(year + 1, month, day)
            return parsed
        except ValueError:
            return None

    for word, weekday in WEEKDAYS.items():
        if re.search(rf'\b(next\s+)?{word}\b', q):
            days_ahead = (weekday - today.weekday()) % 7
            if days_ahead == 0 or f'next {word}' in q:
                days_ahead = 7
            return today + timedelta(days=days_ahead)

    return None


def parse_requested_time(question):
    q = normalize_text(question)

    compact = re.search(r'\b(\d{1,2})(am|pm)\b', q)
    colon_time = re.search(r'\b(\d{1,2}):(\d{2})\s*(am|pm)?\b', q)
    meridiem_time = re.search(r'\b(\d{1,2})\s*(am|pm)\b', q)
    contextual = re.search(r'\b(?:at|ng|sa)\s+(\d{1,2})\s*(am|pm)?\b', q)

    if compact:
        hour = int(compact.group(1))
        minute = 0
        meridiem = compact.group(2)
    elif colon_time:
        hour = int(colon_time.group(1))
        minute = int(colon_time.group(2))
        meridiem = colon_time.group(3)
    elif meridiem_time:
        hour = int(meridiem_time.group(1))
        minute = 0
        meridiem = meridiem_time.group(2)
    elif contextual:
        hour = int(contextual.group(1))
        minute = 0
        meridiem = contextual.group(2)
    else:
        return None

    if meridiem == 'pm' and hour != 12:
        hour += 12
    elif meridiem == 'am' and hour == 12:
        hour = 0
    elif meridiem is None and 1 <= hour <= 7:
        hour += 12

    try:
        return parse_time_value(f'{hour:02d}:{minute:02d}')
    except ValueError:
        return None


def get_matching_packages(question):
    q = normalize_text(question)
    query_words = set(q.split()) - PACKAGE_STOPWORDS
    packages = list(
        Package.objects.select_related('service')
        .exclude(service__name__in=OBSOLETE_SERVICE_NAMES)
        .order_by('service__name', 'name')
    )
    matches = []

    for package in packages:
        package_name = normalize_text(package.name)
        service_name = normalize_text(package.service.name if package.service else '')
        package_words = (set(package_name.split()) | set(service_name.split())) - PACKAGE_STOPWORDS

        if package_name and package_name in q:
            score = 100
        elif service_name and service_name in q:
            score = 50
        else:
            score = len(query_words.intersection(package_words))

        if score > 0:
            matches.append((score, package))

    matches.sort(key=lambda item: (-item[0], item[1].name))
    return [package for _, package in matches]


def format_package_list(packages, lang, limit=8):
    if not packages:
        return "Wala pang packages sa database." if lang == 'tl' else "There are no packages in the database yet."
    rows = []
    for package in packages[:limit]:
        rows.append(f"- {package.name} ({package.service.name}): PHP {package.price}")
    return "\n".join(rows)


def get_live_services():
    return list(
        Service.objects.exclude(name__in=OBSOLETE_SERVICE_NAMES)
        .prefetch_related('packages')
        .order_by('name')
    )


def format_service_list(services, lang, limit=8):
    if not services:
        return "Wala pang services sa database." if lang == 'tl' else "There are no services in the database yet."
    rows = []
    for service in services[:limit]:
        package_count = len([package for package in service.packages.all() if package.service_id == service.id])
        rows.append(
            f"- {service.name}: starts at PHP {service.base_price}, "
            f"{service.duration_minutes} minutes, {package_count} package{'s' if package_count != 1 else ''}"
        )
    return "\n".join(rows)


def available_slots_for(package, day):
    return get_available_slots(package.id, day)


def slot_for_time(slots, requested_time):
    if not requested_time:
        return None
    requested_key = requested_time.strftime('%H:%M:%S')
    return next((slot for slot in slots if slot['time'] == requested_key), None)


def find_nearest_available(package, start_day=None, after_time=None, max_days=45, max_dates=3, max_slots_per_date=3):
    today = timezone.localdate()
    start_day = max(start_day or today, today)
    results = []

    for offset in range(max_days + 1):
        current_day = start_day + timedelta(days=offset)
        slots = available_slots_for(package, current_day)
        available = []
        for slot in slots:
            if not slot['available']:
                continue
            slot_time = parse_time_value(slot['time'])
            if offset == 0 and after_time and slot_time <= after_time:
                continue
            available.append(slot)
        if available:
            results.append({'date': current_day, 'slots': available[:max_slots_per_date]})
            if len(results) >= max_dates:
                break

    return results


def format_recommendations(recommendations, lang):
    if not recommendations:
        return "Wala akong nakitang available slots sa susunod na 45 araw." if lang == 'tl' else "I couldn't find available slots in the next 45 days."

    parts = []
    for item in recommendations:
        slots = ", ".join(slot['label'] for slot in item['slots'])
        parts.append(f"{item['date'].isoformat()}: {slots}")
    if lang == 'tl':
        return "Pinakamalapit na available na options:\n" + "\n".join(f"- {part}" for part in parts)
    return "Nearest available options:\n" + "\n".join(f"- {part}" for part in parts)


def format_slots_summary(package, day, lang):
    slots = available_slots_for(package, day)
    available = [slot['label'] for slot in slots if slot['available']]
    booked = [slot['label'] for slot in slots if slot['status'] == 'BOOKED']
    unavailable = [slot['label'] for slot in slots if slot['status'] == 'UNAVAILABLE']

    if lang == 'tl':
        lines = [f"Live availability para sa {package.name} sa {day.isoformat()}:"]
        lines.append("Available slots: " + (", ".join(available) if available else "wala"))
        lines.append("Booked slots: " + (", ".join(booked) if booked else "wala"))
        lines.append("Unavailable/past/outside business hours: " + (", ".join(unavailable) if unavailable else "wala"))
        return "\n".join(lines)

    lines = [f"Live availability for {package.name} on {day.isoformat()}:"]
    lines.append("Available slots: " + (", ".join(available) if available else "none"))
    lines.append("Booked slots: " + (", ".join(booked) if booked else "none"))
    lines.append("Unavailable/past/outside business hours: " + (", ".join(unavailable) if unavailable else "none"))
    return "\n".join(lines)


def format_user_bookings(user, lang):
    if not user or not user.is_authenticated:
        return "Mag-log in muna para makita ko ang bookings mo." if lang == 'tl' else "Please log in first so I can check your bookings."

    queryset = Booking.objects.select_related('customer', 'package__service').order_by('-created_at')
    if user.role not in ['STAFF', 'ADMIN']:
        queryset = queryset.filter(customer=user)
    bookings = list(queryset[:10])

    if not bookings:
        return "Wala akong nakitang bookings." if lang == 'tl' else "No bookings found."

    title = "Narito ang latest bookings:" if lang == 'tl' else "Here are the latest bookings:"
    lines = [title]
    for booking in bookings:
        customer = booking.customer.get_full_name() or booking.customer.username
        customer_text = f"{customer} | " if user.role in ['STAFF', 'ADMIN'] else ""
        lines.append(
            f"- {customer_text}{booking.scheduled_date} {format_time(booking.scheduled_time)} | "
            f"{booking.package.name} | {booking.status}"
        )
    return "\n".join(lines)


def format_booked_schedules(day, lang):
    bookings = list(
        Booking.objects.select_related('package', 'package__service')
        .filter(scheduled_date=day, status__in=ACTIVE_BOOKING_STATUSES)
        .order_by('scheduled_time')[:20]
    )
    if not bookings:
        return (
            f"Walang booked active schedules sa {day.isoformat()}."
            if lang == 'tl'
            else f"There are no active booked schedules on {day.isoformat()}."
        )

    if lang == 'tl':
        lines = [f"Booked/unavailable active schedules sa {day.isoformat()}:"]
    else:
        lines = [f"Booked/unavailable active schedules on {day.isoformat()}:"]
    for booking in bookings:
        lines.append(f"- {format_time(booking.scheduled_time)} | {booking.package.name} | {booking.status}")
    return "\n".join(lines)


def asks_for_own_bookings(question):
    q = normalize_text(question)
    return (
        ('my booking' in q or 'my bookings' in q or 'booking ko' in q or 'mga booking ko' in q)
        or (('list' in q or 'show' in q or 'pakita' in q) and ('booking' in q or 'bookings' in q))
    )


def asks_for_packages(question):
    q = normalize_text(question)
    return any(term in q for term in ['package', 'packages', 'pakete']) and not any(
        term in q for term in ['slot', 'slots', 'available', 'availability', 'schedule', 'time', 'date', 'petsa', 'oras', 'bakante']
    )


def asks_for_services(question):
    q = normalize_text(question)
    return any(term in q for term in ['service', 'services']) and not any(
        term in q for term in ['slot', 'slots', 'available', 'availability', 'schedule', 'time', 'date', 'petsa', 'oras', 'bakante']
    )


def asks_how_to_book(question):
    q = normalize_text(question)
    procedural = any(term in q for term in ['how do i book', 'how to book', 'how can i book', 'paano mag book', 'paano magbook'])
    availability_terms = ['slot', 'slots', 'available', 'availability', 'schedule', 'time', 'date', 'petsa', 'oras', 'bakante']
    return procedural and not any(term in q for term in availability_terms)


def build_booking_chatbot_response(question, user=None):
    if not is_booking_related(question):
        return None

    lang = detect_language(question)
    q = normalize_text(question)
    day = parse_requested_date(question)
    requested_time = parse_requested_time(question)
    packages = get_matching_packages(question)
    all_packages = list(
        Package.objects.select_related('service')
        .exclude(service__name__in=OBSOLETE_SERVICE_NAMES)
        .order_by('service__name', 'name')
    )

    if asks_how_to_book(question):
        if lang == 'tl':
            return (
                "Para mag-book, mag-log in muna, buksan ang Book a Session, piliin ang service at package, "
                "pumili ng available date at time, ilagay ang customer details, at i-submit ang booking."
            )
        return (
            "To book, log in, open Book a Session, choose a service and package, select an available date and time, "
            "enter the customer details, then submit the booking."
        )

    if any(term in q for term in ['hour', 'hours', 'open', 'closing', 'sarado', 'bukas ba', 'oras']):
        if not any(term in q for term in ['slot', 'available', 'availability', 'schedule', 'booked', 'date']):
            return business_hours_text(lang)

    if asks_for_own_bookings(question):
        return format_user_bookings(user, lang)

    if asks_for_services(question):
        prefix = "Live services from the database:" if lang == 'en' else "Mga live service mula sa database:"
        return f"{prefix}\n{format_service_list(get_live_services(), lang)}\n\n{business_hours_text(lang)}"

    if asks_for_packages(question):
        prefix = "Available packages from the live database:" if lang == 'en' else "Mga package na nasa live database:"
        return f"{prefix}\n{format_package_list(all_packages, lang)}\n\n{business_hours_text(lang)}"

    if not all_packages:
        return "Wala pang packages sa database kaya hindi pa ako makapag-check ng schedule." if lang == 'tl' else "There are no packages in the database yet, so I can't check schedules."

    if not packages:
        if day and any(term in q for term in ['booked', 'unavailable', 'taken', 'occupied', 'hindi available']):
            follow_up = (
                "\nSabihin mo ang package name kung gusto mong makita ang full available at unavailable slots."
                if lang == 'tl'
                else "\nTell me the package name if you want the full available and unavailable slot list."
            )
            return format_booked_schedules(day, lang) + follow_up

        if day and requested_time:
            available_packages = []
            unavailable_packages = []
            for package in all_packages:
                slots = available_slots_for(package, day)
                slot = slot_for_time(slots, requested_time)
                if slot and slot['available']:
                    available_packages.append(package.name)
                else:
                    unavailable_packages.append(package.name)

            if available_packages:
                if lang == 'tl':
                    return (
                        f"Available ang {day.isoformat()} {format_time(requested_time)} para sa: "
                        f"{', '.join(available_packages)}.\n"
                        "Hindi ko isusuggest ang packages na booked o unavailable sa oras na iyon."
                    )
                return (
                    f"{day.isoformat()} at {format_time(requested_time)} is available for: "
                    f"{', '.join(available_packages)}.\n"
                    "I will not suggest packages that are booked or unavailable at that time."
                )

        package_text = format_package_list(all_packages, lang, limit=6)
        if lang == 'tl':
            return (
                "Aling package ang gusto mong i-check? Magkaiba ang availability depende sa package duration.\n"
                f"{package_text}\n\n"
                f"{business_hours_text(lang)}"
            )
        return (
            "Which package would you like me to check? Availability depends on the package duration.\n"
            f"{package_text}\n\n"
            f"{business_hours_text(lang)}"
        )

    package = packages[0]
    if len(packages) > 1 and not normalize_text(package.name) in q:
        package_names = ", ".join(package.name for package in packages[:5])
        if lang == 'tl':
            return f"Nakakita ako ng ilang matching packages: {package_names}. Alin dito ang gusto mong i-check?"
        return f"I found multiple matching packages: {package_names}. Which one should I check?"

    if day and requested_time:
        slots = available_slots_for(package, day)
        slot = slot_for_time(slots, requested_time)
        if slot and slot['available']:
            if lang == 'tl':
                return (
                    f"Available ang {package.name} sa {day.isoformat()} ng {format_time(requested_time)}.\n"
                    f"{business_hours_text(lang)}"
                )
            return (
                f"{package.name} is available on {day.isoformat()} at {format_time(requested_time)}.\n"
                f"{business_hours_text(lang)}"
            )

        reason = slot['status'].lower() if slot else 'outside available booking slots'
        recommendations = find_nearest_available(package, day, requested_time)
        if lang == 'tl':
            return (
                f"Hindi available ang {package.name} sa {day.isoformat()} ng {format_time(requested_time)} "
                f"({reason}). Hindi ko ito isusuggest dahil booked/unavailable ito.\n"
                f"{format_recommendations(recommendations, lang)}"
            )
        return (
            f"{package.name} is not available on {day.isoformat()} at {format_time(requested_time)} "
            f"({reason}). I will not suggest that slot because it is booked or unavailable.\n"
            f"{format_recommendations(recommendations, lang)}"
        )

    if day:
        summary = format_slots_summary(package, day, lang)
        recommendations = find_nearest_available(package, day) if not any(slot['available'] for slot in available_slots_for(package, day)) else []
        if recommendations:
            return f"{summary}\n\n{format_recommendations(recommendations, lang)}"
        return f"{summary}\n\n{business_hours_text(lang)}"

    recommendations = find_nearest_available(package)
    if lang == 'tl':
        return (
            f"Live availability para sa {package.name}:\n"
            f"{format_recommendations(recommendations, lang)}\n\n"
            f"{business_hours_text(lang)}"
        )
    return (
        f"Live availability for {package.name}:\n"
        f"{format_recommendations(recommendations, lang)}\n\n"
        f"{business_hours_text(lang)}"
    )
