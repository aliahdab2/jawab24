import { MessageCircle, LayoutDashboard, MessageSquare, Settings, MoreHorizontal, X, LogOut } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Sidebar } from './Sidebar';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { PageSpinner, VersionBadge, WhatsAppHelpButton, BrandLogo } from '@/components/ui';
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
    return (
      <>
        <Head>
          <title>{pageTitle} | Jawab24</title>
        </Head>
        <div className="min-h-screen bg-surface-50 flex items-center justify-center">
          <PageSpinner />
        </div>
      </>
    );
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
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" />
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
          <div className="fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-xl flex items-center justify-between px-6 z-40 border-b border-surface-100 shadow-sm">
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
            className="md:hidden sticky top-0 left-0 right-0 h-20 flex items-center justify-between px-5 z-40"
            style={{
              paddingTop: 'env(safe-area-inset-top)',
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
            isCleanLayout ? 'pt-16 md:pt-20' : 'pt-20 md:pt-0',
            !isCleanLayout && (sidebarOpen ? 'md:ms-64' : 'md:ms-20')
          )}
        >
          <div className={clsx(
            'p-4 md:p-8 lg:p-12 max-w-[1600px] mx-auto',
            isCleanLayout ? 'pb-12' : 'pb-24 md:pb-12'
          )}>
            {children}
          </div>
        </main>

        {/* Mobile bottom navigation - Final Spec: h-16 (64px), 4 items, proper sizing */}
        {!isCleanLayout && (
          <nav
            className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-surface-100/50 flex justify-around items-center h-16 z-40 pb-[env(safe-area-inset-bottom)] box-content"
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

        {/* Mobile full menu overlay - 2 columns, stronger shadow, 40-50% backdrop */}
        {/* Mobile full menu overlay - 2 columns, stronger shadow, 40-50% backdrop */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 bg-black/45 z-50 backdrop-blur-sm animate-in fade-in" onClick={() => setMobileMenuOpen(false)}>
            <div
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[24px] p-5 animate-in slide-in-from-bottom overflow-y-auto"
              style={{
                paddingBottom: 'max(1.25rem, calc(1.25rem + env(safe-area-inset-bottom, 0px)))',
                maxHeight: '85vh',
                boxShadow: '0 -8px 32px rgba(0,0,0,0.16)'
              }}
              onClick={(e) => e.stopPropagation()}
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              {/* Menu Header - RTL: القائمة (right), X (left), 48px height */}
              <div className="flex items-center justify-between h-12 pb-4 mb-6 border-b border-surface-100">
                <h3 className="font-semibold text-lg text-surface-900 text-start">{t('nav.menu') || 'القائمة'}</h3>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 -m-2 rounded-full hover:bg-surface-100 text-surface-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Menu Grid - 2 columns, Minimalist Focus (4 items) */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Row 1: الرئيسية | التعليقات */}
                <MobileMenuButton
                  onClick={() => { router.push('/dashboard'); setMobileMenuOpen(false); }}
                  icon={<LayoutDashboard className="w-7 h-7" />}
                  label={t('nav.dashboard')}
                />
                <MobileMenuButton
                  onClick={() => { router.push('/comments'); setMobileMenuOpen(false); }}
                  icon={<MessageSquare className="w-7 h-7" />}
                  label={t('nav.comments')}
                />

                {/* Row 2: الرسائل | الإعدادات */}
                <MobileMenuButton
                  onClick={() => { router.push('/messages'); setMobileMenuOpen(false); }}
                  icon={<MessageCircle className="w-7 h-7" />}
                  label={t('nav.messages')}
                />
                <MobileMenuButton
                  onClick={() => { router.push('/settings'); setMobileMenuOpen(false); }}
                  icon={<Settings className="w-7 h-7" />}
                  label={t('nav.settings')}
                />
              </div>

              {/* Row 3: تسجيل الخروج (full width) */}
              <MobileMenuButton
                onClick={() => { setMobileMenuOpen(false); setShowLogoutCheck(true); }}
                icon={<LogOut className="w-7 h-7" />}
                label={t('nav.logout')}
                className="logout-button"
                fullWidth
              />
            </div>
          </div>
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

function MobileMenuButton({ onClick, icon, label, className, fullWidth }: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
  fullWidth?: boolean;
}) {
  const isLogout = className?.includes('logout');
  const { language } = useTranslation();
  const isRTL = language === 'ar';

  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-2xl transition-all duration-300 active:scale-95 outline-none border",
        isLogout
          ? "flex items-center justify-center gap-4 p-4 mt-8 h-[56px] w-full border-red-100 bg-gradient-to-r from-red-50 to-white text-red-600 shadow-sm hover:shadow-md hover:border-red-200"
          : "flex flex-col items-center justify-center p-5 border-surface-100/60 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] min-h-[110px]",
        className
      )}
    >
      <div className={clsx(
        "flex items-center justify-center transition-all duration-300",
        isLogout
          ? `text-red-500 ${isRTL ? 'rotate-180' : ''} group-hover:scale-110`
          : "w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100/50 text-brand-600 mb-3.5 shadow-inner"
      )}>
        {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
          className: isLogout ? 'w-6 h-6' : 'w-7 h-7'
        }) : icon}
      </div>
      <span className={clsx(
        "font-bold tracking-tight transition-colors",
        isLogout ? "text-red-600 text-sm whitespace-nowrap" : "text-[14px] text-surface-900 text-center w-full px-1 line-clamp-2 leading-tight"
      )}>
        {label}
      </span>
    </button>
  );
}
