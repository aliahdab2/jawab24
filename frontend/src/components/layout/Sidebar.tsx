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
  Users,
  UsersRound,
  Store,
  Tag,
  Handshake,
  ChevronDown as ChevronDownIcon,
  Check
} from 'lucide-react';
import { useAuthStore, useUIStore } from '@/lib/store';
// Direct imports, not the '@/hooks' barrel (see DashboardLayout.tsx).
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import { useNavBadgeCounts, resolveNavHref, type NavBadge } from '@/hooks/useNavBadgeCounts';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { BRAND_ASSETS } from '@/constants/brand';
// Direct imports, NOT the '@/components/ui' barrel — the sidebar is rendered by
// DashboardLayout, which also serves the public pricing page. See that file.
import { BrandLogo } from '@/components/ui/BrandLogo';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ThemeToggleButton } from '@/components/ui/ThemeToggleButton';
import { NavCountBadge } from '@/components/ui/NavCountBadge';
import { useIsDemoUser } from '@/features/demo';
import { api } from '@/lib/api';
import { isNativePlatform } from '@/lib/capacitor';
import { PHONE_AUTH_ENABLED, isWhatsAppVisible } from '@/lib/featureFlags';

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

  // Phone numbers (e.g. +46700224720): use last 2 subscriber digits, not the country code
  const fallbackInitial = name?.startsWith('+')
    ? name.slice(-2)
    : name?.charAt(0)?.toUpperCase() || 'U';

  return (
    <div className="relative w-10 h-10 flex-shrink-0">
      {/* Fallback - always rendered, fades out when image loads */}
      <div
        className={clsx(
          "absolute inset-0 w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold border border-brand-500/20 transition-opacity duration-200",
          fallbackInitial.length > 1 ? "text-xs" : "text-sm",
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

/** Resolves a nav item key to its translated label. Shared by Sidebar and mobile nav. */
export function resolveNavKey(
    key: string,
    tNav: (k: string) => string,
    tPricing: (k: string) => string,
    isAdmin: boolean,
): string {
    // "My Pages" becomes "Channels" only once WhatsApp is live (the screen then
    // holds a channel beyond Facebook pages). Canary-aware (isWhatsAppVisible,
    // not isWhatsAppEnabled) so the admin-only pilot window doesn't leak the
    // rename to regular users. Covers sidebar + mobile nav (both callers).
    if (key === 'nav.pages') return tNav(isWhatsAppVisible(isAdmin) ? 'channels' : 'pages');
    if (key.startsWith('nav.')) return tNav(key.replace('nav.', ''));
    if (key.startsWith('pricing.')) return tPricing(key.replace('pricing.', ''));
    return key;
}

export function getNavigationGroups(options: { isNative?: boolean; isAdmin?: boolean; canManageTeam?: boolean; isPartner?: boolean } = {}) {
  const accountItems = [
    // Reseller / country rep portal. Shown only to a registered partner, who is
    // usually also a merchant — so this sits in their normal nav rather than
    // replacing it. The /partner page and its endpoints re-check server-side;
    // this flag decides visibility, never access.
    ...(options.isPartner
      ? [{ key: 'nav.partner', href: '/partner', icon: Handshake }]
      : []),
    // Team is workspace owner/admin-only (canManageTeam = workspace role, NOT
    // the platform `isAdmin` super-admin flag). Placed first of the merchant
    // tiles so it sits between Leads (last inbox item) — the Partner entry
    // above is a reseller-only exception — and Pricing in the mobile More grid,
    // and directly above Pricing in the desktop ACCOUNT group. Members never
    // see the tile; the /team page itself stays read-only for them as a guard.
    ...(options.canManageTeam
      ? [{ key: 'nav.team', href: '/team', icon: UsersRound }]
      : []),
    // Pricing is intentionally hidden on native (iOS/Android) — mature B2B SaaS
    // apps (Slack, Notion, HubSpot) do not expose plan purchase from the mobile
    // app. Users manage subscriptions on the web.
    ...(options.isNative
      ? []
      : [{ key: 'pricing.title', href: '/pricing', icon: CreditCard }]),
    { key: 'nav.settings', href: '/settings', icon: Settings },
  ];

  // Stores is admin-only while we finish the public roll-out (Shopify App
  // Store listing, Salla/Zid backend reliability parity). Once those land
  // we'll drop the gate. Page-level guard in pages/integrations.tsx mirrors
  // this so deep-links also fail closed.
  const overviewItems = [
    { key: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard },
    { key: 'nav.pages', href: '/pages', icon: FileText },
    // Business surface (/business): GA for all merchants (owner ruling
    // 2026-08-15) — previously behind a workspace allowlist during dogfooding.
    { key: 'nav.business', href: '/business', icon: Tag },
    ...(options.isAdmin
      ? [{ key: 'nav.integrations', href: '/integrations', icon: Store }]
      : []),
  ];

  return [
    {
      labelKey: 'sidebar.overview',
      items: overviewItems,
    },
    {
      labelKey: 'sidebar.inbox',
      items: [
        { key: 'nav.comments', href: '/comments', icon: MessageSquare },
        { key: 'nav.messages', href: '/messages', icon: MessageCircle },
        { key: 'nav.leads', href: '/leads', icon: Users },
      ],
    },
    {
      labelKey: 'sidebar.account',
      items: accountItems,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  UnreadBadge                                                         */
/* ------------------------------------------------------------------ */

function UnreadBadge({ badge, sidebarOpen }: { badge: NavBadge; sidebarOpen: boolean }) {
  // Collapsed rail has no room for digits, so the count degrades to a dot — the
  // sr-label still carries the number for anyone who can't see either.
  return (
    <NavCountBadge
      {...badge}
      dot={!sidebarOpen}
      className={sidebarOpen ? 'ms-auto w-5 h-5 text-[10px]' : 'absolute top-1 end-1 w-2.5 h-2.5'}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  NavItem                                                             */
/* ------------------------------------------------------------------ */

interface NavItemProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  sidebarOpen: boolean;
  badge?: React.ReactNode;
}

function NavItem({ href, icon: Icon, label, isActive, sidebarOpen, badge }: NavItemProps) {
  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300 group/nav relative',
        isActive
          ? 'bg-brand-400/10 text-brand-400 shadow-xl shadow-brand-400/20'
          : 'text-zinc-400 hover:bg-white/5 hover:text-white',
        !sidebarOpen && 'justify-center'
      )}
    >
      <Icon className={clsx(
        "w-6 h-6 flex-shrink-0 transition-transform group-hover/nav:scale-110",
        isActive ? "text-brand-400" : "text-surface-500 group-hover/nav:text-brand-400"
      )} />
      {sidebarOpen && <span className="font-bold text-sm tracking-tight">{label}</span>}

      {badge}

      {/* Tooltip — visible only when sidebar is collapsed */}
      {!sidebarOpen && (
        <span className="absolute start-full ms-3 px-2.5 py-1.5 rounded-lg bg-surface-200 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-lg">
          {label}
        </span>
      )}

      {isActive && (
        <div className={clsx(
          "absolute inset-y-2 w-1 bg-white rounded-full transition-all",
          sidebarOpen ? "start-0" : "start-1 h-1 top-1/2 -translate-y-1/2 w-1 rounded-full"
        )} />
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  WorkspaceSwitcher                                                   */
/* ------------------------------------------------------------------ */

interface WorkspaceSwitcherProps {
  workspaces: { id: string; name: string }[];
  activeWorkspaceId: string | null;
  sidebarOpen: boolean;
  onSwitch: (id: string) => void;
}

function WorkspaceSwitcher({ workspaces, activeWorkspaceId, sidebarOpen, onSwitch }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <div className="px-3 pt-3 pb-1 relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-start',
          !sidebarOpen && 'justify-center px-0'
        )}
      >
        <span className="w-7 h-7 rounded-lg bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
          {activeWorkspace?.name?.charAt(0) || 'W'}
        </span>
        {sidebarOpen && (
          <>
            <span className="text-sm font-bold text-white truncate flex-1">{activeWorkspace?.name}</span>
            <ChevronDownIcon className={clsx('w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform', open && 'rotate-180')} />
          </>
        )}
      </button>

      {open && (
        <div className={clsx(
          'absolute z-50 mt-1 bg-surface-900 border border-white/10 rounded-xl shadow-2xl py-1 min-w-[200px]',
          sidebarOpen ? 'start-3 end-3' : 'start-full ms-2 top-3'
        )}>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => { onSwitch(ws.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-start hover:bg-white/10 transition-colors"
            >
              <span className="w-6 h-6 rounded-md bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                {ws.name?.charAt(0) || 'W'}
              </span>
              <span className="text-sm text-white truncate flex-1">{ws.name}</span>
              {ws.id === activeWorkspaceId && (
                <Check className="w-4 h-4 text-brand-400 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                             */
/* ------------------------------------------------------------------ */

/**
 * Sidebar - Memoized to prevent unnecessary re-renders on page navigation
 * The memo() wrapper ensures the component only re-renders when its props change
 * Since Sidebar has no props, it only re-renders when its internal state/hooks change
 */
export const Sidebar = memo(function Sidebar() {
  const router = useRouter();
  const { logout, user, fbToken, workspaces, activeWorkspaceId } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  // Workspace role (owner/admin) gates the Team tile — distinct from the
  // platform `isAdmin` super-admin flag above, which gates Stores/Admin.
  const { isAdmin: canManageTeam } = useWorkspaceRole();
  const setActiveWorkspace = useAuthStore((s) => s.setActiveWorkspace);
  const { sidebarOpen, toggleSidebar } = useUIStore();
  // Counts keyed by href, shared with the mobile nav surfaces so a destination
  // can't be badged here and bare there. See useNavBadgeCounts.
  const badgeCounts = useNavBadgeCounts();
  const sseStatus = useUIStore((s) => s.sseStatus);
  const tNav = useTranslations('nav');
  const tSidebar = useTranslations('sidebar');
  const tPricing = useTranslations('pricing');
  const tAdmin = useTranslations('admin');
  const tAuth = useTranslations('auth');
  const isDemoUser = useIsDemoUser();
  const navigationGroups = getNavigationGroups({ isNative: isNativePlatform(), isAdmin, canManageTeam, isPartner: !!user?.isPartner });

  const resolveItemKey = (key: string) => resolveNavKey(key, tNav, tPricing, isAdmin);

  const handleLogout = useCallback(() => {
    logout();
    router.push('/login');
  }, [logout, router]);

  const handleWorkspaceSwitch = useCallback((id: string) => {
    setActiveWorkspace(id);
    router.push('/dashboard');
  }, [setActiveWorkspace, router]);

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

  const userPicture = pictureOverride ?? user?.picture;
  // Phone auth is retired until WhatsApp OTP — don't surface a phone we treat as
  // hidden. FB users always have a name, so this only affects (rare) phone-only rows.
  const userPhone = PHONE_AUTH_ENABLED ? user?.phone : undefined;
  const userName = isDemoUser ? tAuth('demoUserName') : (user?.name || userPhone || undefined);
  // Phone-only: no name set, phone is the only identifier — needs LTR direction
  const isPhoneOnly = !isDemoUser && !user?.name && !!userPhone;

  return (
    <aside
      className={clsx(
        'fixed top-0 h-screen flex flex-col overflow-visible text-white transition-all duration-500 z-40 shadow-2xl group/sidebar',
        sidebarOpen ? 'w-64' : 'w-20'
      )}
      style={{
        insetInlineStart: 0,
        background: 'linear-gradient(180deg, rgb(13,24,39) 0%, rgb(27,40,64) 100%)',
        paddingTop: 'var(--sai-top)'
      }}
    >
      {/* Toggle Button - Floating on the edge */}
      <button
        onClick={toggleSidebar}
        className={clsx(
          "absolute top-8 z-50 flex items-center justify-center w-10 h-10 rounded-full bg-white text-brand-600 hover:bg-brand-600 hover:text-white transition-all shadow-xl shadow-brand-500/10 cursor-pointer border border-brand-100/50",
          // end-0 anchors to the sidebar's outer edge in both directions;
          // translate-x has no logical variant, so it keeps ltr:/rtl: prefixes
          "end-0 ltr:translate-x-1/2 rtl:-translate-x-1/2",
          "opacity-0 group-hover/sidebar:opacity-100 focus:opacity-100 transition-opacity duration-300"
        )}
        aria-label={sidebarOpen ? tSidebar('collapse') : tSidebar('expand')}
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
        {sidebarOpen && (
          <div className="flex items-center gap-1 text-white me-2">
            {sseStatus === 'reconnecting' && (
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" title="Reconnecting..." />
            )}
            <NotificationBell />
          </div>
        )}
      </div>

      {/* Workspace Switcher — only when user has 2+ workspaces */}
      {workspaces.length > 1 && (
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          sidebarOpen={sidebarOpen}
          onSwitch={handleWorkspaceSwitch}
        />
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 overflow-y-auto custom-scrollbar">
        {navigationGroups.map((group, groupIndex) => (
          <div key={group.labelKey} className={groupIndex > 0 ? 'mt-5' : ''}>
            {sidebarOpen && (
              <p className="px-3 mb-2 text-[11px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                {tSidebar(group.labelKey.replace('sidebar.', '') as Parameters<typeof tSidebar>[0])}
              </p>
            )}
            {!sidebarOpen && groupIndex > 0 && (
              <div className="mx-3 mb-2 border-t border-white/10" />
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const badge = badgeCounts[item.href];
                return (
                  <NavItem
                    key={item.key}
                    href={resolveNavHref(item.href, badge)}
                    icon={item.icon}
                    label={resolveItemKey(item.key)}
                    isActive={router.pathname === item.href || router.pathname.startsWith(item.href + '/')}
                    sidebarOpen={sidebarOpen}
                    badge={badge && <UnreadBadge badge={badge} sidebarOpen={sidebarOpen} />}
                  />
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
                  : 'text-zinc-400 hover:bg-white/5 hover:text-white',
                !sidebarOpen && 'justify-center'
              )}
            >
              <Shield className={clsx(
                "w-6 h-6 flex-shrink-0 transition-transform group-hover/nav:scale-110",
                router.pathname.startsWith('/admin') ? "text-white" : "text-amber-500 group-hover/nav:text-amber-400"
              )} />
              {sidebarOpen && <span className="font-bold text-sm tracking-tight">{tAdmin('title')}</span>}
              {!sidebarOpen && (
                <span className="absolute start-full ms-3 px-2.5 py-1.5 rounded-lg bg-surface-200 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-lg">
                  {tAdmin('title')}
                </span>
              )}
              {router.pathname.startsWith('/admin') && (
                <div className={clsx(
                  "absolute inset-y-2 w-1 bg-white rounded-full transition-all",
                  sidebarOpen ? "start-0" : "start-1 h-1 top-1/2 -translate-y-1/2 w-1 rounded-full"
                )} />
              )}
            </Link>
          </>
        )}
      </nav>

      {/* User & Logout */}
      <div className="flex-shrink-0 p-4 border-t border-white/5 bg-black/20">
        {!sidebarOpen && <ThemeToggleButton variant="sidebar" sidebarOpen={false} />}

        {user && (
          <div className={clsx(
            "px-3 py-3 mb-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3",
            !sidebarOpen && "justify-center px-0"
          )}>
            <ProfileAvatar picture={userPicture} name={userName} onError={handlePictureRefresh} />
            {sidebarOpen && (
              <>
                <div className="min-w-0 text-start flex-1">
                  <p
                    className="text-sm font-bold text-white truncate leading-tight"
                    dir={isPhoneOnly ? 'ltr' : undefined}
                  >
                    {userName}
                  </p>
                </div>
                <ThemeToggleButton variant="compact" />
              </>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          className={clsx(
            "w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-zinc-200 hover:bg-red-500 hover:text-white transition-all duration-300 group/nav relative",
            !sidebarOpen && "justify-center"
          )}
        >
          <LogOut className="w-6 h-6 flex-shrink-0 group-hover/nav:-translate-x-1 transition-transform" />
          {sidebarOpen && <span className="font-bold text-sm tracking-tight">{tNav('logout')}</span>}
          {!sidebarOpen && (
            <span className="absolute start-full ms-3 px-2.5 py-1.5 rounded-lg bg-surface-200 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-lg">
              {tNav('logout')}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
})
