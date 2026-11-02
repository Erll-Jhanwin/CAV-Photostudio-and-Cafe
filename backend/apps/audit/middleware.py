import logging
import re
from contextvars import ContextVar

from .recorder import module_for_path, safe_change_details, record_activity

logger = logging.getLogger(__name__)
_request_audit_events = ContextVar('request_audit_events', default=None)


def note_audit_event():
    events = _request_audit_events.get()
    if events is not None:
        events.append(True)


class AuditActivityMiddleware:
    """Record successful API writes not already covered by a domain event."""

    MUTATING = {'POST', 'PUT', 'PATCH', 'DELETE'}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith('/api/') or request.method not in self.MUTATING:
            return self.get_response(request)

        events = []
        token = _request_audit_events.set(events)
        try:
            response = self.get_response(request)
            if 200 <= response.status_code < 400 and not events:
                user = getattr(request, 'user', None)
                if user and getattr(user, 'is_authenticated', False):
                    path = request.path[:220]
                    action = f"{request.method}_{module_for_path(path).upper()}_UPDATE"
                    reference_match = re.search(r'/(\d+)(?:/|$)', path)
                    record_reference = reference_match.group(1) if reference_match else ''
                    details = safe_change_details(getattr(request, 'data', None))
                    details['method'] = request.method
                    details['path'] = path
                    try:
                        record_activity(
                            user=user,
                            action=action,
                            description=f"{request.method} {path} completed successfully.",
                            module=module_for_path(path),
                            record_reference=record_reference,
                            metadata=details,
                            ip_address=request.META.get('REMOTE_ADDR'),
                        )
                    except Exception as exc:
                        # The business response has already succeeded. Keep the API usable and
                        # emit an operational signal so logging failures are visible to operators.
                        logger.error('Audit activity could not be persisted method=%s path=%s exception_type=%s.', request.method, path, type(exc).__name__)
            return response
        except Exception as exc:
            user = getattr(request, 'user', None)
            try:
                record_activity(
                    user=user if user and getattr(user, 'is_authenticated', False) else None,
                    action='API_SERVER_ERROR',
                    description=f'Unexpected API error during {request.method} {request.path[:220]}.',
                    module=module_for_path(request.path),
                    record_reference=(re.search(r'/(\d+)(?:/|$)', request.path).group(1) if re.search(r'/(\d+)(?:/|$)', request.path) else ''),
                    metadata={
                        'issue': type(exc).__name__,
                        'method': request.method,
                        'path': request.path[:220],
                    },
                    ip_address=request.META.get('REMOTE_ADDR'),
                )
            except Exception as log_exc:
                logger.error('API error log could not be persisted method=%s path=%s exception_type=%s.', request.method, request.path[:220], type(log_exc).__name__)
            raise
        finally:
            _request_audit_events.reset(token)
