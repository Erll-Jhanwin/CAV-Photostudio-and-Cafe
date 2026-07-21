import logging
import re

from django.db import DatabaseError
from rest_framework import permissions, serializers, status, views
from rest_framework.response import Response

from audit.models import AuditLog
from chatbot.booking_assistant import build_booking_chatbot_response, detect_language

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

DEFAULT_FAQS = [
    {"id": 1, "question": "What are your operating hours?", "answer": "CAV Photo Studio and Cafe is open daily from 9:00 AM to 7:00 PM Philippine time (Asia/Manila, UTC+8).", "tags": "hours,schedule,open"},
    {"id": 2, "question": "How do I book a studio session?", "answer": "Log in, open Book Session, choose a package, select an available date and time, then submit your booking.", "tags": "book,booking,session,reserve"},
    {"id": 3, "question": "What packages do you offer for photo studio?", "answer": "We offer Studio Session packages for Solo, Couple, Friends, Family, and Birthday sessions, plus a Standard Event Package. Package details and prices are shown in the booking page.", "tags": "packages,price,studio,solo,couple,friends,family,birthday,event"},
    {"id": 4, "question": "Can we walk in for cafe or photo studio?", "answer": "Cafe walk-ins are welcome. Studio walk-ins depend on room availability, so advance booking is recommended.", "tags": "walkin,cafe,studio"},
    {"id": 5, "question": "Where is CAV located?", "answer": "CAV is located at 028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas.", "tags": "location,address,where,directions"},
    {"id": 6, "question": "How do I reset my password?", "answer": "Open the sign-in page, choose Forgot password, enter your registered email, verify the OTP, then set a new strong password.", "tags": "password,reset,forgot,otp,login,sign in"},
]
KNOWLEDGE_STOPWORDS = {
    'a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'is',
    'me', 'my', 'of', 'or', 'our', 'the', 'to', 'what', 'where', 'you',
    'your', 'ba', 'ko', 'ng', 'sa',
}


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
    return value


def asks_for_sensitive_or_internal_data(question):
    return bool(SENSITIVE_RE.search(question or ''))


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
        return "Hindi ko makita ang eksaktong sagot. Open ang CAV araw-araw mula 9:00 AM hanggang 7:00 PM Philippine time (Asia/Manila, UTC+8)."
    return "I couldn't find a direct answer. CAV is open daily from 9:00 AM to 7:00 PM Philippine time (Asia/Manila, UTC+8)."


def score_knowledge_match(question, entry):
    words = set(re.sub(r'[^a-z0-9\s]', ' ', question.lower()).split()) - KNOWLEDGE_STOPWORDS
    q_words = set(re.sub(r'[^a-z0-9\s]', ' ', str(entry.get("question", "")).lower()).split()) - KNOWLEDGE_STOPWORDS
    t_words = set(str(entry.get("tags", "")).lower().replace(',', ' ').split()) - KNOWLEDGE_STOPWORDS
    if not words:
        return 0
    score = len(words.intersection(q_words.union(t_words)))
    if str(entry.get("question", "")).lower() in question.lower():
        score += 5
    return score


def find_best_knowledge(question, role):
    best_entry = None
    best_score = 0
    for entry in get_approved_knowledge(role):
        score = score_knowledge_match(question, entry)
        if score > best_score:
            best_score = score
            best_entry = entry
    return best_entry if best_score > 0 else None


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

        lang = detect_language(question)
        role = current_role(request.user)

        if asks_for_sensitive_or_internal_data(question):
            response_text = safe_refusal(lang)
            log_chatbot_query(request, question, response_text, blocked=True, reason="sensitive_or_internal_request")
            return Response({"question": question, "response": response_text, "matched_faq": None, "source": "safety"})

        try:
            response_text = build_booking_chatbot_response(question, request.user if request.user.is_authenticated else None)
            if response_text:
                response_text = clean_response_text(response_text)
                log_chatbot_query(request, question, response_text, source="live_database")
                return Response({"question": question, "response": response_text, "matched_faq": None, "source": "live_database"})

            best_faq = find_best_knowledge(question, role)
            response_text = clean_response_text(get_chatbot_fallback_response(best_faq, lang))
            log_chatbot_query(
                request,
                question,
                response_text,
                source=best_faq.get("source", "approved_faq") if best_faq else "fallback",
                matched_faq=best_faq.get("question") if best_faq else None,
                needs_review=best_faq is None,
            )
            return Response({
                "question": question,
                "response": response_text,
                "matched_faq": best_faq["question"] if best_faq else None,
                "source": best_faq.get("source", "approved_faq") if best_faq else "fallback",
            })
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
        return [permissions.IsAuthenticated()]

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
    permission_classes = [permissions.IsAuthenticated]

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
