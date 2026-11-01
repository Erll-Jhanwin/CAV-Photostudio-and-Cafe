from rest_framework.permissions import BasePermission


def staff_request_scope(request):
    path = request.path
    method = request.method.upper()
    if path.startswith('/api/dashboard/') or path.startswith('/api/forecasting/'):
        return 'dashboard', None
    if path.startswith('/api/bookings/reviews/'):
        return 'reviews', None
    if path.startswith('/api/bookings/payments/'):
        return 'payments', 'payment_verify' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    if path.startswith('/api/bookings/'):
        return 'bookings', 'booking_manage' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    if path.startswith('/api/inventory/purchase-orders/') or path.startswith('/api/inventory/products/') or path.startswith('/api/inventory/categories/') or path.startswith('/api/inventory/suppliers/'):
        return 'catalog', 'inventory_manage' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    if path.startswith('/api/inventory/'):
        return 'inventory', 'inventory_manage' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    if path.startswith('/api/pos/end-of-day-'):
        return 'reports', 'reports_manage' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    if path.startswith('/api/pos/orders/'):
        return ('sales' if method == 'GET' else 'pos'), 'pos_manage' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    if path.startswith('/api/pos/'):
        return 'pos', 'pos_manage' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    if path.startswith('/api/chatbot/faqs/'):
        return 'chatbot', 'chatbot_manage' if method not in {'GET', 'HEAD', 'OPTIONS'} else None
    return None, None


class HasApplicationRole(BasePermission):
    allowed_roles = set()
    message = 'You do not have permission to perform this action.'

    def has_permission(self, request, view):
        user_allowed = bool(
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'role', None) in self.allowed_roles
        )
        if not user_allowed:
            return False
        if getattr(request.user, 'role', None) == 'ADMIN':
            return True
        from users.models import StaffAccessProfile
        profile = StaffAccessProfile.objects.filter(user=request.user).first()
        if not profile or not profile.on_duty:
            self.message = 'Staff access is off duty. Ask an admin to enable your shift.'
            return False
        tab, action = staff_request_scope(request)
        if tab is None or tab not in (profile.allowed_tabs or []):
            self.message = 'Your on-duty access does not include this tab.'
            return False
        if action and action not in (profile.allowed_actions or []):
            self.message = 'Your on-duty access does not include this action.'
            return False
        return True


class IsAdmin(HasApplicationRole):
    allowed_roles = {'ADMIN'}
    message = 'Admin access required.'


class IsStaffOrAdmin(HasApplicationRole):
    allowed_roles = {'STAFF', 'ADMIN'}
    message = 'Staff access required.'
