import logging
import re

from django.db import DatabaseError
from rest_framework import permissions, serializers, status, views
from rest_framework.response import Response

from audit.models import AuditLog
from users.permissions import IsAdmin
from chatbot.booking_assistant import build_booking_chatbot_response, detect_language
from chatbot.actions import (
    ChatActionError,
    draft_action_from_question,
    execute_chat_action,
    propose_chat_action,
)
from chatbot.knowledge import DEFAULT_FAQS, STUDIO_ADDRESS
from chatbot.llm import generate_grounded_response, normalize_history
from chatbot.rag import build_hybrid_response, rank_knowledge

logger = logging.getLogger(__name__)
MAX_CHATBOT_QUESTION_LENGTH = 500
FAQ_ACTION = 'FAQ_RECORD'
APPROVED_LEARNING_ACTION = 'CHATBOT_APPROVED_RESPONSE'
CHATBOT_QUERY_ACTION = 'CHATBOT_QUERY'

SENSITIVE_PATTERNS = [
    r'\b(api[_ -]?key|secret[_ -]?key|client[_ -]?secret|service[_ -]?role|database[_ -]?url|db[_ -]?url)\b',
    r'\b(show|tell|give|reveal|list|print|display|send|expose)\s+(?:me\s+)?(?:the\s+)?(password|passwd|pwd|token|jwt|bearer|credential|credentials)\b',
    r'\b(admin|staff|user|database|gmail|email)\s+(password|passwd|pwd|token|credential|credentials)\b',
    r'\b(openrouter|supabase|render dashboard|environment variable|\.env|settings\.py|internal prompt|system prompt)\b',
    r'postgres(?:ql)?://',
    r'sk-[A-Za-z0-9_\-]{12,}',
    r'eyJ[A-Za-z0-9_\-]{20,}',
]
SENSITIVE_RE = re.compile('|'.join(f'(?:{pattern})' for pattern in SENSITIVE_PATTERNS), re.IGNORECASE)
EMAIL_RE = re.compile(r'[\w.\-+]+@[\w.\-]+\.\w+')
PHONE_RE = re.compile(r'(?<!\d)(?:\+?63|0)?9\d{9}(?!\d)')
LONG_NUMBER_RE = re.compile(r'(?<!\d)\d{10,}(?!\d)')
URL_RE = re.compile(r'https?://\S+')

class FAQSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    question = serializers.CharField(max_length=500)
    answer = serializers.CharField(max_length=3000)
    tags = serializers.CharField(max_length=500, allow_blank=True, required=False)

    def validate(self, attrs):
        for field in ['question', 'answer', 'tags']:
            if field in attrs and isinstance(attrs[field], str):
                attrs[field] = attrs[field].strip()
        if not attrs.get('question') or not attrs.get('answer'):
            raise serializers.ValidationError("Question and answer are required.")
        return attrs


def current_role(user):
    if user and user.is_authenticated:
        return getattr(user, 'role', 'CUSTOMER') or 'CUSTOMER'
    return 'PUBLIC'


def role_allowed(entry, role):
    allowed_roles = entry.get('roles') or entry.get('allowed_roles') or ['PUBLIC', 'CUSTOMER', 'STAFF', 'ADMIN']
    if isinstance(allowed_roles, str):
        allowed_roles = [item.strip().upper() for item in allowed_roles.split(',') if item.strip()]
    allowed_roles = [str(item).upper() for item in allowed_roles]
    if role == 'ADMIN':
        return 'ADMIN' in allowed_roles or not allowed_roles
    if role == 'STAFF':
        return any(item in allowed_roles for item in ['STAFF', 'ADMIN'])
    if role == 'CUSTOMER':
        return 'CUSTOMER' in allowed_roles or 'PUBLIC' in allowed_roles
    return 'PUBLIC' in allowed_roles


def sanitize_for_log(value):
    value = str(value or '')
    value = URL_RE.sub('[link removed]', value)
    value = EMAIL_RE.sub('[email removed]', value)
    value = PHONE_RE.sub('[phone removed]', value)
    value = LONG_NUMBER_RE.sub('[number removed]', value)
    return SENSITIVE_RE.sub('[sensitive removed]', value)[:1000]


def clean_response_text(value):
    value = str(value or '')
    replacements = {
        '9:00 AM to 8:00 PM': '9:00 AM to 7:00 PM Philippine time (Asia/Manila, UTC+8)',
        '9:00 AM hanggang 8:00 PM': '9:00 AM hanggang 7:00 PM Philippine time (Asia/Manila, UTC+8)',
        '9:00 AM – 8:00 PM': '9:00 AM - 7:00 PM PHT',
        '9:00 AM - 8:00 PM': '9:00 AM - 7:00 PM PHT',
        'until 7:30 PM': 'until 7:00 PM',
        'accepts orders until 7:30 PM': 'accepts orders until 7:00 PM',
        'Self-Shoot or Boutique Portrait': 'Studio Session or Photo Service Booking',
        'Self-Shoot Studio': 'Studio Session',
        'Self-Shoot': 'Studio Session',
        'Boutique Portrait': 'Photo Service Booking',
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    value = re.sub(r'\blive database\b', 'current information', value, flags=re.IGNORECASE)
    # Approved knowledge is still treated as untrusted content at the output
    # boundary.  A mistakenly entered secret must not be echoed to a visitor.
    return SENSITIVE_RE.sub('[sensitive detail removed]', value)


def asks_for_sensitive_or_internal_data(question):
    return bool(SENSITIVE_RE.search(question or ''))


def asks_for_studio_address(question):
    normalized = ' '.join(str(question or '').casefold().split())
    if re.search(r'\b(my|customer|profile|account)\s+address\b', normalized):
        return False
    if re.search(r'\baddress\b', normalized):
        return bool(re.search(r'\b(?:studio|cav|business|your)\b', normalized))
    return bool(
        re.search(r'\b(?:location|located|directions)\b', normalized)
        or re.search(r'\bwhere\s+(?:is|are)\s+(?:cav|the studio|the cafe|the café|cafe|café|you)\b', normalized)
        or re.search(r'\b(?:saan|nasaan)\b.*\b(?:cav|studio|cafe|café|kayo|ninyo)\b', normalized)
    )


def safe_refusal(lang='en'):
    if lang == 'tl':
        return (
            "Hindi ako puwedeng magbigay o maghanap ng credentials, secrets, personal data, "
            "o internal system details. Maaari kitang tulungan sa services, packages, availability, bookings, at FAQs."
        )
    return (
        "I can't provide or look up credentials, secrets, personal data, or internal system details. "
        "I can help with services, packages, availability, bookings, and approved FAQs."
    )


def faq_from_log(log):
    data = log.metadata or {}
    return {
        "id": log.id,
        "question": data.get("question") or log.description,
        "answer": data.get("answer", ""),
        "tags": data.get("tags", ""),
    }


def get_faqs():
    records = [faq_from_log(log) for log in AuditLog.objects.filter(action=FAQ_ACTION, metadata__active=True).order_by('id')]
    seen = {str(record.get("question", "")).strip().lower() for record in records}
    defaults = [faq for faq in DEFAULT_FAQS if str(faq.get("question", "")).strip().lower() not in seen]
    return records + defaults


def learned_entry_from_log(log):
    data = log.metadata or {}
    return {
        "id": log.id,
        "question": data.get("question") or log.description,
        "answer": data.get("answer", ""),
        "tags": data.get("tags", "approved,learned"),
        "roles": data.get("roles") or data.get("allowed_roles") or ['PUBLIC', 'CUSTOMER', 'STAFF', 'ADMIN'],
        "source": "approved_interaction",
    }


def get_approved_knowledge(role='PUBLIC'):
    faqs = [faq for faq in get_faqs() if role_allowed(faq, role)]
    learned = [
        learned_entry_from_log(log)
        for log in AuditLog.objects.filter(
            action=APPROVED_LEARNING_ACTION,
            metadata__active=True,
            metadata__approved=True,
        ).order_by('-timestamp')[:100]
    ]
    return faqs + [entry for entry in learned if role_allowed(entry, role)]


def get_chatbot_fallback_response(best_faq=None, lang='en'):
    if best_faq:
        return clean_response_text(best_faq["answer"])
    if lang == 'tl':
        return "Hindi ko sigurado kung ano ang kailangan mo. Makakatulong ako sa hours, packages, café menu, availability, bookings, at password reset. Ano ang gusto mong malaman?"
    return "I’m not sure I understood. I can help with hours, packages, the café menu, availability, bookings, and password reset. What would you like to know?"


def score_knowledge_match(question, entry):
    """Compatibility helper for callers that still need a FAQ score."""
    query = set(re.findall(r'[a-z0-9]+', str(question or '').casefold()))
    faq = set(re.findall(r'[a-z0-9]+', str(entry.get('question', '')).casefold()))
    tags = set(re.findall(r'[a-z0-9]+', str(entry.get('tags', '')).casefold()))
    return len(query.intersection(faq)) * 2 + len(query.intersection(tags))


def find_best_knowledge(question, role):
    matches = rank_knowledge(question, role, limit=1)
    return matches[0] if matches else None


def localized_knowledge_answer(entry, lang):
    if not entry:
        return ''
    if lang == 'tl' and entry.get('answer_tl'):
        return entry['answer_tl']
    return entry.get('answer', '')


def contextual_question(question, history):
    """Resolve short follow-ups without treating assistant text as facts."""
    user_messages = [item['content'] for item in normalize_history(history) if item['role'] == 'user']
    if not user_messages:
        return question
    previous = user_messages[-1]
    if previous.casefold() == question.casefold():
        return question
    normalized = question.casefold()
    if normalized in {'thanks', 'thank you', 'salamat', 'got it', 'okay', 'ok', 'sige'}:
        return question
    continuation = (
        len(normalized.split()) <= 5
        or normalized.startswith(('and ', 'what about', 'how about', 'how much', 'is it', 'what is it', 'paano ', 'magkano '))
        or normalized in {'yes', 'no', 'okay', 'sige', 'oo', 'hindi'}
    )
    return f'{previous} {question}' if continuation else question


def log_chatbot_query(request, question, response_text, **metadata):
    user = request.user if request.user.is_authenticated else None
    try:
        AuditLog.objects.create(
            user=user,
            action=CHATBOT_QUERY_ACTION,
            description=sanitize_for_log(question),
            metadata={
                "response": sanitize_for_log(response_text),
                "role": current_role(user),
                "question_length": len(question or ''),
                **metadata,
            },
        )
    except DatabaseError as exc:
        logger.warning("Chatbot audit log skipped because the database is unavailable: %s", exc)


def log_escalation(request, question, response_text, lang, reason='complex_concern'):
    """Create a staff-visible escalation without persisting raw sensitive text."""
    try:
        log = AuditLog.objects.create(
            user=request.user if request.user.is_authenticated else None,
            action='CHATBOT_ESCALATION',
            description=sanitize_for_log(question),
            metadata={
                'response': sanitize_for_log(response_text),
                'language': lang,
                'reason': reason,
                'status': 'OPEN',
            },
        )
        return log.id
    except DatabaseError as exc:
        logger.warning("Chatbot escalation could not be recorded: %s", exc)
        return None


class ChatbotQueryView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'chatbot'

    def post(self, request, *args, **kwargs):
        question = request.data.get('question', '')
        if not isinstance(question, str):
            return Response({"detail": "Question must be text."}, status=status.HTTP_400_BAD_REQUEST)
        question = ' '.join(question.replace('\x00', '').split()).strip()
        if not question:
            return Response({"detail": "Question is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(question) > MAX_CHATBOT_QUESTION_LENGTH:
            return Response({"detail": f"Question must be {MAX_CHATBOT_QUESTION_LENGTH} characters or fewer."}, status=status.HTTP_400_BAD_REQUEST)

        history = normalize_history(request.data.get('history'))
        intent_question = contextual_question(question, history)
        lang = detect_language(question)
        role = current_role(request.user)

        if asks_for_sensitive_or_internal_data(question):
            response_text = safe_refusal(lang)
            log_chatbot_query(request, question, response_text, blocked=True, reason="sensitive_or_internal_request")
            return Response({"question": question, "response": response_text, "matched_faq": None, "source": "safety", "language": lang})

        if asks_for_studio_address(intent_question):
            response_text = STUDIO_ADDRESS
            log_chatbot_query(request, question, response_text, source='studio_address')
            return Response({"question": question, "response": response_text, "matched_faq": "Where is CAV located?", "source": "studio_address", "citations": [], "language": lang})

        try:
            # Mutations are always explicit API actions and always require a
            # second request carrying confirm=true.  A natural-language
            # request can only produce a proposal.
            action = request.data.get('action')
            if action is not None:
                if not isinstance(action, dict):
                    return Response({"detail": "Action must be an object."}, status=status.HTTP_400_BAD_REQUEST)
                result = execute_chat_action(action, request, lang) if action.get('confirm') else propose_chat_action(action, request, lang)
                response_text = clean_response_text(result['response'])
                log_chatbot_query(request, question, response_text, source='booking_action', action=result.get('action'))
                return Response({"question": question, "response": response_text, **result, "language": lang})

            draft = draft_action_from_question(question, request)
            if draft:
                result = propose_chat_action(draft, request, lang)
                response_text = clean_response_text(result['response'])
                log_chatbot_query(request, question, response_text, source='booking_action_proposal', action=result.get('action'))
                return Response({"question": question, "response": response_text, **result, "language": lang})

            hybrid = build_hybrid_response(intent_question, role, lang)
            if hybrid:
                response_text, source, citations = hybrid
                response_text = clean_response_text(response_text)
                escalation_id = None
                if source == 'escalation':
                    escalation_id = log_escalation(request, question, response_text, lang)
                log_chatbot_query(
                    request,
                    question,
                    response_text,
                    source=source,
                    citations=citations,
                    escalated=source == 'escalation',
                )
                return Response({
                    "question": question,
                    "response": response_text,
                    "matched_faq": None,
                    "source": source,
                    "citations": citations,
                    "escalated": source == 'escalation',
                    "escalation_id": escalation_id,
                    "language": lang,
                })

            response_text = build_booking_chatbot_response(
                intent_question,
                request.user if request.user.is_authenticated else None,
                lang,
            )
            if response_text:
                response_text = clean_response_text(response_text)
                log_chatbot_query(request, question, response_text, source="live_database")
                return Response({"question": question, "response": response_text, "matched_faq": None, "source": "live_database", "citations": [], "language": lang})

            knowledge_matches = rank_knowledge(intent_question, role, limit=4)
            best_faq = knowledge_matches[0] if knowledge_matches else None
            model_response = generate_grounded_response(
                question,
                language=lang,
                context=knowledge_matches,
                history=history,
                role=role,
            )
            response_text = clean_response_text(
                model_response
                or localized_knowledge_answer(best_faq, lang)
                or get_chatbot_fallback_response(best_faq, lang)
            )
            response_source = 'openrouter' if model_response else (
                best_faq.get('source', 'approved_faq') if best_faq else 'fallback'
            )
            log_chatbot_query(
                request,
                question,
                response_text,
                source=response_source,
                matched_faq=best_faq.get("question") if best_faq else None,
                needs_review=best_faq is None,
                history_items=len(history),
            )
            return Response({
                "question": question,
                "response": response_text,
                "matched_faq": best_faq["question"] if best_faq else None,
                "source": response_source,
                "citations": [f"faq:{best_faq['id']}"] if best_faq and best_faq.get('id') else [],
                "language": lang,
            })
        except ChatActionError as exc:
            response_text = clean_response_text(exc.message)
            log_chatbot_query(request, question, response_text, source='booking_action_error', action_status=exc.status)
            return Response({
                "question": question,
                "response": response_text,
                "source": "booking_action",
                "action": exc.action,
                "action_status": exc.status,
                "language": lang,
            }, status=status.HTTP_400_BAD_REQUEST)
        except serializers.ValidationError as exc:
            logger.info("Chatbot booking action validation failed: %s", exc.detail)
            return Response({
                "question": question,
                "response": "I could not complete that booking change. Please check the package, date, and time.",
                "source": "booking_action",
                "action_status": "invalid",
                "language": lang,
            }, status=status.HTTP_400_BAD_REQUEST)
        except DatabaseError as exc:
            logger.exception("Chatbot database lookup failed: %s", exc)
            return Response({"detail": "Chatbot data is temporarily unavailable. Please try again."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as exc:
            logger.exception("Chatbot query failed: %s", exc)
            return Response({"detail": "Chatbot could not process that question."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class FAQListCreateView(views.APIView):
    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.AllowAny()]
        return [IsAdmin()]

    def get(self, request):
        return Response(get_faqs())

    def post(self, request):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only admins can modify FAQs."}, status=status.HTTP_403_FORBIDDEN)
        serializer = FAQSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        log = AuditLog.objects.create(
            user=request.user,
            action=FAQ_ACTION,
            description=serializer.validated_data['question'],
            metadata={**serializer.validated_data, "active": True, "approved": True, "source": "admin_faq"},
        )
        return Response(faq_from_log(log), status=status.HTTP_201_CREATED)


class FAQDetailUpdateView(views.APIView):
    permission_classes = [IsAdmin]

    def get_record(self, pk):
        return AuditLog.objects.get(pk=pk, action=FAQ_ACTION, metadata__active=True)

    def put(self, request, pk):
        return self.patch(request, pk)

    def patch(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only admins can modify FAQs."}, status=status.HTTP_403_FORBIDDEN)
        try:
            log = self.get_record(pk)
        except AuditLog.DoesNotExist:
            return Response({"detail": "FAQ not found."}, status=status.HTTP_404_NOT_FOUND)
        current = faq_from_log(log)
        serializer = FAQSerializer(data={**current, **request.data})
        serializer.is_valid(raise_exception=True)
        log.description = serializer.validated_data['question']
        log.metadata = {**serializer.validated_data, "active": True, "approved": True, "source": "admin_faq"}
        log.user = request.user
        log.save(update_fields=['description', 'metadata', 'user'])
        return Response(faq_from_log(log))

    def delete(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only admins can modify FAQs."}, status=status.HTTP_403_FORBIDDEN)
        try:
            log = self.get_record(pk)
        except AuditLog.DoesNotExist:
            return Response(status=status.HTTP_204_NO_CONTENT)
        log.metadata = {**(log.metadata or {}), "active": False}
        log.user = request.user
        log.save(update_fields=['metadata', 'user'])
        return Response(status=status.HTTP_204_NO_CONTENT)
