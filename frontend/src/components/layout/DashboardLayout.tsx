import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Sidebar } from './Sidebar';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { PageSpinner } from '@/components/ui';

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
          className="transition-all duration-300 min-h-screen pt-14 md:pt-0"
          style={{ marginInlineStart: typeof window !== 'undefined' && window.innerWidth >= 768 ? (sidebarOpen ? '16rem' : '5rem') : 0 }}
        >
          <div className="p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </main>
        
        {/* Mobile bottom navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-surface-200 flex justify-around py-2 z-40">
          <button onClick={() => router.push('/dashboard')} className="flex flex-col items-center p-2 text-surface-600 hover:text-brand-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="text-xs mt-1">{t('nav.dashboard')}</span>
          </button>
          <button onClick={() => router.push('/pages')} className="flex flex-col items-center p-2 text-surface-600 hover:text-brand-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-xs mt-1">{t('nav.pages')}</span>
          </button>
          <button onClick={() => router.push('/comments')} className="flex flex-col items-center p-2 text-surface-600 hover:text-brand-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-xs mt-1">{t('nav.comments')}</span>
          </button>
          <button onClick={() => router.push('/settings')} className="flex flex-col items-center p-2 text-surface-600 hover:text-brand-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs mt-1">{t('nav.settings')}</span>
          </button>
        </nav>
      </div>
    </>
  );
}
