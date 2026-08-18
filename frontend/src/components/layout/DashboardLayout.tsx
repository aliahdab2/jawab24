import { MessageCircle, LayoutDashboard, MessageSquare, MoreHorizontal, X, LogOut, Check, Shield } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Sidebar, getNavigationGroups, resolveNavKey } from './Sidebar';
import { useAuthStore, useUIStore } from '@/lib/store';
// Direct imports, not the '@/hooks' barrel — DashboardLayout is in the public
// /pricing page's chunk, and the 53-re-export barrel drags app-only hooks in.
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import { useWorkspacesRefresh } from '@/hooks/useWorkspacesRefresh';
import { useNavBadgeCounts, aggregateNavBadge, resolveNavHref, type NavBadge } from '@/hooks/useNavBadgeCounts';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
// Direct imports, NOT the '@/components/ui' barrel (43 re-exports). This
// layout is also the PUBLIC pricing page's layout (isPublic), so the barrel
// put FeedSnippet/FlagTag/CtaButtonPill -> '@jawab24/shared' (CommonJS, not
// tree-shakeable => zod + libphonenumber-js) on a page bought clicks land on.
// OfflineBanner below and useEscapeKey already follow this pattern.
import { VersionBadge } from '@/components/ui/VersionBadge';
import { WhatsAppHelpButton } from '@/components/ui/WhatsAppHelpButton';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ThemeToggleButton } from '@/components/ui/ThemeToggleButton';
import { NavCountBadge } from '@/components/ui/NavCountBadge';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { syncSessionState } from '@/lib/sessionSync';
// Direct import: the '@/features/demo' barrel also exports DemoLoginButton,
// which reaches the '@/components/ui' barrel -> '@jawab24/shared'. The layout
// only needs the banner.
import { DemoBanner } from '@/features/demo/DemoBanner';
import clsx from 'clsx';
import { BRAND_ASSETS } from '@/constants/brand';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useLandscape } from '@/hooks/useLandscape';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useIsEmbedded } from '@/hooks/useIsEmbedded';
import { isNativePlatform } from '@/lib/capacitor';
import { isRTLLocale, getNextLocale } from '@/utils/locale';

// Admin tooling is intentionally absent from the mobile nav for admins in general
// (keeps admin surfaces out of the App/Play Store experience). These operator
// accounts are the exception — they get an Admin entry in the mobile More menu so
// they can reach /admin from the native app. Still gated by `isAdmin`, and the
// /admin pages enforce isAdmin server-side + via AdminLayout regardless.
const MOBILE_ADMIN_EMAILS = ['aliahdab@gmail.com'];
function isMobileAdminEmail(email?: string | null): boolean {
  return !!email && MOBILE_ADMIN_EMAILS.includes(email.toLowerCase());
}

// Destinations already one tap away in the persistent mobile bottom nav.
// Excluded from the "More" overlay so it doesn't duplicate them — which also
// keeps the overlay grid short enough to fit on one screen without scrolling.
// Single source of truth for both the overlay grid and the "More" button's
// active-state highlighting (moreOverlayPaths), so the two can't drift.
const BOTTOM_NAV_PATHS = ['/dashboard', '/comments', '/messages'];

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  isPublic?: boolean;
  skipTitle?: boolean;
}

/**
 * Isolated component so SSE reconnect state changes don't re-render DashboardLayout.
 * sseStatus transitions (connecting → error → reconnecting) happen frequently during
 * retries — reading it here keeps those re-renders contained to this small indicator.
 */
function SseReconnectingDot() {
  const sseStatus = useUIStore((s) => s.sseStatus);
  if (sseStatus !== 'reconnecting') return null;
  return <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />;
}

export function DashboardLayout({ children, title, isPublic = false, skipTitle = false }: DashboardLayoutProps) {
  const router = useRouter();
  const tDashboard = useTranslations('dashboard');
  const tNav = useTranslations('nav');
  const tc = useTranslations('common');
  const tLanding = useTranslations('landing');
  const tLogout = useTranslations('logout');
  const locale = useLocale();
  const { setLanguage } = useLanguage();
  const isRTL = isRTLLocale(locale);
  const { isAuthenticated, _hasHydrated, logout, user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const isPartner = !!user?.isPartner;
  // Workspace role (owner/admin) gates the Team tile in the More overlay —
  // distinct from the platform `isAdmin` super-admin flag.
  const { isAdmin: canManageTeam } = useWorkspaceRole();
  // Standing sessions never re-run login, so the persisted workspace list —
  // which workspace-membership gates read — would stay frozen at its
  // login-time snapshot without this background refresh.
  useWorkspacesRefresh();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const isOnboardingVisible = useUIStore((s) => s.isOnboardingVisible);
  // Counts keyed by href — the same map the sidebar and the More overlay read,
  // so the bottom nav can't badge a destination the overlay renders bare.
  const badgeCounts = useNavBadgeCounts();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutCheck, setShowLogoutCheck] = useState(false);
  const isEmbedded = useIsEmbedded();

  // Bottom-nav "More" button highlights as active whenever the user is on
  // a route surfaced inside the More overlay. Single source of truth for
  // those paths — derived from the same nav config the overlay uses, so
  // adding a nav entry can never silently miss this active-state check.
  const moreOverlayPaths = useMemo(
    () => getNavigationGroups({ isNative: isNativePlatform(), isAdmin, canManageTeam, isPartner })
      .flatMap((g) => g.items.map((i) => i.href))
      .filter((href) => !BOTTOM_NAV_PATHS.includes(href)),
    [isAdmin, canManageTeam, isPartner],
  );

  // "More" stands in for every destination hidden behind it, so its badge is the
  // roll-up of theirs — derived from the same paths the overlay renders, which is
  // what keeps the number on the button and the badges inside it in agreement.
  const moreBadge = useMemo(
    () => aggregateNavBadge(badgeCounts, moreOverlayPaths, (total) => tNav('badgeItems', { count: total })),
    [badgeCounts, moreOverlayPaths, tNav],
  );

  // ESC key to close modals (logout confirmation takes priority)
  useEscapeKey(() => setShowLogoutCheck(false), showLogoutCheck);
  useEscapeKey(() => setMobileMenuOpen(false), mobileMenuOpen && !showLogoutCheck);

  const toggleLanguage = () => {
    const newLang = getNextLocale(locale);
    setLanguage(newLang);
  };

  const pageTitle = title || tDashboard('title');

  useEffect(() => {
    // Verifies the standing session AND re-reads server-resolved flags
    // (isPartner). Runs on every platform — see the no-platform-branch note in
    // lib/sessionSync.ts; gating it on web froze the Partner nav entry inside
    // the app, which is the only surface that cannot reach /partner by URL.
    if (_hasHydrated && isAuthenticated && typeof window !== 'undefined') {
      syncSessionState();
    }
  }, [_hasHydrated, isAuthenticated]);

  useEffect(() => {
    if (_hasHydrated && !isAuthenticated && !isPublic) {
      router.push('/login');
    }
  }, [_hasHydrated, isAuthenticated, isPublic, router]);

  // Update document direction based on language
  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = isRTL ? 'ar' : 'en';
  }, [isRTL]);

  // Public pages (e.g. pricing) must render on the server for SEO/AI crawlers.
  // Only block rendering for authenticated pages that need hydration to check auth.
  if (!_hasHydrated && !isPublic) {
    // Still emit noindex so crawlers never index auth-protected pages
    return (
      <Head>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
    );
  }

  // If not public and not authenticated, we're redirecting, so show nothing
  if (!isPublic && !isAuthenticated) {
    return (
      <Head>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
    );
  }

  const isCleanLayout = isPublic && !isAuthenticated;
  // WhatsApp-style: no visible bottom safe area - nav at edge

  return (
    <>
      <Head>
        {!skipTitle && <title>{pageTitle} | Jawab24</title>}
        {!isPublic && <meta name="robots" content="noindex, nofollow" />}
        {/* Every connected page renders an avatar as a 302 on graph.facebook.com
            followed by a fetch from a second fbcdn host — two cold handshakes.
            Gated to authed screens: no public page (this layout also wraps
            /pricing) loads a Facebook asset, and a speculative handshake on a
            slow link would compete with the render-blocking CSS. */}
        {!isPublic && <link rel="preconnect" href="https://graph.facebook.com" />}
        {!isPublic && <link rel="dns-prefetch" href="https://scontent.xx.fbcdn.net" />}
      </Head>

      <div className="dashboard-scroll-root flex-1 overflow-y-auto overflow-x-hidden bg-surface-50 bg-gradient-mesh">
        {/* Dark mode decorative background — teal/blue glows + cubes pattern */}
        <div className="hidden dark:block fixed inset-0 pointer-events-none z-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(93,174,164,0.15),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_90%,rgba(93,174,164,0.10),transparent_60%)]" />
          <div className="absolute inset-0 bg-[url('/images/cubes.png')] opacity-[0.06]" />
        </div>

        {/* Sidebar - hidden on mobile and on clean layouts.
            Embedded mode (opened from native app in Capacitor Browser) suppresses
            all chrome so the user sees only the pricing → checkout funnel. */}
        {!isCleanLayout && !isEmbedded && (
          <div className="hidden lg:block">
            <Sidebar />
          </div>
        )}

        {/* Public header - Matches landing page style */}
        {isEmbedded ? null : isCleanLayout ? (
          <nav className="fixed top-0 w-full z-50 transition-all duration-300 bg-card/80 backdrop-blur-md border-b border-theme-border pt-safe px-safe-landscape">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                {/* Logo - matches landing page */}
                <Link href="/" className="flex items-center gap-2 sm:gap-3 group">
                  <BrandLogo
                    variant="main"
                    className="w-10 h-10 transition-transform group-hover:rotate-6 flex-shrink-0"
                  />
                  <span className="font-display font-bold text-xl text-foreground tracking-tight">{BRAND_ASSETS.meta.appName}</span>
                </Link>

                {/* Actions - matches landing page */}
                <div className="flex items-center gap-1 sm:gap-4">
                  {/* Pricing link - hidden on mobile, on the pricing page itself,
                      and on native apps (subscription purchases happen on the web). */}
                  {router.pathname !== '/pricing' && !isNativePlatform() && (
                    <Link href="/pricing" className="hidden md:block px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all">
                      {tLanding('nav.pricing')}
                    </Link>
                  )}
                  <button
                    onClick={toggleLanguage}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
                  >
                    {tc('switchLanguage')}
                  </button>
                  <ThemeToggleButton />
                  {isAuthenticated ? (
                    <Link href="/dashboard">
                      <button className="font-bold shadow-xl shadow-brand-500/20 px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5 bg-brand-500 text-white rounded-xl hover:bg-brand-600 transition-all">
                        {tNav('dashboard')}
                      </button>
                    </Link>
                  ) : (
                    <Link href="/login?redirect=%2Fdashboard">
                      <button className="font-bold border-none px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5 text-brand-600 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all">
                        {tLanding('nav.login')}
                      </button>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </nav>
        ) : (
          /* Mobile APP Header — Logo at start, bell at end.
             Follows natural text direction (LTR/RTL). */
          <div
            className="lg:hidden fixed top-0 inset-x-0 h-14 sm:h-16 max-lg:landscape:h-10 flex items-center justify-between px-4 px-safe-landscape z-40 pt-safe box-content bg-card/90 backdrop-blur-md border-b border-theme-border"
          >
            <Link href="/dashboard" className="flex items-center min-w-[44px] min-h-[44px] max-lg:landscape:min-h-[40px] justify-center">
              <BrandLogo variant="vector" className="w-9 h-9 max-lg:landscape:w-7 max-lg:landscape:h-7" />
            </Link>

            <div className="flex items-center gap-2">
              <SseReconnectingDot />
              <NotificationBell />
            </div>
          </div>
        )}

        {/* Main content - uses centralized spacing from CSS variables */}
        <main
          className={clsx(
            'relative z-[1] transition-[margin] duration-500 flex-1',
            // Both layouts use fixed headers — content needs top padding to clear them
            // Desktop (with sidebar) uses its own layout, no top padding needed
            !isEmbedded && 'pt-header lg:pt-0',
            !isCleanLayout && !isEmbedded && (sidebarOpen ? 'lg:ms-64' : 'lg:ms-20')
          )}
        >
          {/* Offline indicator — shown on native when network is lost.
              Inside <main> on purpose: `pt-header` has already cleared the fixed
              header here, so the banner is both visible and still in flow, and it
              pushes the content down the way it always did. As a sibling in the
              scroll root it sat *under* the fixed header — a `position: static`
              element whose `z-50` was inert — so the only thing a merchant losing
              signal ever saw was the content shifting down with no explanation.
              Guarded by test/mobile/offlineBannerPlacement.test.ts. */}
          <OfflineBanner />
          <div
            className={clsx(
              'px-4 pt-3 px-safe-landscape max-lg:landscape:pt-2 sm:pt-5 md:px-8 md:pt-8 lg:px-16 lg:pt-10 xl:px-20 max-w-[1600px] mx-auto',
              isCleanLayout ? 'pb-4' : 'pb-dash-mobile'
            )}
          >
            {/* Demo Mode Banner - self-contained, only renders when user is in demo mode */}
            <DemoBanner className="mb-4 -mx-4 md:-mx-8 lg:-mx-16 xl:-mx-20 rounded-none" />
            {children}
          </div>
        </main>

        {/* Fixed bottom safe area background - ALWAYS on mobile (public + authenticated) */}
        {/* Facebook-style: neutral light gray that works with any content */}
        {/* Landing page overrides this with its own dark safe area to match dark footer */}
        <div
          className="lg:hidden fixed-safe-bg bottom-safe-bg bg-surface-100"
          aria-hidden="true"
        />

        {/* ═══════════════════════════════════════════════════════════════
            MOBILE BOTTOM NAVIGATION - Industry Best Practice (Facebook-style)
            
            Structure:
            1. Fixed safe area background (z-39) - white bar behind system nav
            2. Bottom nav (z-40) - positioned ABOVE the safe area
            
            This ensures system navigation buttons always have a white background
        ═══════════════════════════════════════════════════════════════ */}
        {!isCleanLayout && !isEmbedded && (
          <>
            {/* Bottom navigation - sits ABOVE the safe area in portrait, at bottom in landscape */}
            <nav
              aria-label="Mobile navigation"
              className="lg:hidden fixed inset-x-0 bg-card border-t border-theme-border/50 flex justify-around items-center h-16 max-lg:landscape:h-12 z-40 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] px-safe-landscape bottom-nav-position"
            >
              <MobileNavButton
                onClick={() => router.push('/dashboard')}
                icon={<LayoutDashboard className="w-7 h-7" />}
                label={tNav('dashboard')}
                active={router.pathname === '/dashboard'}
              />
              <MobileNavButton
                onClick={() => router.push('/comments')}
                icon={<MessageSquare className="w-7 h-7" />}
                label={tNav('comments')}
                active={router.pathname === '/comments'}
                badge={badgeCounts['/comments']}
              />
              <MobileNavButton
                onClick={() => router.push('/messages')}
                icon={<MessageCircle className="w-7 h-7" />}
                label={tNav('messages')}
                active={router.pathname === '/messages'}
                badge={badgeCounts['/messages']}
              />
              <MobileNavButton
                onClick={() => setMobileMenuOpen(true)}
                icon={<MoreHorizontal className="w-7 h-7" />}
                label={tNav('more') || 'More'}
                active={mobileMenuOpen || moreOverlayPaths.includes(router.pathname)}
                badge={moreBadge}
              />
            </nav>
          </>
        )}

        {/* Mobile Menu Overlay - Industry Standard: Bottom sheet (portrait) / Centered modal (landscape) */}
        {mobileMenuOpen && (
          <MobileMenuOverlay
            isOpen={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            isRTL={isRTL}
            router={router}
            onLogout={() => { setMobileMenuOpen(false); setShowLogoutCheck(true); }}
            isAdmin={isAdmin}
          />
        )}

        {/* Logout Confirmation Modal */}
        {showLogoutCheck && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-card rounded-2xl w-full max-w-sm shadow-xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-4 border-b border-theme-border">
                <h3 className="text-lg font-bold text-foreground text-center">
                  {tLogout('confirmTitle')}
                </h3>
              </div>
              <p className="text-muted-foreground text-center px-6 pt-4 pb-6">
                {tLogout('confirmBody')}
              </p>
              <div className="flex gap-3 px-6 pb-6">
                <button
                  onClick={() => setShowLogoutCheck(false)}
                  className="flex-1 py-3 rounded-xl font-semibold text-foreground/80 bg-muted hover:bg-surface-200 transition-colors"
                >
                  {tc('cancel')}
                </button>
                <button
                  onClick={() => { logout(); router.push('/login'); }}
                  className="flex-1 py-3 rounded-xl font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                >
                  {tNav('logout')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Version badge - subtle indicator in corner */}
        <VersionBadge />

        {/* WhatsApp help button - floating (hidden on list pages) */}
        <WhatsAppHelpButton hidden={mobileMenuOpen || showLogoutCheck || isOnboardingVisible} />
      </div>
    </>
  );
}

// Mobile nav button component
function MobileNavButton({ onClick, icon, label, active, badge }: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: NavBadge | null;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center h-full w-full relative group min-h-[44px] max-lg:landscape:min-h-[40px]"
    >
      <div className={clsx(
        "relative transition-all duration-200 mb-1 max-lg:landscape:mb-0 max-lg:landscape:[&>svg]:!w-5 max-lg:landscape:[&>svg]:!h-5",
        active ? "text-brand-600 scale-100 opacity-100" : "text-surface-500 scale-100 opacity-40 group-hover:opacity-60"
      )}>
        {icon}
        {badge && <NavCountBadge {...badge} className="absolute -top-1.5 -end-2.5 w-4 h-4 text-[9px]" />}
      </div>
      {/* Hide labels in landscape to save vertical space — sr-only, not hidden:
          the icon is decorative, so `display:none` here left every tab with NO
          accessible name at all in landscape. */}
      <span className={clsx(
        "text-[11px] tracking-wide transition-all leading-tight max-lg:landscape:sr-only",
        active ? "font-semibold text-brand-600 opacity-100" : "font-medium text-surface-500 opacity-50"
      )}>{label}</span>
      {active && (
        <div className="absolute top-0 w-10 h-0.5 bg-brand-600 rounded-b-full"></div>
      )}
    </button>
  );
}

/**
 * Mobile Menu Overlay Component
 * 
 * Industry Standards Applied:
 * - iOS HIG: Bottom sheet in portrait, centered modal in landscape
 * - Material Design: Proper elevation, backdrop blur
 * - Safe area handling for notches and home indicators
 * - Touch-friendly tap targets (min 44px)
 * - Horizontal layout in landscape for better space utilization
 * - Proper animation patterns (slide-up portrait, fade-in landscape)
 */
function MobileMenuOverlay({
  isOpen,
  onClose,
  isRTL,
  router,
  onLogout,
  isAdmin,
}: {
  isOpen: boolean;
  onClose: () => void;
  isRTL: boolean;
  router: ReturnType<typeof useRouter>;
  onLogout: () => void;
  isAdmin: boolean;
}) {
  const tNav = useTranslations('nav');
  const tPricing = useTranslations('pricing');
  const tAdmin = useTranslations('admin');
  const isLandscape = useLandscape();
  const user = useAuthStore((s) => s.user);
  // Read from the store rather than taken as a prop, like `user?.email` below:
  // the More overlay is where a reseller on a phone actually finds the portal,
  // so it must not depend on a parent remembering to pass the flag down.
  const isPartner = !!user?.isPartner;
  // Workspace role gates the Team tile here (mirrors the desktop sidebar).
  const { isAdmin: canManageTeam } = useWorkspaceRole();
  useBodyScrollLock(isOpen);

  // Workspace switcher: only mobile path that lets multi-workspace users move
  // between workspaces. Hidden when the user has 0 or 1 workspaces.
  const workspaces = useAuthStore((s) => s.workspaces);
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAuthStore((s) => s.setActiveWorkspace);
  const showWorkspaceSwitcher = workspaces.length > 1;
  const handleWorkspaceSwitch = (id: string) => {
    setActiveWorkspace(id);
    onClose();
    router.replace(router.asPath);
  };

  // Same map the bottom nav reads: the "More" button's badge is a roll-up of
  // these, so whatever made it light up must be findable on a tile in here.
  const badgeCounts = useNavBadgeCounts();

  const navigationGroups = getNavigationGroups({ isNative: isNativePlatform(), isAdmin, canManageTeam, isPartner });
  const menuItems = [
    ...navigationGroups
      .flatMap((group) => group.items)
      // Skip the destinations already in the persistent bottom nav — the
      // overlay is for everything else. Keeps it scannable in one screen.
      .filter((item) => !BOTTOM_NAV_PATHS.includes(item.href))
      .map((item) => ({
        path: item.href,
        // Where the tile navigates, which is not always its `path`: a badged
        // tile follows its badge to the filtered view. `path` stays the bare
        // pathname so the active-state comparison below keeps working.
        navigateTo: resolveNavHref(item.href, badgeCounts[item.href]),
        icon: item.icon,
        label: resolveNavKey(item.key, tNav, tPricing, isAdmin),
        badge: badgeCounts[item.href] ?? null,
      })),
    // Admin dashboard — mobile entry only for allow-listed operator accounts
    // (desktop sidebar shows it for all admins). Page still enforces isAdmin.
    ...(isAdmin && isMobileAdminEmail(user?.email)
      ? [{ path: '/admin/customers', navigateTo: '/admin/customers', icon: Shield, label: tAdmin('title'), badge: null }]
      : []),
  ];

  const handleNavigate = (path: string) => {
    router.push(path);
    onClose();
  };

  return (
    <div 
      className="lg:hidden fixed inset-0 z-50 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={tNav('menu') || 'Menu'}
    >
      {/* Backdrop - darker in landscape for better contrast */}
      <div className={clsx(
        "absolute inset-0 backdrop-blur-sm transition-colors",
        isLandscape ? "bg-black/60" : "bg-black/45"
      )} />

      {/* Menu Container - Different layouts for portrait/landscape */}
      <div
        className={clsx(
          // flex column + capped height so the body scrolls INSIDE the sheet
          // instead of the whole sheet growing past the viewport. Without a cap
          // the portrait sheet overflowed the top edge on tall menus (admins get
          // 11 tiles) — clipping the header and first row with no way to reach them.
          "absolute bg-card overflow-hidden flex flex-col",
          isLandscape
            // Landscape: Centered modal (iOS/Android standard for landscape)
            ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl w-[90vw] max-w-[600px] max-h-[85vh] animate-in zoom-in-95 duration-200 px-safe"
            // Portrait: Bottom sheet (iOS standard) with bottom safe area.
            // dvh (not vh) so the mobile browser URL bar is excluded; leave a
            // 1.5rem gap below the top safe inset so the backdrop stays visible.
            : "bottom-0 inset-x-0 rounded-t-[24px] animate-in slide-in-from-bottom duration-300 pb-safe max-h-[calc(100dvh-var(--sai-top)-1.5rem)]"
        )}
        style={{
          boxShadow: isLandscape 
            ? '0 25px 50px -12px rgba(0,0,0,0.25)' 
            : '0 -8px 32px rgba(0,0,0,0.16)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle - Portrait only (iOS standard) */}
        {!isLandscape && (
          <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-surface-200" />
          </div>
        )}

        {/* Header — fixed; the body below it scrolls */}
        <div className={clsx(
          "flex-shrink-0 flex items-center justify-between border-b border-theme-border",
          isLandscape ? "px-5 py-3" : "px-5 py-3"
        )}>
          <h3 className={clsx(
            "font-semibold text-foreground",
            isLandscape ? "text-base" : "text-lg"
          )}>
            {tNav('menu') || 'Menu'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 -m-2 rounded-full hover:bg-muted text-muted-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close menu"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content — the single scroll region inside the capped sheet */}
        <div className={clsx(
          "flex-1 min-h-0 overflow-y-auto",
          isLandscape ? "p-4" : "p-5"
        )}>
          {/* Workspace switcher — only when user belongs to multiple workspaces.
              Without this, mobile users had no way to switch workspaces (the
              desktop sidebar switcher is hidden behind `lg:block`). */}
          {showWorkspaceSwitcher && (
            <div className={clsx("mb-4", isLandscape && "mb-3")}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {tNav('workspace') || 'Workspace'}
              </h4>
              <div className="flex flex-col gap-1.5">
                {workspaces.map((ws) => {
                  const isActive = ws.id === activeWorkspaceId;
                  return (
                    <button
                      key={ws.id}
                      onClick={() => handleWorkspaceSwitch(ws.id)}
                      className={clsx(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-150 active:scale-[0.99]",
                        isActive
                          ? "bg-brand-50 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800"
                          : "bg-card border-theme-border/60 hover:bg-muted"
                      )}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <span className={clsx(
                        "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0",
                        isActive
                          ? "bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {ws.name?.charAt(0) || 'W'}
                      </span>
                      <span className={clsx(
                        "text-sm font-medium truncate flex-1 text-start",
                        isActive ? "text-brand-700 dark:text-brand-300" : "text-foreground"
                      )}>
                        {ws.name}
                      </span>
                      {isActive && <Check className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isLandscape ? (
            // Landscape: Horizontal row layout (maximizes vertical space)
            <div className="flex flex-wrap justify-center gap-3">
              {menuItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.navigateTo)}
                  className={clsx(
                    "flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-200",
                    "bg-muted hover:bg-brand-50 dark:hover:bg-brand-950/30 border border-theme-border hover:border-brand-200 dark:hover:border-brand-800",
                    "active:scale-95 min-h-[48px]",
                    router.pathname === item.path && "bg-brand-50 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300"
                  )}
                >
                  <item.icon className="w-6 h-6 text-brand-600 flex-shrink-0" />
                  <span className="font-medium text-sm text-surface-800 whitespace-nowrap">
                    {item.label}
                  </span>
                  {/* Row layout: the pill trails the label, as in the expanded sidebar */}
                  {item.badge && <NavCountBadge {...item.badge} className="min-w-[20px] h-5 px-1.5 text-[10px]" />}
                </button>
              ))}
            </div>
          ) : (
            // Portrait: Grid layout (iOS/Android standard)
            <div className="grid grid-cols-2 gap-2.5">
              {menuItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.navigateTo)}
                  className={clsx(
                    "flex flex-col items-center justify-center p-3 rounded-2xl transition-all duration-200",
                    "bg-card border border-theme-border/60",
                    "shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                    "active:scale-95 min-h-[76px]",
                    router.pathname === item.path && "border-brand-200 bg-brand-50/50"
                  )}
                >
                  <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-brand-50 to-brand-100/50 flex items-center justify-center mb-1.5 text-brand-600">
                    <item.icon className="w-6 h-6" />
                    {/* Grid layout: corner badge on the icon, matching the bottom nav */}
                    {item.badge && <NavCountBadge {...item.badge} className="absolute -top-1.5 -end-1.5 min-w-[18px] h-[18px] px-1 text-[10px]" />}
                  </div>
                  <span className="font-bold text-xs text-foreground text-center line-clamp-2">
                    {item.label}
                  </span>
                </button>
              ))}
      </div>
          )}

          {/* Logout Button */}
          <button
            onClick={onLogout}
            className={clsx(
              "w-full flex items-center justify-center gap-3 rounded-xl transition-all duration-200",
              "btn-logout font-semibold active:scale-[0.98]",
              isLandscape ? "mt-4 py-3" : "mt-5 py-4"
            )}
          >
            <LogOut className={clsx(
              isRTL && "rotate-180",
              isLandscape ? "w-6 h-6" : "w-7 h-7"
            )} />
      <span className={clsx(
              isLandscape ? "text-sm" : "text-base"
      )}>
              {tNav('logout')}
      </span>
    </button>
        </div>
      </div>
    </div>
  );
}
