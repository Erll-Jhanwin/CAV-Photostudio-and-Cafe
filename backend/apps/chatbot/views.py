import logging
import os

import requests
from django.conf import settings
from rest_framework import permissions, serializers, status, views
from rest_framework.response import Response

from audit.models import AuditLog
from chatbot.booking_assistant import build_booking_chatbot_response, detect_language

logger = logging.getLogger(__name__)
MAX_CHATBOT_QUESTION_LENGTH = 500
FAQ_ACTION = 'FAQ_RECORD'

DEFAULT_FAQS = [
    {"id": 1, "question": "What are your operating hours?", "answer": "CAV Photo Studio and Cafe is open daily from 9:00 AM to 8:00 PM.", "tags": "hours,schedule,open"},
    {"id": 2, "question": "How do I book a studio session?", "answer": "Log in, open Book Session, choose a package, select an available date and time, then submit your booking.", "tags": "book,booking,session,reserve"},
    {"id": 3, "question": "What packages do you offer for photo studio?", "answer": "We offer Studio Session packages for Solo, Couple, Friends, Family, and Birthday sessions, plus a Standard Event Package. Package details and prices are shown in the booking page.", "tags": "packages,price,studio,solo,couple,friends,family,birthday,event"},
    {"id": 4, "question": "Can we walk in for cafe or photo studio?", "answer": "Cafe walk-ins are welcome. Studio walk-ins depend on room availability, so advance booking is recommended.", "tags": "walkin,cafe,studio"},
    {"id": 5, "question": "Where is CAV located?", "answer": "CAV is located at 028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas.", "tags": "location,address,where,directions"},
]


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
    return records or DEFAULT_FAQS


def get_chatbot_fallback_response(best_faq=None, lang='en'):
    if best_faq:
        return best_faq["answer"]
    if lang == 'tl':
        return "Hindi ko makita ang eksaktong sagot. Open ang CAV araw-araw mula 9:00 AM hanggang 8:00 PM."
    return "I couldn't find a direct answer. CAV is open daily from 9:00 AM to 8:00 PM."


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
        response_text = build_booking_chatbot_response(question, request.user if request.user.is_authenticated else None)
        if response_text:
            AuditLog.objects.create(user=request.user if request.user.is_authenticated else None, action="CHATBOT_QUERY", description=question, metadata={"response": response_text})
            return Response({"question": question, "response": response_text, "matched_faq": None})

        words = set(question.lower().replace("?", "").split())
        best_faq = None
        best_score = 0
        for faq in get_faqs():
            q_words = set(faq["question"].lower().replace("?", "").split())
            t_words = set(str(faq.get("tags", "")).lower().split(","))
            score = len(words.intersection(q_words.union(t_words)))
            if score > best_score:
                best_score = score
                best_faq = faq

        openrouter_key = os.environ.get('OPENROUTER_API_KEY') or getattr(settings, 'OPENROUTER_API_KEY', None)
        response_text = ""
        if openrouter_key:
            context_str = f"FAQ Reference: Q: {best_faq['question']} A: {best_faq['answer']}" if best_faq else ""
            try:
                r = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": "application/json"},
                    json={
                        "model": "google/gemini-2.5-flash",
                        "messages": [
                            {"role": "system", "content": f"You are a helpful AI assistant for CAV Photo Studio and Cafe. Use this context: {context_str}."},
                            {"role": "user", "content": question},
                        ],
                        "max_tokens": 300,
                        "temperature": 0.2,
                    },
                    timeout=10,
                )
                response_text = r.json()['choices'][0]['message']['content'].strip() if r.status_code == 200 else get_chatbot_fallback_response(best_faq, lang)
            except Exception as exc:
                logger.warning("OpenRouter chatbot request failed: %s", exc)
                response_text = get_chatbot_fallback_response(best_faq, lang)
        else:
            response_text = get_chatbot_fallback_response(best_faq, lang)

        AuditLog.objects.create(user=request.user if request.user.is_authenticated else None, action="CHATBOT_QUERY", description=question, metadata={"response": response_text, "matched_faq": best_faq})
        return Response({"question": question, "response": response_text, "matched_faq": best_faq["question"] if best_faq else None})


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
            metadata={**serializer.validated_data, "active": True},
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
        log.metadata = {**serializer.validated_data, "active": True}
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
