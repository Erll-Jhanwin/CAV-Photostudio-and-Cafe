import re

from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import IsAdmin

from .models import AuditLog
from .recorder import module_for_action, sanitize_metadata
from django.utils.dateparse import parse_date


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


class AuditLogPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class AuditLogListView(APIView):
    """Admin-only, read-only and paginated audit activity search."""
    permission_classes = [IsAdmin]

    def get(self, request):
        records = AuditLog.objects.select_related('user').all()
        if str(request.query_params.get('kind', '')).strip().lower() == 'errors':
            from django.db.models import Q
            records = records.filter(
                Q(action__icontains='ERROR') | Q(action__icontains='ISSUE') |
                Q(metadata__verification_issue=True)
            )
        query = str(request.query_params.get('search', '')).strip()[:120]
        if query:
            from django.db.models import Q
            records = records.filter(
                Q(actor_name__icontains=query) | Q(actor_role__icontains=query) |
                Q(action__icontains=query) | Q(description__icontains=query) |
                Q(module__icontains=query) | Q(record_reference__icontains=query) |
                Q(actor_user_id__icontains=query)
            )
        role = str(request.query_params.get('role', '')).strip().upper()
        if role in {'ADMIN', 'STAFF', 'CUSTOMER', 'SYSTEM'}:
            records = records.filter(actor_role=role) if role != 'SYSTEM' else records.filter(user__isnull=True)
        action = str(request.query_params.get('action', '')).strip()[:100]
        if action:
            records = records.filter(action=action)
        module = str(request.query_params.get('module', '')).strip()[:80]
        if module:
            records = records.filter(module=module)
        start = request.query_params.get('start')
        end = request.query_params.get('end')
        if start:
            parsed_start = parse_date(start)
            if not parsed_start:
                return Response({'detail': 'Start date must use YYYY-MM-DD format.'}, status=status.HTTP_400_BAD_REQUEST)
            records = records.filter(timestamp__date__gte=parsed_start)
        if end:
            parsed_end = parse_date(end)
            if not parsed_end:
                return Response({'detail': 'End date must use YYYY-MM-DD format.'}, status=status.HTTP_400_BAD_REQUEST)
            records = records.filter(timestamp__date__lte=parsed_end)

        paginator = AuditLogPagination()
        page = paginator.paginate_queryset(records, request, view=self)
        results = [{
            'id': row.id,
            'user_id': row.actor_user_id or row.user_id,
            'name': row.actor_name or (row.user.get_full_name().strip() or row.user.username if row.user else 'System'),
            'role': row.actor_role or (getattr(row.user, 'role', '') if row.user else 'SYSTEM'),
            'action': row.action,
            'module': row.module or module_for_action(row.action),
            'record_reference': row.record_reference or str(row.metadata.get('booking_id') or row.metadata.get('request_id') or ''),
            'description': row.description,
            'details': sanitize_metadata(row.metadata),
            'timestamp': row.timestamp,
        } for row in page]
        return paginator.get_paginated_response(results)
