import { MessageCircle, LayoutDashboard, MessageSquare, Settings, MoreHorizontal, X, LogOut, BookTemplate, Zap, FileText, CreditCard } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Sidebar } from './Sidebar';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation, type TranslationKey } from '@/i18n';
import { VersionBadge, WhatsAppHelpButton, BrandLogo, NotificationBell } from '@/components/ui';
import { addErrorBreadcrumb } from '@/lib/sentryHelpers';
import { DemoBanner } from '@/features/demo';
import clsx from 'clsx';
import { BRAND_ASSETS } from '@/constants/brand';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useLandscape } from '@/hooks/useLandscape';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  isPublic?: boolean;
  skipTitle?: boolean;
}

export function DashboardLayout({ children, title, isPublic = false, skipTitle = false }: DashboardLayoutProps) {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();
  const isRTL = language === 'ar';
  const { isAuthenticated, _hasHydrated, logout } = useAuthStore();
  const { sidebarOpen, isOnboardingVisible } = useUIStore();
  const unreadComments = useUIStore((s) => s.unreadComments);
  const unreadMessages = useUIStore((s) => s.unreadMessages);
  const sseStatus = useUIStore((s) => s.sseStatus);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutCheck, setShowLogoutCheck] = useState(false);

  // ESC key to close modals (logout confirmation takes priority)
  useEscapeKey(() => setShowLogoutCheck(false), showLogoutCheck);
  useEscapeKey(() => setMobileMenuOpen(false), mobileMenuOpen && !showLogoutCheck);

  const toggleLanguage = () => {
    const newLang = language === 'ar' ? 'en' : 'ar';
    setLanguage(newLang);
  };

  const pageTitle = title || t('dashboard.title');

  useEffect(() => {
    // Session Verification for Web (Cookie-based)
    // We trust Zustand 'isAuthenticated' initially to show UI instantly,
    // but we must verify the actual cookie is still valid in the background.
    const verifySession = async () => {
        if (_hasHydrated && isAuthenticated && typeof window !== 'undefined') {
            const { Capacitor } = await import('@capacitor/core');
            if (!Capacitor.isNativePlatform()) {
                 try {
                     // Dynamic import to avoid circular dependencies
                     const { authApi } = await import('@/lib/api');
                     await authApi.getProfile();
                 } catch {
                     // If 401, the interceptor will handle redirect
                     // But if network error or other, we might want to log it
                     addErrorBreadcrumb('auth', 'Session verification failed');
                 }
            }
        }
    };

    verifySession();
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

  // Don't render anything until hydration is complete
  // (_app.tsx already guards with AppSkeleton, so this is a safety net)
  if (!_hasHydrated) {
    return null;
  }

  // If not public and not authenticated, we're redirecting, so show nothing
  if (!isPublic && !isAuthenticated) {
    return null;
  }

  const isCleanLayout = isPublic && !isAuthenticated;
  // WhatsApp-style: no visible bottom safe area - nav at edge

  return (
    <>
      <Head>
        {!skipTitle && <title>{pageTitle} | Jawab24</title>}
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="dashboard-scroll-root flex-1 overflow-y-auto bg-surface-50 bg-gradient-mesh">
        {/* Dark mode decorative background — teal/blue glows + cubes pattern */}
        <div className="hidden dark:block fixed inset-0 pointer-events-none z-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(93,174,164,0.15),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_90%,rgba(93,174,164,0.10),transparent_60%)]" />
          <div className="absolute inset-0 bg-[url('/images/cubes.png')] opacity-[0.06]" />
        </div>

        {/* Sidebar - hidden on mobile and on clean layouts */}
        {!isCleanLayout && (
          <div className="hidden lg:block">
            <Sidebar />
          </div>
        )}

        {/* Public header - Matches landing page style */}
        {isCleanLayout ? (
          <nav className="fixed w-full z-50 transition-all duration-300 bg-card/80 backdrop-blur-md border-b border-theme-border pt-safe px-safe-landscape">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                {/* Logo - matches landing page */}
                <Link href="/landing" className="flex items-center gap-2 sm:gap-3 group">
                  <BrandLogo
                    variant="main"
                    className="w-10 h-10 transition-transform group-hover:rotate-6 flex-shrink-0"
                  />
                  <span className="font-display font-bold text-xl text-foreground tracking-tight">{BRAND_ASSETS.meta.appName}</span>
                </Link>

                {/* Actions - matches landing page */}
                <div className="flex items-center gap-1 sm:gap-4">
                  {/* Pricing link - hidden on mobile */}
                  <Link href="/pricing" className="hidden md:block px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-xl hover:bg-brand-50 transition-all">
                    {t('landing.nav.pricing' as TranslationKey)}
                  </Link>
                  <button
                    onClick={toggleLanguage}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 transition-all"
                  >
                    {t('common.switchLanguage')}
                  </button>
                  {isAuthenticated ? (
                    <Link href="/dashboard">
                      <button className="font-bold shadow-xl shadow-brand-500/20 px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5 bg-brand-500 text-white rounded-xl hover:bg-brand-600 transition-all">
                        {t('nav.dashboard')}
                      </button>
                    </Link>
                  ) : (
                    <Link href="/login?redirect=%2Fdashboard">
                      <button className="font-bold border-none px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5 text-brand-600 rounded-lg hover:bg-brand-50 transition-all">
                        {t('landing.nav.login' as TranslationKey)}
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
            className="lg:hidden sticky top-0 left-0 right-0 h-14 sm:h-16 flex items-center justify-between px-4 px-safe-landscape z-40 pt-safe box-content"
            style={{
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)'
            }}
          >
            <Link href="/dashboard" className="flex items-center min-w-[44px] min-h-[44px] justify-center">
              <BrandLogo variant="vector" className="w-9 h-9" />
            </Link>

            <div className="flex items-center gap-2">
              {sseStatus === 'reconnecting' && (
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              )}
              <NotificationBell variant="dark" />
            </div>
          </div>
        )}

        {/* Main content - uses centralized spacing from CSS variables */}
        <main
          className={clsx(
            'relative z-[1] transition-all duration-500 flex-1',
            // Clean layout (public pages): use pt-header for fixed header spacing
            // Regular layout: sticky header is in document flow, no extra padding needed on mobile
            // Desktop (with sidebar) still gets no top padding
            isCleanLayout ? 'pt-header' : 'lg:pt-0',
            !isCleanLayout && (sidebarOpen ? 'lg:ms-64' : 'lg:ms-20')
          )}
        >
          <div
            className={clsx(
              // Padding around content - top padding is minimal since sticky header is in document flow
              'px-4 pt-5 px-safe-landscape max-lg:landscape:pt-2 md:px-8 md:pt-8 lg:px-16 lg:pt-10 xl:px-20 max-w-[1600px] mx-auto',
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
        {!isCleanLayout && (
          <>
            {/* Bottom navigation - sits ABOVE the safe area in portrait, at bottom in landscape */}
            <nav
              className="lg:hidden fixed left-0 right-0 bg-card border-t border-theme-border/50 flex justify-around items-center h-16 z-40 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] px-safe-landscape bottom-nav-position"
            >
              <MobileNavButton
                onClick={() => router.push('/dashboard')}
                icon={<LayoutDashboard className="w-7 h-7" />}
                label={t('nav.dashboard')}
                active={router.pathname === '/dashboard'}
              />
              <MobileNavButton
                onClick={() => router.push('/comments')}
                icon={<MessageSquare className="w-7 h-7" />}
                label={t('nav.comments')}
                active={router.pathname === '/comments'}
                badge={unreadComments}
              />
              <MobileNavButton
                onClick={() => router.push('/messages')}
                icon={<MessageCircle className="w-7 h-7" />}
                label={t('nav.messages')}
                active={router.pathname === '/messages'}
                badge={unreadMessages}
              />
              <MobileNavButton
                onClick={() => setMobileMenuOpen(true)}
                icon={<MoreHorizontal className="w-7 h-7" />}
                label={t('nav.more') || 'More'}
                active={mobileMenuOpen || ['/pages', '/templates', '/rules', '/pricing', '/settings'].includes(router.pathname)}
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
            t={t}
            onLogout={() => { setMobileMenuOpen(false); setShowLogoutCheck(true); }}
          />
        )}

        {/* Logout Confirmation Modal */}
        {showLogoutCheck && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-card rounded-2xl w-full max-w-sm shadow-xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-4 border-b border-theme-border">
                <h3 className="text-lg font-bold text-foreground text-center">
                  {t('logout.confirmTitle')}
                </h3>
              </div>
              <p className="text-muted-foreground text-center px-6 pt-4 pb-6">
                {t('logout.confirmBody')}
              </p>
              <div className="flex gap-3 px-6 pb-6">
                <button
                  onClick={() => setShowLogoutCheck(false)}
                  className="flex-1 py-3 rounded-xl font-semibold text-foreground/80 bg-muted hover:bg-surface-200 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => { logout(); router.push('/login'); }}
                  className="flex-1 py-3 rounded-xl font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                >
                  {t('nav.logout')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Version badge - subtle indicator in corner */}
        <VersionBadge />

        {/* WhatsApp help button - floating (hidden during modals and onboarding) */}
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
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center h-full w-full relative group min-h-[44px]"
    >
      <div className={clsx(
        "relative transition-all duration-200 mb-1",
        active ? "text-brand-600 scale-100 opacity-100" : "text-surface-500 scale-100 opacity-40 group-hover:opacity-60"
      )}>
        {icon}
        {badge != null && badge > 0 && (
          <span className="absolute -top-1.5 -end-2.5 flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span className={clsx(
        "text-[11px] tracking-wide transition-all leading-tight",
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
  t, 
  onLogout 
}: {
  isOpen: boolean;
  onClose: () => void;
  isRTL: boolean;
  router: ReturnType<typeof useRouter>;
  t: (key: TranslationKey) => string;
  onLogout: () => void;
}) {
  // Reusable hooks
  const isLandscape = useLandscape();
  useBodyScrollLock(isOpen);

  const menuItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
    { path: '/pages', icon: FileText, label: t('nav.pages') },
    { path: '/comments', icon: MessageSquare, label: t('nav.comments') },
    { path: '/messages', icon: MessageCircle, label: t('nav.messages') },
    { path: '/templates', icon: BookTemplate, label: t('nav.templates') },
    { path: '/rules', icon: Zap, label: t('nav.rules') },
    { path: '/pricing', icon: CreditCard, label: t('pricing.title') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
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
      aria-label={t('nav.menu') || 'Menu'}
    >
      {/* Backdrop - darker in landscape for better contrast */}
      <div className={clsx(
        "absolute inset-0 backdrop-blur-sm transition-colors",
        isLandscape ? "bg-black/60" : "bg-black/45"
      )} />

      {/* Menu Container - Different layouts for portrait/landscape */}
      <div
        className={clsx(
          "absolute bg-card overflow-hidden",
          isLandscape
            // Landscape: Centered modal (iOS/Android standard for landscape)
            ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl w-[90vw] max-w-[600px] max-h-[85vh] animate-in zoom-in-95 duration-200 px-safe"
            // Portrait: Bottom sheet (iOS standard) with bottom safe area
            : "bottom-0 left-0 right-0 rounded-t-[24px] animate-in slide-in-from-bottom duration-300 pb-safe"
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
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-surface-200" />
          </div>
        )}

        {/* Header */}
        <div className={clsx(
          "flex items-center justify-between border-b border-theme-border",
          isLandscape ? "px-5 py-3" : "px-5 py-3"
        )}>
          <h3 className={clsx(
            "font-semibold text-foreground",
            isLandscape ? "text-base" : "text-lg"
          )}>
            {t('nav.menu') || 'Menu'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 -m-2 rounded-full hover:bg-muted text-muted-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close menu"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className={clsx(
          "overflow-y-auto",
          isLandscape ? "p-4" : "p-5"
        )}>
          {isLandscape ? (
            // Landscape: Horizontal row layout (maximizes vertical space)
            <div className="flex flex-wrap justify-center gap-3">
              {menuItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.path)}
                  className={clsx(
                    "flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-200",
                    "bg-muted hover:bg-brand-50 border border-theme-border hover:border-brand-200",
                    "active:scale-95 min-h-[48px]",
                    router.pathname === item.path && "bg-brand-50 border-brand-200 text-brand-700"
                  )}
                >
                  <item.icon className="w-6 h-6 text-brand-600 flex-shrink-0" />
                  <span className="font-medium text-sm text-surface-800 whitespace-nowrap">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            // Portrait: Grid layout (iOS/Android standard)
            <div className="grid grid-cols-2 gap-2.5">
              {menuItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.path)}
                  className={clsx(
                    "flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-200",
                    "bg-card border border-theme-border/60",
                    "shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                    "active:scale-95 min-h-[90px]",
                    router.pathname === item.path && "border-brand-200 bg-brand-50/50"
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-50 to-brand-100/50 flex items-center justify-center mb-2 text-brand-600">
                    <item.icon className="w-6 h-6" />
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
              {t('nav.logout')}
      </span>
    </button>
        </div>
      </div>
    </div>
  );
}
