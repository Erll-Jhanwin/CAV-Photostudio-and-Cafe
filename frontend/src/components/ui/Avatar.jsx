import { User } from 'lucide-react';
import { API_BASE_URL } from '../../api/config';

const sizeClasses = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-20 w-20 text-xl',
  xl: 'h-28 w-28 text-3xl',
};

const getInitials = (user) => {
  const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  const source = fullName || user?.username || user?.email || '';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

export const getAvatarUrl = (user) => {
  const raw = user?.profile_picture_url || user?.profile_picture || '';
  if (!raw) return '';
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  return `${API_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
};

export function Avatar({ user, size = 'md', className = '', imageClassName = '' }) {
  const url = getAvatarUrl(user);
  const initials = getInitials(user);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-espresso/[0.08] bg-cream text-center font-black text-espresso shadow-sm ${sizeClasses[size] || sizeClasses.md} ${className}`}
      aria-label={user?.username ? `${user.username} profile picture` : 'Default profile picture'}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className={`h-full w-full object-cover ${imageClassName}`}
          loading="lazy"
        />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <User className="h-1/2 w-1/2" aria-hidden="true" />
      )}
    </span>
  );
}
