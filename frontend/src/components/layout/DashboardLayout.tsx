import { MessageCircle, LayoutDashboard, FileText, MessageSquare, Settings, MoreHorizontal, X } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Sidebar } from './Sidebar';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { PageSpinner, VersionBadge, WhatsAppHelpButton } from '@/components/ui';
import clsx from 'clsx';

interface DashboardLayoutProps {
  children: ReactNode;
  title?: string;
}

export function DashboardLayout({ children, title }: DashboardLayoutProps) {
  const router = useRouter();
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const { sidebarOpen } = useUIStore();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pageTitle = title || t('dashboard.title');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (_hasHydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [_hasHydrated, isAuthenticated, router]);

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

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <Head>
        <title>{pageTitle} | Jawab24</title>
      </Head>
      <div className="min-h-screen bg-surface-50" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Sidebar - hidden on mobile */}
        <div className="hidden md:block">
          <Sidebar />
        </div>
        
        {/* Mobile header */}
        <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-surface-900 text-white flex items-center justify-between px-4 z-40">
          <span className="font-display font-bold">Jawab24</span>
          <button 
            onClick={() => router.push('/settings')}
            className="p-2 rounded-lg hover:bg-surface-800"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        
        {/* Main content */}
        <main 
          className={clsx(
            'transition-all duration-300 min-h-screen pt-14 md:pt-0',
            sidebarOpen ? 'md:ms-64' : 'md:ms-20'
          )}
        >
          <div className="p-4 md:p-6 lg:p-8 pb-24 md:pb-8">
            {children}
          </div>
        </main>
        
        {/* Mobile bottom navigation */}
        <nav 
          className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-surface-200 flex justify-around items-start pt-2 z-40"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0.5rem))' }}
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
        "flex flex-col items-center p-2 transition-colors",
        active ? "text-brand-600" : "text-surface-500 hover:text-brand-600"
      )}
    >
      {icon}
      <span className="text-[10px] mt-1 font-medium">{label}</span>
    </button>
  );
}

// Mobile menu button component
function MobileMenuButton({ onClick, icon, label }: { 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string;
}) {
  return (
    <button 
      onClick={onClick} 
      className="flex flex-col items-center p-4 rounded-xl hover:bg-surface-100 transition-colors"
    >
      <div className="text-brand-600 mb-2">{icon}</div>
      <span className="text-xs font-medium text-surface-700">{label}</span>
    </button>
  );
}
