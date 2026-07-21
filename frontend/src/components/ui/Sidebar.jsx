import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Avatar, getAvatarUrl } from './Avatar';
import { useStyledConfirm } from './StyledAlert';

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
  const { updateStoredUser } = useAuth();
  const confirm = useStyledConfirm();
  const [photoSaving, setPhotoSaving] = useState(false);

  const updateProfilePhoto = async ({ file, remove = false }) => {
    if (photoSaving) return;
    if (!file && !remove) return;
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert('Profile picture must be a JPG, PNG, or WEBP image.');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        alert('Profile picture must be 2MB or smaller.');
        return;
      }
    }
    const confirmed = await confirm({
      title: remove ? 'Remove Profile Picture' : 'Update Profile Picture',
      message: remove ? 'Remove your current profile picture?' : 'Upload this profile picture?',
      confirmLabel: remove ? 'Remove Photo' : 'Update Photo',
      type: remove ? 'error' : 'success',
    });
    if (!confirmed) return;

    try {
      setPhotoSaving(true);
      const formData = new FormData();
      if (file) formData.append('profile_picture', file);
      if (remove) formData.append('remove_profile_picture', 'true');
      const res = await client.patch('/api/auth/profile/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      updateStoredUser?.({
        username: res.data.username,
        email: res.data.email,
        role: res.data.role,
        first_name: res.data.first_name,
        last_name: res.data.last_name,
        profile_picture_url: res.data.profile_picture_url,
      });
      alert(remove ? 'Profile picture removed successfully.' : 'Profile picture updated successfully.');
    } catch (err) {
      const data = err.response?.data;
      const message = data && typeof data === 'object'
        ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')
        : 'Failed to update profile picture.';
      alert(message);
    } finally {
      setPhotoSaving(false);
    }
  };

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
          role="presentation"
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
                type="button"
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
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
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
            <div className="space-y-3 rounded-xl border border-white/5 bg-white/5 p-3.5 text-xs">
              <div className="flex items-center gap-3">
              <Avatar user={user} size="sm" className="border-white/10 bg-white/10 text-cream" />
              <div className="min-w-0 space-y-1">
                <div className="text-[9px] uppercase font-bold text-gold tracking-wider">Signed in as</div>
                <div className="truncate font-bold text-white">{user.username}</div>
                <div className="text-cream/50 text-[10px] capitalize">{user.role?.toLowerCase()}</div>
              </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className={`cursor-pointer rounded-lg bg-white/10 px-2.5 py-1.5 text-[10px] font-black text-cream/80 transition-colors hover:bg-white/15 hover:text-white ${photoSaving ? 'pointer-events-none opacity-50' : ''}`}>
                  {photoSaving ? 'Saving...' : 'Change Photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={photoSaving}
                    onChange={e => updateProfilePhoto({ file: e.target.files?.[0] })}
                  />
                </label>
                {getAvatarUrl(user) && (
                  <button
                    type="button"
                    onClick={() => updateProfilePhoto({ remove: true })}
                    disabled={photoSaving}
                    className="rounded-lg px-2.5 py-1.5 text-[10px] font-black text-red-200 transition-colors hover:bg-red-500/10 hover:text-red-100 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
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
