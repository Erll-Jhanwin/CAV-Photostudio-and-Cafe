import os
import requests
import json
from datetime import date
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from django.conf import settings
from chatbot.models import ChatbotFAQ, ChatbotLog
from audit.models import AuditLog
from booking.models import Booking

def is_booking_query(question):
    q = question.lower()
    booking_words = ['booking', 'bookings', 'booked', 'appointment', 'appointments',
                     'reservation', 'reservations', 'schedule', 'scheduled']
    action_words = ['show', 'list', 'all', 'view', 'display', 'get', 'find', 'search',
                    'check', 'who', 'tell', 'give', 'what']
    has_booking = any(w in q for w in booking_words)
    has_action = any(w in q for w in action_words)
    return has_booking and has_action

def format_bookings(bookings):
    if not bookings:
        return "No bookings found."
    lines = [f"Found {len(bookings)} booking(s):"]
    for b in bookings:
        name = f"{b.customer.first_name} {b.customer.last_name}".strip() or b.customer.username
        svc = b.package.service.name if b.package and hasattr(b.package, 'service') and b.package.service else ""
        pkg = b.package.name if b.package else "N/A"
        lines.append(f"  - {name} | {b.scheduled_date} @ {b.scheduled_time:%I:%M %p} | {pkg}{' (' + svc + ')' if svc else ''} | {b.status}")
    return "\n".join(lines)

def get_chatbot_fallback_response(best_faq=None):
    if best_faq:
        return best_faq.answer
    return (
        "I couldn't find a direct answer to your question in our FAQ list. "
        "CAV Photo Studio & Café is open daily from 9:00 AM to 8:00 PM. "
        "For specific queries about packages or café menu items, "
        "please contact our staff at +639171234567 or email us at staff@test.com."
    )

class ChatbotQueryView(generics.CreateAPIView):
    permission_classes = [permissions.AllowAny]  # Customers can query chatbot without login

    def create(self, request, *args, **kwargs):
        question = request.data.get('question', '').strip()
        if not question:
            return Response({"detail": "Question is required."}, status=status.HTTP_400_BAD_REQUEST)

        # 0. Intercept booking queries — query the database directly
        if is_booking_query(question):
            if not request.user.is_authenticated:
                response_text = "Please log in first so I can check the bookings for you."
            else:
                qs = Booking.objects.select_related('customer', 'package__service').all().order_by('-created_at') \
                    if request.user.role in ('ADMIN', 'STAFF') else \
                    Booking.objects.select_related('customer', 'package__service').filter(customer=request.user).order_by('-created_at')
                # Optional date filter if the question mentions a date
                q_lower = question.lower()
                for word in q_lower.split():
                    try:
                        d = date.fromisoformat(word)
                        qs = qs.filter(scheduled_date=d)
                        break
                    except (ValueError, TypeError):
                        pass
                response_text = format_bookings(list(qs))
            ChatbotLog.objects.create(
                user=request.user if request.user.is_authenticated else None,
                question=question,
                response=response_text
            )
            return Response({"question": question, "response": response_text, "matched_faq": None})

        # 1. RAG Layer: Look up closest FAQ in our local database
        faqs = ChatbotFAQ.objects.all()
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
                                   f"Use this official shop knowledge base context to answer: {context_str}. "
                                   f"If the question cannot be answered by this context, answer politely that you don't know "
                                   f"the exact detail but recommend they call staff or email staff@test.com."
                    },
                    {
                        "role": "user",
                        "content": question
                    }
                ]
            }
            try:
                r = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=10)
                if r.status_code == 200:
                    resp_json = r.json()
                    response_text = resp_json['choices'][0]['message']['content'].strip()
                else:
                    response_text = get_chatbot_fallback_response(best_faq)
            except requests.RequestException:
                response_text = get_chatbot_fallback_response(best_faq)
        else:
            response_text = get_chatbot_fallback_response(best_faq)

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
    queryset = ChatbotFAQ.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        # We can write a quick serializer inline to save space
        from rest_framework import serializers
        class FAQSerializer(serializers.ModelSerializer):
            class Meta:
                model = ChatbotFAQ
                fields = ['id', 'question', 'answer', 'tags']
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
