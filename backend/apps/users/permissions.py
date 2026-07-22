from rest_framework.permissions import BasePermission


class HasApplicationRole(BasePermission):
    allowed_roles = set()
    message = 'You do not have permission to perform this action.'

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'role', None) in self.allowed_roles
        )


class IsAdmin(HasApplicationRole):
    allowed_roles = {'ADMIN'}
    message = 'Admin access required.'


class IsStaffOrAdmin(HasApplicationRole):
    allowed_roles = {'STAFF', 'ADMIN'}
    message = 'Staff access required.'
