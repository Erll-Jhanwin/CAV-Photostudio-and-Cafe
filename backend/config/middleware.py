from django.conf import settings


class SecurityHeadersMiddleware:
    """Apply browser protections to API, admin, and uploaded-media responses."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault('Content-Security-Policy', settings.CONTENT_SECURITY_POLICY)
        response.setdefault('Permissions-Policy', settings.PERMISSIONS_POLICY)
        response.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
        response.setdefault('Cross-Origin-Resource-Policy', 'same-site')
        return response
