"""Verified, database-backed retrieval for the CAV assistant.

This module deliberately does not call a generative model.  The assistant is a
hybrid retriever: structured records are used for prices, menu items and
availability, while approved FAQ/policy records are searched with a small
lexical/semantic expansion layer.  Answers are rendered from those records so
that a missing fact becomes a clear escalation instead of a guess.
"""

import re
from collections import defaultdict

from audit.models import AuditLog
from booking.models import Package
from booking.availability import is_slot_available
from chatbot.booking_assistant import (
    detect_language,
    find_nearest_available,
    format_time,
    get_matching_packages,
    parse_requested_date,
    parse_requested_time,
)
from inventory.models import Product


MENU_TERMS = {
    'cafe', 'café', 'coffee', 'drink', 'drinks', 'menu', 'menus', 'latte',
    'matcha', 'americano', 'cappuccino', 'soda', 'chocnut', 'macchiato',
    'inumin', 'kape', 'menuhan', 'presyo',
}
POLICY_TERMS = {
    'policy', 'policies', 'rules', 'refund', 'cancel', 'cancellation',
    'deposit', 'down', 'payment', 'walkin', 'walk-in', 'privacy', 'terms',
    'reschedule', 'patakaran', 'refund', 'kansela', 'bayad',
}
RECOMMENDATION_TERMS = {
    'recommend', 'recommendation', 'suggest', 'best', 'suitable', 'which',
    'choose', 'ideal', 'angkop', 'rekomenda', 'payo', 'alin', 'pinakamaganda',
}
ESCALATION_TERMS = {
    'complaint', 'complain', 'manager', 'staff', 'human', 'refund', 'wrong',
    'scam', 'urgent', 'problem', 'issue', 'concern', 'reklamo', 'tauhan',
    'refund', 'problema', 'tulong',
}

ALIASES = {
    'birthday': {'birthday', 'bday', 'celebration', 'kaarawan'},
    'couple': {'couple', 'duo', 'partner', 'mag asawa', 'magkasintahan'},
    'family': {'family', 'pamilya'},
    'friends': {'friends', 'barkada', 'grupo', 'group'},
    'solo': {'solo', 'portrait', 'headshot', 'sarili'},
    'event': {'event', 'party', 'program', 'coverage', 'kasal', 'occasion'},
}


def _tokens(value):
    return set(re.findall(r"[a-z0-9]+", str(value or '').casefold()))


def _expanded_tokens(value):
    tokens = _tokens(value)
    for canonical, aliases in ALIASES.items():
        if tokens.intersection(_tokens(' '.join(aliases))):
            tokens.add(canonical)
    return tokens


def _contains_any(value, terms):
    text = str(value or '').casefold()
    tokens = _tokens(text)
    return bool(tokens.intersection({_tokens(term).pop() for term in terms if len(_tokens(term)) == 1})) or any(
        term.casefold() in text for term in terms if ' ' in term or '-' in term
    )


def _money(value):
    return f"PHP {value}"


def get_live_menu():
    return list(
        Product.objects.filter(
            item_type=Product.PRODUCT,
            is_cafe_item=True,
            is_active=True,
        ).order_by('category_name', 'name')
    )


def format_menu(products, lang, query=''):
    if not products:
        return (
            'Wala pang café menu items na aktibo sa database.'
            if lang == 'tl'
            else 'There are no active café menu items in the database.'
        )

    query_tokens = _expanded_tokens(query)
    exact = [item for item in products if _tokens(item.name).intersection(query_tokens)]
    rows = exact if exact else products
    grouped = defaultdict(list)
    for item in rows:
        stock_note = '' if item.stock_level > 0 else (' — currently unavailable' if lang == 'en' else ' — kasalukuyang unavailable')
        grouped[item.category_name or ('Menu' if lang == 'en' else 'Menu')].append(
            f"- {item.name}: {_money(item.price)}{stock_note}"
        )
    prefix = 'Mga café menu item mula sa live database:' if lang == 'tl' else 'Café menu from the live database:'
    return prefix + '\n' + '\n'.join(
        f"{category}\n" + '\n'.join(lines) for category, lines in grouped.items()
    )


def _knowledge_records(role):
    records = []
    logs = AuditLog.objects.filter(action='FAQ_RECORD', metadata__active=True).order_by('id')
    for log in logs:
        metadata = log.metadata or {}
        allowed = metadata.get('roles') or metadata.get('allowed_roles') or ['PUBLIC', 'CUSTOMER', 'STAFF', 'ADMIN']
        if isinstance(allowed, str):
            allowed = [part.strip().upper() for part in allowed.split(',') if part.strip()]
        if role == 'ADMIN':
            visible = 'ADMIN' in allowed or not allowed
        elif role == 'STAFF':
            visible = bool({'STAFF', 'ADMIN'}.intersection(set(allowed)))
        elif role == 'CUSTOMER':
            visible = bool({'CUSTOMER', 'PUBLIC'}.intersection(set(allowed)))
        else:
            visible = 'PUBLIC' in allowed
        if visible:
            records.append({
                'id': log.id,
                'question': metadata.get('question') or log.description,
                'answer': metadata.get('answer', ''),
                'tags': metadata.get('tags', ''),
                'category': metadata.get('category', 'faq'),
            })
    return records


def retrieve_knowledge(query, role):
    query_tokens = _expanded_tokens(query)
    if not query_tokens:
        return None
    best = None
    best_score = 0
    for record in _knowledge_records(role):
        record_tokens = _expanded_tokens(
            f"{record['question']} {record['tags']} {record['category']}"
        )
        score = len(query_tokens.intersection(record_tokens))
        if str(record['question']).casefold() in str(query).casefold():
            score += 4
        if score > best_score:
            best, best_score = record, score
    return best if best_score >= 1 else None


def _recommend_packages(query, lang):
    packages = list(
        Package.objects.select_related('service')
        .exclude(service__name__in={'Self-Shoot Studio', 'Boutique Portrait'})
        .order_by('price', 'name')
    )
    if not packages:
        return (
            'Wala pang packages sa database kaya hindi ako makapag-recommend.'
            if lang == 'tl'
            else 'There are no packages in the database yet, so I cannot recommend one.'
        )
    query_tokens = _expanded_tokens(query)
    requested_day = parse_requested_date(query)
    requested_time = parse_requested_time(query)
    scored = []
    for package in packages:
        package_tokens = _expanded_tokens(
            f"{package.name} {package.description} {package.inclusions} {package.service.name}"
        )
        score = len(query_tokens.intersection(package_tokens))
        if requested_day and requested_time:
            if not is_slot_available(package.id, requested_day, requested_time):
                score = -100
            else:
                score += 3
        scored.append((score, package))
    scored.sort(key=lambda row: (-row[0], row[1].price, row[1].name))
    selected = [package for score, package in scored if score > 0][:3]
    if not selected:
        if requested_day and requested_time:
            return (
                f'Walang available na package sa {requested_day.isoformat()} ng {format_time(requested_time)} ayon sa live availability.'
                if lang == 'tl'
                else f'No package is available on {requested_day.isoformat()} at {format_time(requested_time)} according to live availability.'
            )
        selected = [package for _, package in scored[:3]]
    lines = [
        f"- {package.name} ({package.service.name}) — {_money(package.price)}. {package.description or package.inclusions}"
        for package in selected
    ]
    if lang == 'tl':
        return 'Mga package na pinakamalapit sa kailangan mo, mula sa live database:\n' + '\n'.join(lines) + '\n\nSabihin ang petsa/oras para ma-filter ko ang hindi available.'
    return 'Packages that best match your request, from the live database:\n' + '\n'.join(lines) + '\n\nTell me the date/time and I will remove unavailable options.'


def build_hybrid_response(question, role='PUBLIC'):
    """Return ``(text, source, citations)`` or ``None`` when another handler owns it."""
    lang = detect_language(question)
    q = str(question or '').casefold()

    if _contains_any(q, MENU_TERMS):
        products = get_live_menu()
        return format_menu(products, lang, q), 'live_menu', [f'menu:{item.id}' for item in products]

    if _contains_any(q, RECOMMENDATION_TERMS) and _contains_any(q, {'package', 'packages', 'pakete', 'session', 'shoot', 'photos'}):
        return _recommend_packages(question, lang), 'live_packages', []

    # A policy answer is valid only when an approved FAQ/policy record exists.
    if _contains_any(q, POLICY_TERMS):
        record = retrieve_knowledge(question, role)
        if record:
            return str(record['answer']), 'approved_knowledge', [f"faq:{record['id']}"]
        return (
            'Wala akong ma-verify na patakaran para sa tanong na ito. Ipapasa ko ito sa staff para sa tamang sagot.'
            if lang == 'tl'
            else 'I could not verify a policy for that question. I will escalate it to staff for an accurate answer.'
        ), 'escalation', []

    if _contains_any(q, ESCALATION_TERMS):
        return (
            'Ire-record ko ang concern mo para ma-review ng staff. Huwag magpadala ng password, OTP, o payment credentials dito.'
            if lang == 'tl'
            else 'I will record your concern for staff review. Please do not send passwords, OTPs, or payment credentials here.'
        ), 'escalation', []

    return None


def availability_recommendation(package, day, requested_time, lang):
    recommendations = find_nearest_available(package, day, requested_time)
    if not recommendations:
        return ''
    parts = []
    for item in recommendations:
        parts.append(f"{item['date'].isoformat()}: {', '.join(slot['label'] for slot in item['slots'])}")
    if lang == 'tl':
        return 'Mga pinakamalapit na available na option:\n' + '\n'.join(f'- {part}' for part in parts)
    return 'Nearest available options:\n' + '\n'.join(f'- {part}' for part in parts)
