from django.conf import settings
from rest_framework.authentication import CSRFCheck
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class CookieJWTAuthentication(JWTAuthentication):
    """Authenticate browser requests with the HttpOnly access-token cookie."""

    def authenticate(self, request):
        header = self.get_header(request)
        raw_token = self.get_raw_token(header) if header is not None else None
        cookie_authenticated = raw_token is None
        if raw_token is None:
            raw_token = request.COOKIES.get(settings.AUTH_ACCESS_COOKIE_NAME)
        if raw_token is None:
            return None

        if cookie_authenticated and request.method not in {'GET', 'HEAD', 'OPTIONS', 'TRACE'}:
            check = CSRFCheck(lambda req: None)
            check.process_request(request)
            reason = check.process_view(request, None, (), {})
            if reason:
                raise AuthenticationFailed(f'CSRF validation failed: {reason}')

        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token
