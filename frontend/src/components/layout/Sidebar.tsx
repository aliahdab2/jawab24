import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useState, useEffect, memo, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  Settings,
  LogOut,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Shield,
  BookTemplate,
  Zap,
  Plug
} from 'lucide-react';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation, type TranslationKey } from '@/i18n';
import clsx from 'clsx';
import { BRAND_ASSETS } from '@/constants/brand';
import { BrandLogo, NotificationBell } from '@/components/ui';
import { useIsDemoUser } from '@/features/demo';
import { api } from '@/lib/api';

/**
 * Global cache of loaded image URLs - persists across component remounts
 * This prevents flicker when navigating between pages because we know
 * the image is already in the browser cache
 */
const loadedImageCache = new Set<string>();

/**
 * ProfileAvatar - Memoized component that prevents flicker
 * Uses a global cache to track which images have been loaded this session
 */
const ProfileAvatar = memo(function ProfileAvatar({ picture, name, onError }: { picture?: string; name?: string; onError?: () => void }) {
  // Initialize as loaded if image is already in our cache
  const [imageLoaded, setImageLoaded] = useState(() => 
    picture ? loadedImageCache.has(picture) : false
  );
  const [imageSrc, setImageSrc] = useState<string | null>(picture || null);
  const prevPictureRef = useRef(picture);

  // Only reset loaded state when picture URL actually changes to a NEW value
  useEffect(() => {
    if (picture !== prevPictureRef.current) {
      prevPictureRef.current = picture;
      if (picture) {
        // Check if this image was previously loaded
        if (loadedImageCache.has(picture)) {
          setImageLoaded(true);
        } else {
          setImageLoaded(false);
        }
        setImageSrc(picture);
      } else {
        setImageSrc(null);
        setImageLoaded(false);
      }
    }
  }, [picture]);

  const handleImageLoad = useCallback(() => {
    if (imageSrc) {
      loadedImageCache.add(imageSrc);
    }
    setImageLoaded(true);
  }, [imageSrc]);

  const handleImageError = useCallback(() => {
    if (imageSrc) {
      loadedImageCache.delete(imageSrc);
    }
    setImageSrc(null);
    setImageLoaded(false);
    onError?.();
  }, [imageSrc, onError]);

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
          onLoad={handleImageLoad}
          onError={handleImageError}
          className={clsx(
            "absolute inset-0 w-10 h-10 rounded-xl object-cover border border-brand-500/20 transition-opacity duration-200",
            imageLoaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
})

const navigationGroups = [
  {
    labelKey: 'sidebar.overview',
    items: [
      { key: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard },
      { key: 'nav.pages', href: '/pages', icon: FileText },
    ],
  },
  {
    labelKey: 'sidebar.inbox',
    items: [
      { key: 'nav.comments', href: '/comments', icon: MessageSquare },
      { key: 'nav.messages', href: '/messages', icon: MessageCircle },
    ],
  },
  {
    labelKey: 'sidebar.automation',
    items: [
      { key: 'nav.templates', href: '/templates', icon: BookTemplate },
      { key: 'nav.rules', href: '/rules', icon: Zap },
      { key: 'nav.integrations', href: '/integrations', icon: Plug },
    ],
  },
  {
    labelKey: 'sidebar.account',
    items: [
      { key: 'pricing.title', href: '/pricing', icon: CreditCard },
      { key: 'nav.settings', href: '/settings', icon: Settings },
    ],
  },
];

/**
 * Sidebar - Memoized to prevent unnecessary re-renders on page navigation
 * The memo() wrapper ensures the component only re-renders when its props change
 * Since Sidebar has no props, it only re-renders when its internal state/hooks change
 */
export const Sidebar = memo(function Sidebar() {
  const router = useRouter();
  const { logout, user, fbToken } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const unreadComments = useUIStore((s) => s.unreadComments);
  const unreadMessages = useUIStore((s) => s.unreadMessages);
  const sseStatus = useUIStore((s) => s.sseStatus);
  const { t } = useTranslation();
  const isDemoUser = useIsDemoUser();

  // Memoize logout handler to prevent unnecessary re-renders
  const handleLogout = useCallback(() => {
    logout();
    router.push('/login');
  }, [logout, router]);

  // Local override for picture — set when the stored CDN URL expires and we refresh it
  const [pictureOverride, setPictureOverride] = useState<string | undefined>(undefined);
  const refreshAttemptedRef = useRef(false);

  const handlePictureRefresh = useCallback(async () => {
    if (refreshAttemptedRef.current) return; // only try once per session
    refreshAttemptedRef.current = true;
    try {
      const response = await api.get<{ picture: string }>('/auth/picture/refresh');
      if (response.data?.picture) {
        setPictureOverride(response.data.picture);
        return;
      }
    } catch {
      // Fall through to in-memory token fallback
    }
    // Fallback: use the in-memory Facebook token (available during the current session)
    // to build a direct Graph API URL. Works even when no token is stored in the DB.
    if (fbToken && user?.facebookId) {
      setPictureOverride(
        `https://graph.facebook.com/${user.facebookId}/picture?type=large&access_token=${encodeURIComponent(fbToken)}`
      );
    }
  }, [fbToken, user?.facebookId]);

  // Memoize user data to prevent ProfileAvatar re-renders
  const userPicture = pictureOverride ?? user?.picture;
  const userName = isDemoUser ? t('auth.demoUserName') : user?.name;

  return (
    <aside
      className={clsx(
        'fixed top-0 h-screen flex flex-col overflow-visible bg-surface-900 text-white transition-all duration-500 z-40 shadow-2xl group/sidebar',
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
          "absolute top-8 z-50 flex items-center justify-center w-10 h-10 rounded-full bg-white text-brand-600 hover:bg-brand-600 hover:text-white transition-all shadow-xl shadow-brand-500/10 cursor-pointer border border-brand-100/50",
          "rtl:left-0 rtl:-translate-x-1/2",
          "ltr:right-0 ltr:translate-x-1/2",
          "opacity-0 group-hover/sidebar:opacity-100 focus:opacity-100 transition-opacity duration-300"
        )}
        aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
      >
        {sidebarOpen ? (
          <>
            <ChevronRight className="w-5 h-5 rtl:block ltr:hidden" />
            <ChevronLeft className="w-5 h-5 ltr:block rtl:hidden" />
          </>
        ) : (
          <>
            <ChevronLeft className="w-5 h-5 rtl:block ltr:hidden" />
            <ChevronRight className="w-5 h-5 ltr:block rtl:hidden" />
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
        {/* Notification Bell + Connection Status - only visible when sidebar is expanded */}
        {sidebarOpen && (
          <div className="flex items-center gap-1 text-white me-2">
            {sseStatus === 'reconnecting' && (
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" title="Reconnecting..." />
            )}
            <NotificationBell />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 overflow-y-auto custom-scrollbar">
        {navigationGroups.map((group, groupIndex) => (
          <div key={group.labelKey} className={groupIndex > 0 ? 'mt-5' : ''}>
            {/* Group label — visible only when sidebar is expanded */}
            {sidebarOpen && (
              <p className="px-3 mb-2 text-[11px] font-bold text-surface-500 uppercase tracking-[0.15em]">
                {t(group.labelKey as TranslationKey)}
              </p>
            )}
            {/* Collapsed divider — thin line between groups */}
            {!sidebarOpen && groupIndex > 0 && (
              <div className="mx-3 mb-2 border-t border-white/10" />
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = router.pathname === item.href || router.pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300 group/nav relative',
                      isActive
                        ? 'bg-brand-600 text-white shadow-xl shadow-brand-600/20'
                        : 'text-surface-400 hover:bg-white/5 hover:text-white',
                      !sidebarOpen && 'justify-center'
                    )}
                  >
                    <item.icon className={clsx(
                      "w-6 h-6 flex-shrink-0 transition-transform group-hover/nav:scale-110",
                      isActive ? "text-white" : "text-surface-500 group-hover/nav:text-brand-400"
                    )} />
                    {sidebarOpen && <span className="font-bold text-sm tracking-tight">{t(item.key as TranslationKey)}</span>}

                    {/* Unread badge */}
                    {item.href === '/comments' && unreadComments > 0 && (
                      <span className={clsx(
                        'flex items-center justify-center bg-red-500 text-white font-bold rounded-full flex-shrink-0',
                        sidebarOpen ? 'ms-auto w-5 h-5 text-[10px]' : 'absolute top-1 end-1 w-2.5 h-2.5',
                      )}>
                        {sidebarOpen ? (unreadComments > 99 ? '99+' : unreadComments) : ''}
                      </span>
                    )}
                    {item.href === '/messages' && unreadMessages > 0 && (
                      <span className={clsx(
                        'flex items-center justify-center bg-red-500 text-white font-bold rounded-full flex-shrink-0',
                        sidebarOpen ? 'ms-auto w-5 h-5 text-[10px]' : 'absolute top-1 end-1 w-2.5 h-2.5',
                      )}>
                        {sidebarOpen ? (unreadMessages > 99 ? '99+' : unreadMessages) : ''}
                      </span>
                    )}

                    {/* Tooltip — visible only when sidebar is collapsed */}
                    {!sidebarOpen && (
                      <span className="absolute start-full ms-3 px-2.5 py-1.5 rounded-lg bg-surface-800 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-lg">
                        {t(item.key as TranslationKey)}
                      </span>
                    )}

                    {isActive && (
                      <div className={clsx(
                        "absolute inset-y-2 w-1 bg-white rounded-full transition-all",
                        sidebarOpen ? "start-0" : "start-1 h-1 top-1/2 -translate-y-1/2 w-1 rounded-full"
                      )}></div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* Admin Link - Only visible for admins */}
        {user?.isAdmin && (
          <>
            <div className="my-4 border-t border-white/10" />
            <Link
              href="/admin/customers"
              className={clsx(
                'flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300 group/nav relative',
                router.pathname.startsWith('/admin')
                  ? 'bg-amber-600 text-white shadow-xl shadow-amber-600/20'
                  : 'text-surface-400 hover:bg-white/5 hover:text-white',
                !sidebarOpen && 'justify-center'
              )}
            >
              <Shield className={clsx(
                "w-6 h-6 flex-shrink-0 transition-transform group-hover/nav:scale-110",
                router.pathname.startsWith('/admin') ? "text-white" : "text-amber-500 group-hover/nav:text-amber-400"
              )} />
              {sidebarOpen && <span className="font-bold text-sm tracking-tight">{t('admin.title' as TranslationKey)}</span>}
              {!sidebarOpen && (
                <span className="absolute start-full ms-3 px-2.5 py-1.5 rounded-lg bg-surface-800 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-lg">
                  {t('admin.title' as TranslationKey)}
                </span>
              )}

              {router.pathname.startsWith('/admin') && (
                <div className={clsx(
                  "absolute inset-y-2 w-1 bg-white rounded-full transition-all",
                  sidebarOpen ? "start-0" : "start-1 h-1 top-1/2 -translate-y-1/2 w-1 rounded-full"
                )}></div>
              )}
            </Link>
          </>
        )}
      </nav>

      {/* User & Logout */}
      <div className="flex-shrink-0 p-4 border-t border-white/5 bg-black/20">
        {user && (
          <div className={clsx(
            "px-3 py-3 mb-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3",
            !sidebarOpen && "justify-center px-0"
          )}>
            {/* Profile Picture with smooth loading - prevents flicker on navigation */}
            <ProfileAvatar picture={userPicture} name={userName} onError={handlePictureRefresh} />
            {sidebarOpen && (
              <div className="min-w-0 text-start">
                <p className="text-sm font-bold text-white truncate leading-tight">{userName}</p>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          className={clsx(
            "w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-surface-200 hover:bg-red-500 hover:text-white transition-all duration-300 group/nav relative",
            !sidebarOpen && "justify-center"
          )}
        >
          <LogOut className="w-6 h-6 flex-shrink-0 group-hover/nav:-translate-x-1 transition-transform" />
          {sidebarOpen && <span className="font-bold text-sm tracking-tight">{t('nav.logout' as TranslationKey)}</span>}
          {!sidebarOpen && (
            <span className="absolute start-full ms-3 px-2.5 py-1.5 rounded-lg bg-surface-800 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-lg">
              {t('nav.logout' as TranslationKey)}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
})
