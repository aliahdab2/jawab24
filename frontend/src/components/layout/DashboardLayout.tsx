import { MessageCircle, LayoutDashboard, MessageSquare, Settings, MoreHorizontal, X, LogOut } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Sidebar } from './Sidebar';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { VersionBadge, WhatsAppHelpButton, BrandLogo } from '@/components/ui';
import clsx from 'clsx';
import { BRAND_ASSETS } from '@/constants/brand';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  isPublic?: boolean;
}

export function DashboardLayout({ children, title, isPublic = false }: DashboardLayoutProps) {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();
  const isRTL = language === 'ar';
  const { isAuthenticated, _hasHydrated, logout } = useAuthStore();
  const { sidebarOpen } = useUIStore();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutCheck, setShowLogoutCheck] = useState(false);

  const toggleLanguage = () => {
    const newLang = language === 'ar' ? 'en' : 'ar';
    setLanguage(newLang);
  };

  const pageTitle = title || t('dashboard.title');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (_hasHydrated && !isAuthenticated && !isPublic) {
      router.push('/login');
    }
  }, [_hasHydrated, isAuthenticated, isPublic, router]);

  // Update document direction based on language
  useEffect(() => {
    if (mounted) {
      document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
      document.documentElement.lang = isRTL ? 'ar' : 'en';
    }
  }, [isRTL, mounted]);

  // Don't render anything until hydration is complete
  if (!mounted || !_hasHydrated) {
    return null; // Don't show full page spinner here, rely on _app.tsx or just blank slate to avoid double-spin
  }

  // If not public and not authenticated, we're redirecting, so show nothing
  if (!isPublic && !isAuthenticated) {
    return null;
  }

  const isCleanLayout = isPublic && !isAuthenticated;

  return (
    <>
      <Head>
        <title>{pageTitle} | Jawab24</title>
      </Head>

      <div className="min-h-screen bg-surface-50 bg-gradient-mesh" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Sidebar - hidden on mobile and on clean layouts */}
        {!isCleanLayout && (
          <div className="hidden md:block">
            <Sidebar />
          </div>
        )}

        {/* Mobile header - Clean version for public pages */}
        {isCleanLayout ? (
          <div className="fixed top-0 left-0 right-0 h-16 sm:h-20 bg-white/80 backdrop-blur-xl flex items-center justify-between px-6 z-40 border-b border-surface-100 shadow-sm pt-safe box-content">
            <Link href="/landing" className="flex items-center gap-2 group">
              <BrandLogo
                variant="vector"
                className="w-8 h-8 group-hover:rotate-6 transition-transform"
              />
              <span className="font-display font-bold text-lg tracking-tight text-surface-900">{BRAND_ASSETS.meta.appName}</span>
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleLanguage}
                className="px-3 py-1.5 text-xs font-bold text-surface-600 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-all"
              >
                {language === 'ar' ? 'English' : 'العربية'}
              </button>
              <Link href={isAuthenticated ? '/dashboard' : '/login'}>
                <button className="text-sm font-bold text-brand-600 hover:text-brand-700 bg-brand-50 px-4 py-2 rounded-xl transition-all">
                  {isAuthenticated ? t('nav.dashboard') : t('auth.login')}
                </button>
              </Link>
            </div>
          </div>
        ) : (
          /* Mobile APP Header - Final: h-16 (64px), Dark Gradient, Logo Left, Dynamic Icon Right */
          <div
            className="md:hidden sticky top-0 left-0 right-0 h-20 flex items-center justify-between px-5 z-40 pt-safe"
            style={{
              background: 'linear-gradient(to bottom, #000000 0%, rgba(0, 0, 0, 0.8) 40%, rgba(0, 0, 0, 0.4) 75%, transparent 100%)'
            }}
          >
            <Link href="/dashboard" className="flex items-center p-2 -ml-2 min-w-[44px] min-h-[44px] justify-center">
              <BrandLogo variant="vector" className="w-10 h-10" />
            </Link>

            {/* Dynamic Active Page Icon */}
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 text-white/90">
              {router.pathname.includes('/comments') ? (
                <MessageSquare className="w-5 h-5" />
              ) : router.pathname.includes('/messages') ? (
                <MessageCircle className="w-5 h-5" />
              ) : router.pathname.includes('/settings') ? (
                <Settings className="w-5 h-5" />
              ) : (
                <LayoutDashboard className="w-5 h-5" />
              )}
            </div>
          </div>
        )}

        {/* Main content */}
        <main
          className={clsx(
            'transition-all duration-500 min-h-screen',
            'pt-safe', // Ensures main content respects safe area top
            isCleanLayout ? 'pt-16 md:pt-20' : 'pt-20 md:pt-0',
            !isCleanLayout && (sidebarOpen ? 'md:ms-64' : 'md:ms-20')
          )}
        >
          <div className={clsx(
            'p-4 md:p-8 lg:p-12 max-w-[1600px] mx-auto',
            isCleanLayout ? 'pb-12' : 'pb-32 md:pb-12'
          )}>
            {children}
          </div>
        </main>

        {/* Mobile bottom navigation - Final Spec: h-16 (64px), 4 items, proper sizing */}
        {/* Mobile bottom navigation - Final Spec: h-16 (64px), 4 items, proper sizing */}
        {!isCleanLayout && (
          <nav
            className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-surface-100/50 flex justify-around items-center h-16 z-40 pb-[env(safe-area-inset-bottom)] box-content shadow-[0_-4px_16px_rgba(0,0,0,0.05)]"
          >
            <MobileNavButton
              onClick={() => router.push('/dashboard')}
              icon={<LayoutDashboard className="w-6 h-6" />}
              label={t('nav.dashboard')}
              active={router.pathname === '/dashboard'}
            />
            <MobileNavButton
              onClick={() => router.push('/comments')}
              icon={<MessageSquare className="w-6 h-6" />}
              label={t('nav.comments')}
              active={router.pathname === '/comments'}
            />
            <MobileNavButton
              onClick={() => router.push('/messages')}
              icon={<MessageCircle className="w-6 h-6" />}
              label={t('nav.messages')}
              active={router.pathname === '/messages'}
            />
            <MobileNavButton
              onClick={() => setMobileMenuOpen(true)}
              icon={<MoreHorizontal className="w-6 h-6" />}
              label={t('nav.more') || 'More'}
              active={mobileMenuOpen}
            />
          </nav>
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
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-4 border-b border-surface-100">
                <h3 className="text-lg font-bold text-surface-900 text-center">
                  {t('logout.confirmTitle')}
                </h3>
              </div>
              <p className="text-surface-600 text-center px-6 pt-4 pb-6">
                {t('logout.confirmBody')}
              </p>
              <div className="flex gap-3 px-6 pb-6">
                <button
                  onClick={() => setShowLogoutCheck(false)}
                  className="flex-1 py-3 rounded-xl font-semibold text-surface-700 bg-surface-100 hover:bg-surface-200 transition-colors"
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

        {/* WhatsApp help button - floating */}
        <WhatsAppHelpButton hidden={mobileMenuOpen || showLogoutCheck} />
      </div>
    </>
  );
}

// Mobile nav button component
function MobileNavButton({ onClick, icon, label, active }: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center h-full w-full relative group min-h-[44px]"
    >
      <div className={clsx(
        "transition-all duration-200 mb-1",
        active ? "text-brand-600 scale-100 opacity-100" : "text-surface-500 scale-100 opacity-40 group-hover:opacity-60"
      )}>
        {icon}
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
  t: (key: string) => string;
  onLogout: () => void;
}) {
  const [isLandscape, setIsLandscape] = React.useState(false);

  // Detect orientation using matchMedia (industry standard approach)
  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    setIsLandscape(mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Prevent body scroll when menu is open (iOS/Android best practice)
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  const menuItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
    { path: '/comments', icon: MessageSquare, label: t('nav.comments') },
    { path: '/messages', icon: MessageCircle, label: t('nav.messages') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
  ];

  const handleNavigate = (path: string) => {
    router.push(path);
    onClose();
  };

  return (
    <div 
      className="md:hidden fixed inset-0 z-50 animate-in fade-in duration-200"
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
          "absolute bg-white overflow-hidden",
          isLandscape
            // Landscape: Centered modal (iOS/Android standard for landscape)
            ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl w-[90vw] max-w-[600px] max-h-[85vh] animate-in zoom-in-95 duration-200"
            // Portrait: Bottom sheet (iOS standard)
            : "bottom-0 left-0 right-0 rounded-t-[24px] animate-in slide-in-from-bottom duration-300"
        )}
        style={{
          boxShadow: isLandscape 
            ? '0 25px 50px -12px rgba(0,0,0,0.25)' 
            : '0 -8px 32px rgba(0,0,0,0.16)',
          // Safe area padding for portrait bottom sheet
          paddingBottom: !isLandscape ? 'max(1rem, env(safe-area-inset-bottom, 0px))' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Drag Handle - Portrait only (iOS standard) */}
        {!isLandscape && (
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-surface-200" />
          </div>
        )}

        {/* Header */}
        <div className={clsx(
          "flex items-center justify-between border-b border-surface-100",
          isLandscape ? "px-5 py-3" : "px-5 py-3"
        )}>
          <h3 className={clsx(
            "font-semibold text-surface-900",
            isLandscape ? "text-base" : "text-lg"
          )}>
            {t('nav.menu') || 'Menu'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 -m-2 rounded-full hover:bg-surface-100 text-surface-500 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
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
                    "bg-surface-50 hover:bg-brand-50 border border-surface-100 hover:border-brand-200",
                    "active:scale-95 min-h-[48px]",
                    router.pathname === item.path && "bg-brand-50 border-brand-200 text-brand-700"
                  )}
                >
                  <item.icon className="w-5 h-5 text-brand-600 flex-shrink-0" />
                  <span className="font-medium text-sm text-surface-800 whitespace-nowrap">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            // Portrait: Grid layout (iOS/Android standard)
            <div className="grid grid-cols-2 gap-3">
              {menuItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.path)}
                  className={clsx(
                    "flex flex-col items-center justify-center p-5 rounded-2xl transition-all duration-200",
                    "bg-white border border-surface-100/60",
                    "shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                    "active:scale-95 min-h-[110px]",
                    router.pathname === item.path && "border-brand-200 bg-brand-50/50"
                  )}
                >
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100/50 flex items-center justify-center mb-3 text-brand-600">
                    <item.icon className="w-7 h-7" />
                  </div>
                  <span className="font-bold text-sm text-surface-900 text-center line-clamp-2">
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
              "bg-gradient-to-r from-red-50 to-white border border-red-100",
              "hover:border-red-200 hover:shadow-md active:scale-[0.98]",
              isLandscape ? "mt-4 py-3" : "mt-5 py-4"
            )}
          >
            <LogOut className={clsx(
              "text-red-500",
              isRTL && "rotate-180",
              isLandscape ? "w-5 h-5" : "w-6 h-6"
            )} />
            <span className={clsx(
              "font-semibold text-red-600",
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
