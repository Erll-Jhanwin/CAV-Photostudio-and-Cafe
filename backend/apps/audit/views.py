import re

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import IsAdmin

from .models import AuditLog


def get_client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def clean_diagnostic(value, limit):
    text = str(value or '').strip()
    text = re.sub(r'Bearer\s+\S+', 'Bearer [redacted]', text, flags=re.IGNORECASE)
    text = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[redacted token]', text)
    return text[:limit]


class ClientRuntimeErrorView(APIView):
    """Store authenticated admin UI errors without exposing diagnostics publicly."""

    permission_classes = [IsAdmin]
    throttle_scope = 'sensitive'

    def get(self, request):
        records = AuditLog.objects.filter(action='CLIENT_RUNTIME_ERROR').select_related('user')[:20]
        return Response([
            {
                'id': record.id,
                'user': record.user.username if record.user else None,
                'description': record.description,
                'metadata': record.metadata,
                'timestamp': record.timestamp,
            }
            for record in records
        ])

    def post(self, request):
        message = clean_diagnostic(request.data.get('message'), 500)
        route = clean_diagnostic(request.data.get('route'), 200)
        component_stack = clean_diagnostic(request.data.get('component_stack'), 4000)
        if not message:
            return Response({'detail': 'A runtime error message is required.'}, status=status.HTTP_400_BAD_REQUEST)

        AuditLog.objects.create(
            user=request.user,
            action='CLIENT_RUNTIME_ERROR',
            description=f'Admin client runtime error on {route or "unknown route"}.',
            metadata={
                'message': message,
                'route': route,
                'component_stack': component_stack,
            },
            ip_address=get_client_ip(request),
        )
        return Response({'detail': 'Runtime error recorded.'}, status=status.HTTP_201_CREATED)
