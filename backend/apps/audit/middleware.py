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
                    except Exception:
                        # The business response has already succeeded. Keep the API usable and
                        # emit an operational signal so logging failures are visible to operators.
                        logger.exception('Audit activity could not be persisted for %s %s', request.method, path)
            return response
        except Exception:
            raise
        finally:
            _request_audit_events.reset(token)
