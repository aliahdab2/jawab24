import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import clsx from 'clsx';
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
        <Sidebar />
        <main 
          className={clsx(
            'transition-all duration-300 min-h-screen',
            sidebarOpen ? 'ms-64' : 'ms-20' // ms = margin-inline-start (works with RTL)
          )}
        >
          <div className="p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
