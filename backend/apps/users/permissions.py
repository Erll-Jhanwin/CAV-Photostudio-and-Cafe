from rest_framework.permissions import BasePermission


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
        return True


class IsAdmin(HasApplicationRole):
    allowed_roles = {'ADMIN'}
    message = 'Admin access required.'


class IsStaffOrAdmin(HasApplicationRole):
    allowed_roles = {'STAFF', 'ADMIN'}
    message = 'Staff access required.'
