import { LogOut } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';

export function Sidebar({
  brand,
  brandSubtitle,
  brandIcon: BrandIcon,
  navItems,
  user,
  onLogout,
  mobileOpen,
  onMobileClose,
  signOutOpen = false,
  onSignOutCancel,
  onSignOutConfirm,
}) {
  const handleConfirmSignOut = () => {
    onMobileClose?.();
    onSignOutConfirm?.();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-espresso-dark/50 z-20 md:hidden animate-in"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={`
          fixed md:sticky top-0 left-0 z-30 h-screen w-64 bg-espresso text-cream
          flex flex-col shrink-0 p-5 transition-transform duration-300
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div className="flex items-center gap-3 pb-5 border-b border-white/10">
          <div className="bg-gold text-espresso p-2 rounded-xl">
            <BrandIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="font-sans text-lg font-extrabold tracking-tight text-white">{brand}</div>
            <div className="text-[9px] uppercase tracking-wider text-gold font-semibold">{brandSubtitle}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 py-6 overflow-y-auto scrollbar-thin">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => { item.onClick?.(); onMobileClose?.(); }}
                className={`
                  w-full text-left px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-3
                  transition-all duration-150
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold
                  ${item.active
                    ? 'bg-gold text-espresso shadow-md'
                    : 'text-cream/70 hover:text-cream hover:bg-white/5'
                  }
                `}
                aria-current={item.active ? 'page' : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
                {item.badge != null && (
                  <span className="ml-auto bg-gold-dark text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="space-y-3 pt-4 border-t border-white/10">
          {user && (
            <div className="bg-white/5 rounded-xl p-3.5 border border-white/5 text-xs space-y-1">
              <div className="text-[9px] uppercase font-bold text-gold tracking-wider">Signed in as</div>
              <div className="font-bold text-white">{user.username}</div>
              <div className="text-cream/50 text-[10px] capitalize">{user.role?.toLowerCase()}</div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={LogOut}
            onClick={onLogout}
            className="w-full !text-white/80 hover:!text-white hover:bg-white/10 justify-start"
          >
            End Session
          </Button>
        </div>
      </aside>

      <Modal
        open={signOutOpen}
        onClose={onSignOutCancel}
        title="Confirm Sign Out"
        size="sm"
      >
        <div className="space-y-6 text-center">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-red-50 text-red-600 flex items-center justify-center border border-red-100 shadow-[0_16px_36px_rgba(220,38,38,0.12)]">
            <LogOut className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <p className="text-base font-black text-espresso">Are you sure you want to sign out?</p>
            <p className="text-xs text-espresso/55 leading-relaxed">
              This will clear your current session, saved tokens, cookies, and cached dashboard data from this browser.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={onSignOutCancel}
              className="rounded-2xl"
            >
              Stay Signed In
            </Button>
            <Button
              variant="danger"
              icon={LogOut}
              onClick={handleConfirmSignOut}
              className="rounded-2xl"
            >
              Sign Out Securely
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
