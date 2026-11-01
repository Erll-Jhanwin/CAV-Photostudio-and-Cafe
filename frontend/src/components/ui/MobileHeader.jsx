import { Menu } from 'lucide-react';
import { IconButton } from './Button';
import { Avatar } from './Avatar';

export function MobileHeader({ title, onMenuToggle, user, menuOpen = false }) {
  return (
    <div className="sticky top-0 z-10 border-b border-espresso/5 bg-cream/90 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <IconButton size="lg" icon={<Menu className="w-5 h-5" />} label={menuOpen ? 'Close menu' : 'Open menu'} onClick={onMenuToggle} aria-expanded={menuOpen} aria-controls="dashboard-navigation" />
        <span aria-hidden="true" className="min-w-0 flex-1 truncate font-sans text-lg font-extrabold leading-snug tracking-tight text-espresso">{title}</span>
        {user && <Avatar user={user} size="sm" />}
      </div>
    </div>
  );
}
