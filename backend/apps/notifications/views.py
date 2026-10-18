from django.conf import settings
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status, views
from rest_framework.response import Response

from users.permissions import IsAdmin

from .models import Notification, NotificationDelivery, PushSubscription
from .serializers import (
    NotificationDeliverySerializer,
    NotificationSerializer,
    PushSubscriptionSerializer,
)


class NotificationListView(generics.ListAPIView):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        try:
            requested_limit = int(self.request.query_params.get('limit', 100))
        except (TypeError, ValueError):
            requested_limit = 100
        limit = min(max(requested_limit, 1), 200)
        return Notification.objects.filter(user=self.request.user).select_related('booking')[:limit]


class NotificationReadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        notification = get_object_or_404(
            Notification,
            pk=pk,
            user=request.user,
        )
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=['is_read', 'read_at'])
        return Response(NotificationSerializer(notification).data)


class NotificationMarkAllReadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        updated = Notification.objects.filter(user=request.user, is_read=False).update(
            is_read=True,
            read_at=timezone.now(),
        )
        return Response({'updated': updated}, status=status.HTTP_200_OK)


class PushConfigView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        public_key = getattr(settings, 'PUSH_VAPID_PUBLIC_KEY', '').strip()
        enabled = bool(
            getattr(settings, 'PUSH_DELIVERY_ENABLED', False)
            and public_key
            and getattr(settings, 'PUSH_VAPID_PRIVATE_KEY', '').strip()
            and getattr(settings, 'PUSH_VAPID_SUBJECT', '').strip()
        )
        return Response({
            'enabled': enabled,
            'public_key': public_key if enabled else '',
        })


class PushSubscriptionView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = PushSubscriptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        subscription, created = PushSubscription.objects.update_or_create(
            user=request.user,
            endpoint=data['endpoint'],
            defaults={
                'p256dh': data['keys']['p256dh'],
                'auth': data['keys']['auth'],
                'user_agent': data.get('user_agent', '')[:1000],
                'is_active': True,
            },
        )
        return Response(
            {'id': subscription.id, 'active': subscription.is_active},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request):
        endpoint = str(request.data.get('endpoint') or request.query_params.get('endpoint') or '').strip()
        if not endpoint:
            return Response({'endpoint': 'This field is required.'}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({'deleted': deleted > 0}, status=status.HTTP_200_OK)


class NotificationDeliveryListView(generics.ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = NotificationDeliverySerializer

    def get_queryset(self):
        queryset = NotificationDelivery.objects.select_related('notification', 'user')
        channel = self.request.query_params.get('channel')
        delivery_status = self.request.query_params.get('status')
        if channel:
            queryset = queryset.filter(channel=channel)
        if delivery_status:
            queryset = queryset.filter(status=delivery_status)
        return queryset[:200]
