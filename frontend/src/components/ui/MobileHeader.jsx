import { Menu } from 'lucide-react';
import { IconButton } from './Button';
import { Avatar } from './Avatar';

export function MobileHeader({ title, onMenuToggle, user }) {
  return (
    <div className="sticky top-0 z-10 bg-cream/90 backdrop-blur-md border-b border-espresso/5 md:hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <IconButton icon={<Menu className="w-5 h-5" />} label="Open menu" onClick={onMenuToggle} />
        <h1 className="min-w-0 flex-1 truncate font-sans text-lg font-extrabold text-espresso">{title}</h1>
        {user && <Avatar user={user} size="sm" />}
      </div>
    </div>
  );
}
