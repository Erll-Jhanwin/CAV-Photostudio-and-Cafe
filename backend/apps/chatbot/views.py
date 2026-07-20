import os
import logging
import requests
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from django.conf import settings
from chatbot.models import ChatbotFAQ, ChatbotLog
from audit.models import AuditLog
from chatbot.booking_assistant import build_booking_chatbot_response, detect_language

logger = logging.getLogger(__name__)
MAX_CHATBOT_QUESTION_LENGTH = 500

def get_chatbot_fallback_response(best_faq=None, lang='en'):
    if best_faq:
        return best_faq.answer
    if lang == 'tl':
        return (
            "Hindi ko makita ang eksaktong sagot sa FAQ list. "
            "Open ang CAV Photo Studio & Café araw-araw mula 9:00 AM hanggang 8:00 PM. "
            "Para sa specific na tanong tungkol sa packages o café menu, "
            "puwede kang tumawag sa +639171234567 o mag-email sa staff@test.com."
        )
    return (
        "I couldn't find a direct answer to your question in our FAQ list. "
        "CAV Photo Studio & Café is open daily from 9:00 AM to 8:00 PM. "
        "For specific queries about packages or café menu items, "
        "please contact our staff at +639171234567 or email us at staff@test.com."
    )

class ChatbotQueryView(generics.CreateAPIView):
    permission_classes = [permissions.AllowAny]  # Customers can query chatbot without login
    throttle_scope = 'chatbot'

    def create(self, request, *args, **kwargs):
        question = request.data.get('question', '')
        if not isinstance(question, str):
            return Response({"detail": "Question must be text."}, status=status.HTTP_400_BAD_REQUEST)
        question = ' '.join(question.replace('\x00', '').split()).strip()
        if not question:
            return Response({"detail": "Question is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(question) > MAX_CHATBOT_QUESTION_LENGTH:
            return Response({"detail": f"Question must be {MAX_CHATBOT_QUESTION_LENGTH} characters or fewer."}, status=status.HTTP_400_BAD_REQUEST)

        lang = detect_language(question)

        # 0. Booking/schedule/package availability questions must use live database state.
        response_text = build_booking_chatbot_response(
            question,
            request.user if request.user.is_authenticated else None
        )
        if response_text:
            ChatbotLog.objects.create(
                user=request.user if request.user.is_authenticated else None,
                question=question,
                response=response_text
            )
            return Response({"question": question, "response": response_text, "matched_faq": None})

        # 1. RAG Layer: Look up closest FAQ in our local database
        faqs = ChatbotFAQ.objects.all().only('question', 'answer', 'tags')[:100]
        words = set(question.lower().replace("?", "").split())
        
        best_faq = None
        best_score = 0

        for faq in faqs:
            # Score based on overlap of words in question or tags
            q_words = set(faq.question.lower().replace("?", "").split())
            t_words = set(faq.tags.lower().split(",")) if faq.tags else set()
            
            overlap = words.intersection(q_words.union(t_words))
            score = len(overlap)
            
            if score > best_score:
                best_score = score
                best_faq = faq

        # 2. Get API key if configured
        openrouter_key = os.environ.get('OPENROUTER_API_KEY') or getattr(settings, 'OPENROUTER_API_KEY', None)

        response_text = ""
        
        if openrouter_key:
            # Call OpenRouter API with RAG context
            context_str = ""
            if best_faq:
                context_str = f"FAQ Reference: Q: {best_faq.question} A: {best_faq.answer}"
                
            headers = {
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "google/gemini-2.5-flash",  # Standard fast model
                "messages": [
                    {
                        "role": "system",
                        "content": f"You are a helpful AI assistant for CAV Photo Studio & Café. "
                                   f"Answer questions warmly and concisely. "
                                   f"Automatically detect whether the user is using English or Tagalog and respond naturally in the same language. "
                                   f"Use this official shop knowledge base context to answer: {context_str}. "
                                   f"If the question cannot be answered by this context, answer politely that you don't know "
                                   f"the exact detail but recommend they call staff or email staff@test.com."
                    },
                    {
                        "role": "user",
                        "content": question
                    }
                ],
                "max_tokens": 300,
                "temperature": 0.2,
            }
            try:
                r = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=10)
                if r.status_code == 200:
                    resp_json = r.json()
                    response_text = resp_json['choices'][0]['message']['content'].strip()
                else:
                    logger.warning("OpenRouter chatbot request failed with status %s", r.status_code)
                    response_text = get_chatbot_fallback_response(best_faq, lang)
            except (requests.RequestException, KeyError, IndexError, ValueError) as exc:
                logger.warning("OpenRouter chatbot request failed: %s", exc)
                response_text = get_chatbot_fallback_response(best_faq, lang)
        else:
            response_text = get_chatbot_fallback_response(best_faq, lang)

        # 3. Log query to ChatbotLog
        user = request.user if request.user.is_authenticated else None
        ChatbotLog.objects.create(
            user=user,
            question=question,
            response=response_text
        )

        return Response({
            "question": question,
            "response": response_text,
            "matched_faq": best_faq.question if best_faq else None
        })

class FAQListCreateView(generics.ListCreateAPIView):
    queryset = ChatbotFAQ.objects.all().order_by('question')[:200]

    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_serializer_class(self):
        # We can write a quick serializer inline to save space
        from rest_framework import serializers
        class FAQSerializer(serializers.ModelSerializer):
            class Meta:
                model = ChatbotFAQ
                fields = ['id', 'question', 'answer', 'tags']

            def validate(self, attrs):
                for field in ['question', 'answer', 'tags']:
                    if field in attrs and isinstance(attrs[field], str):
                        attrs[field] = attrs[field].strip()
                if not attrs.get('question') or not attrs.get('answer'):
                    raise serializers.ValidationError("Question and answer are required.")
                if len(attrs.get('question', '')) > 500:
                    raise serializers.ValidationError({"question": "Question must be 500 characters or fewer."})
                if len(attrs.get('answer', '')) > 3000:
                    raise serializers.ValidationError({"answer": "Answer must be 3000 characters or fewer."})
                return attrs
        return FAQSerializer

    def create(self, request, *args, **kwargs):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only admins can modify FAQs."}, status=status.HTTP_403_FORBIDDEN)
        
        resp = super().create(request, *args, **kwargs)
        AuditLog.objects.create(
            user=request.user,
            action="FAQ_CREATE",
            description=f"Created new FAQ: {request.data.get('question')}"
        )
        return resp

class FAQDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    queryset = ChatbotFAQ.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        from rest_framework import serializers
        class FAQSerializer(serializers.ModelSerializer):
            class Meta:
                model = ChatbotFAQ
                fields = ['id', 'question', 'answer', 'tags']

            def validate(self, attrs):
                for field in ['question', 'answer', 'tags']:
                    if field in attrs and isinstance(attrs[field], str):
                        attrs[field] = attrs[field].strip()
                if 'question' in attrs and not attrs.get('question'):
                    raise serializers.ValidationError({"question": "Question is required."})
                if 'answer' in attrs and not attrs.get('answer'):
                    raise serializers.ValidationError({"answer": "Answer is required."})
                if len(attrs.get('question', '')) > 500:
                    raise serializers.ValidationError({"question": "Question must be 500 characters or fewer."})
                if len(attrs.get('answer', '')) > 3000:
                    raise serializers.ValidationError({"answer": "Answer must be 3000 characters or fewer."})
                return attrs
        return FAQSerializer

    def update(self, request, *args, **kwargs):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only admins can modify FAQs."}, status=status.HTTP_403_FORBIDDEN)
        
        resp = super().update(request, *args, **kwargs)
        faq = self.get_object()
        AuditLog.objects.create(
            user=request.user,
            action="FAQ_UPDATE",
            description=f"Updated FAQ #{faq.id}: {faq.question}"
        )
        return resp
