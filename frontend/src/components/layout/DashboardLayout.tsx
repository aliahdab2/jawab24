import { MessageCircle, LayoutDashboard, FileText, MessageSquare, Settings, MoreHorizontal, X, LogOut } from 'lucide-react';
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

  const isCleanLayout = isPublic;

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
          <div className="fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-xl flex items-center justify-between px-6 z-40 border-b border-surface-100 shadow-sm">
            <Link href="/landing" className="flex items-center gap-2 group">
              <BrandLogo
                variant="small"
                className="w-8 h-8 rounded-lg shadow-md shadow-brand-500/20 group-hover:rotate-6 transition-transform"
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
          <div className="md:hidden fixed top-0 left-0 right-0 h-20 bg-surface-900 flex items-center justify-between px-6 z-40 shadow-xl border-b border-white/5">
            <Link href="/dashboard" className="flex items-center gap-3 ps-1">
              <BrandLogo
                variant="vector"
                className="w-8 h-8 flex-shrink-0"
              />
              <span className="font-display font-bold text-lg text-surface-900 tracking-tight">{BRAND_ASSETS.meta.appName}</span>
            </Link>
            <button
              onClick={() => router.push('/settings')}
              className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 shadow-inner"
            >
              <Settings className="w-5 h-5" />
            </button>
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

        {/* Mobile bottom navigation - hidden on clean layouts */}
        {!isCleanLayout && (
          <nav
            className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-surface-100 flex justify-around items-center h-20 px-2 z-40 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)]"
          >
            <MobileNavButton
              onClick={() => router.push('/dashboard')}
              icon={<LayoutDashboard className="w-5 h-5" />}
              label={t('nav.dashboard')}
              active={router.pathname === '/dashboard'}
            />
            <MobileNavButton
              onClick={() => router.push('/comments')}
              icon={<MessageSquare className="w-5 h-5" />}
              label={t('nav.comments')}
              active={router.pathname === '/comments'}
            />
            <MobileNavButton
              onClick={() => router.push('/messages')}
              icon={<MessageCircle className="w-5 h-5" />}
              label={t('nav.messages')}
              active={router.pathname === '/messages'}
            />
            <MobileNavButton
              onClick={() => setMobileMenuOpen(true)}
              icon={<MoreHorizontal className="w-5 h-5" />}
              label={t('nav.more') || 'More'}
              active={mobileMenuOpen}
            />
          </nav>
        )}

        {/* Mobile full menu overlay */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 bg-black/50 z-50" onClick={() => setMobileMenuOpen(false)}>
            <div
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4"
              style={{ paddingBottom: 'max(1rem, calc(1rem + env(safe-area-inset-bottom, 0px)))' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-lg">{t('nav.menu') || 'Menu'}</h3>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 rounded-full hover:bg-surface-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {/* Simple navigation - Templates & Rules are in Settings */}
              <div className="grid grid-cols-3 gap-4">
                <MobileMenuButton
                  onClick={() => { router.push('/dashboard'); setMobileMenuOpen(false); }}
                  icon={<LayoutDashboard className="w-6 h-6" />}
                  label={t('nav.dashboard')}
                />
                <MobileMenuButton
                  onClick={() => { router.push('/pages'); setMobileMenuOpen(false); }}
                  icon={<FileText className="w-6 h-6" />}
                  label={t('nav.pages')}
                />
                <MobileMenuButton
                  onClick={() => { router.push('/comments'); setMobileMenuOpen(false); }}
                  icon={<MessageSquare className="w-6 h-6" />}
                  label={t('nav.comments')}
                />
                <MobileMenuButton
                  onClick={() => { router.push('/messages'); setMobileMenuOpen(false); }}
                  icon={<MessageCircle className="w-6 h-6" />}
                  label={t('nav.messages')}
                />
                <MobileMenuButton
                  onClick={() => { router.push('/settings'); setMobileMenuOpen(false); }}
                  icon={<Settings className="w-6 h-6" />}
                  label={t('nav.settings')}
                />
                <MobileMenuButton
                  onClick={() => { logout(); setMobileMenuOpen(false); router.push('/login'); }}
                  icon={<LogOut className="w-6 h-6 text-red-500" />}
                  label={t('nav.logout')}
                  className="hover:border-red-200 hover:bg-red-50/30"
                />
              </div>
            </div>
          </div>
        )}

        {/* Version badge - subtle indicator in corner */}
        <VersionBadge />

        {/* WhatsApp help button - floating */}
        <WhatsAppHelpButton />
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
      className={clsx(
        "flex flex-col items-center justify-center h-full px-4 transition-all duration-300 relative",
        active ? "text-brand-600" : "text-surface-400 hover:text-brand-500"
      )}
    >
      <div className={clsx(
        "transition-transform duration-300 mb-1",
        active ? "scale-110" : "scale-100"
      )}>
        {icon}
      </div>
      <span className={clsx(
        "text-[10px] font-bold uppercase tracking-widest",
        active ? "opacity-100" : "opacity-60"
      )}>{label}</span>
      {active && (
        <div className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-1 bg-brand-600 rounded-full shadow-[0_0_10px_rgba(13,148,136,0.5)]"></div>
      )}
    </button>
  );
}

function MobileMenuButton({ onClick, icon, label, className }: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex flex-col items-center p-6 rounded-[2rem] bg-surface-50 border border-surface-100 transition-all group",
        className || "hover:border-brand-200 hover:bg-brand-50/30"
      )}
    >
      <div className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-surface-100 flex items-center justify-center text-brand-600 mb-3 group-hover:scale-110 group-hover:rotate-3 transition-transform">
        {icon}
      </div>
      <span className="text-xs font-bold text-surface-900 uppercase tracking-tight">{label}</span>
    </button>
  );
}
