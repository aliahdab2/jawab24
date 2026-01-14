import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  Settings,
  LogOut,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard
} from 'lucide-react';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation, type TranslationKey } from '@/i18n';
import clsx from 'clsx';
import { BRAND_ASSETS } from '@/constants/brand';
import { BrandLogo, NotificationBell } from '@/components/ui';

/**
 * ProfileAvatar - Prevents flicker by showing fallback until image is fully loaded
 * Uses state to track image load and applies smooth fade transition
 */
function ProfileAvatar({ picture, name }: { picture?: string; name?: string }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  // Reset loaded state when picture URL changes
  useEffect(() => {
    if (picture) {
      setImageLoaded(false);
      setImageSrc(picture);
    } else {
      setImageSrc(null);
      setImageLoaded(false);
    }
  }, [picture]);

  const fallbackInitial = name?.charAt(0) || 'U';

  return (
    <div className="relative w-10 h-10 flex-shrink-0">
      {/* Fallback - always rendered, fades out when image loads */}
      <div 
        className={clsx(
          "absolute inset-0 w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold text-sm border border-brand-500/20 transition-opacity duration-200",
          imageLoaded && imageSrc ? "opacity-0" : "opacity-100"
        )}
      >
        {fallbackInitial}
      </div>
      
      {/* Actual image - fades in when loaded */}
      {imageSrc && (
        <img
          src={imageSrc}
          alt={name || 'User'}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageSrc(null);
            setImageLoaded(false);
          }}
          className={clsx(
            "absolute inset-0 w-10 h-10 rounded-xl object-cover border border-brand-500/20 transition-opacity duration-200",
            imageLoaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}

// Simple navigation - Templates & Rules are in Settings > Advanced
const navigationKeys = [
  { key: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'nav.pages', href: '/pages', icon: FileText },
  { key: 'nav.comments', href: '/comments', icon: MessageSquare },
  { key: 'nav.messages', href: '/messages', icon: MessageCircle },
  { key: 'pricing.title', href: '/pricing', icon: CreditCard },
  { key: 'nav.settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const router = useRouter();
  const { logout, user } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const { t } = useTranslation();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <aside
      className={clsx(
        'fixed top-0 h-full bg-surface-900 text-white transition-all duration-500 z-40 shadow-2xl group/sidebar',
        sidebarOpen ? 'w-64' : 'w-20'
      )}
      style={{
        insetInlineStart: 0,
        background: 'linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
        paddingTop: 'var(--sai-top)'
      }}
    >
      {/* Toggle Button - Floating on the edge */}
      <button
        onClick={toggleSidebar}
        className={clsx(
          "absolute top-8 z-50 flex items-center justify-center w-8 h-8 rounded-full bg-white text-brand-600 hover:bg-brand-600 hover:text-white transition-all shadow-xl shadow-brand-500/10 cursor-pointer border border-brand-100/50",
          "rtl:left-0 rtl:-translate-x-1/2",
          "ltr:right-0 ltr:translate-x-1/2",
          "opacity-0 group-hover/sidebar:opacity-100 focus:opacity-100 transition-opacity duration-300"
        )}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {sidebarOpen ? (
          <>
            <ChevronRight className="w-4 h-4 rtl:block ltr:hidden" />
            <ChevronLeft className="w-4 h-4 ltr:block rtl:hidden" />
          </>
        ) : (
          <>
            <ChevronLeft className="w-4 h-4 rtl:block ltr:hidden" />
            <ChevronRight className="w-4 h-4 ltr:block rtl:hidden" />
          </>
        )}
      </button>

      {/* Logo & Notifications */}
      <div className={clsx(
        "h-20 flex items-center px-4 border-b border-white/5 transition-all duration-300",
        sidebarOpen ? "justify-between" : "justify-center"
      )}>
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <BrandLogo
            variant="vector"
            className="w-10 h-10 group-hover:rotate-6 transition-transform flex-shrink-0"
          />
          <span className={clsx(
            "font-display font-bold text-xl tracking-tight whitespace-nowrap transition-all duration-300 origin-left rtl:origin-right",
            sidebarOpen ? "opacity-100 scale-100" : "opacity-0 scale-0 w-0 overflow-hidden"
          )}>
            {BRAND_ASSETS.meta.appName}
          </span>
        </Link>
        {/* Notification Bell - only visible when sidebar is expanded */}
        {/* me-4 adds spacing from the collapse toggle button on the edge */}
        {sidebarOpen && (
          <div className="text-white me-4">
            <NotificationBell />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto custom-scrollbar">
        {navigationKeys.map((item) => {
          const isActive = router.pathname === item.href || router.pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.key}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300 group relative',
                isActive
                  ? 'bg-brand-600 text-white shadow-xl shadow-brand-600/20'
                  : 'text-surface-400 hover:bg-white/5 hover:text-white',
                !sidebarOpen && 'justify-center'
              )}
            >
              <item.icon className={clsx(
                "w-6 h-6 flex-shrink-0 transition-transform group-hover:scale-110",
                isActive ? "text-white" : "text-surface-500 group-hover:text-brand-400"
              )} />
              {sidebarOpen && <span className="font-bold text-sm tracking-tight">{t(item.key as TranslationKey)}</span>}

              {isActive && (
                <div className={clsx(
                  "absolute inset-y-2 w-1 bg-white rounded-full transition-all",
                  sidebarOpen ? "start-0" : "start-1 h-1 top-1/2 -translate-y-1/2 w-1 rounded-full" // Small dot when collapsed? Or just hide it?
                )}></div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User & Logout */}
      <div className="p-4 border-t border-white/5 bg-black/20">
        {user && (
          <div className={clsx(
            "px-3 py-3 mb-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3",
            !sidebarOpen && "justify-center px-0"
          )}>
            {/* Profile Picture with smooth loading - prevents flicker on navigation */}
            <ProfileAvatar picture={user.picture} name={user.name} />
            {sidebarOpen && (
              <div className="min-w-0 text-start">
                <p className="text-sm font-bold text-white truncate leading-tight">{user.name}</p>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          className={clsx(
            "w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-surface-400 hover:bg-red-500 hover:text-white transition-all duration-300 group",
            !sidebarOpen && "justify-center"
          )}
        >
          <LogOut className="w-6 h-6 flex-shrink-0 group-hover:-translate-x-1 transition-transform" />
          {sidebarOpen && <span className="font-bold text-sm tracking-tight">{t('nav.logout' as TranslationKey)}</span>}
        </button>
      </div>
    </aside>
  );
}
