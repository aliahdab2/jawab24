import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import { useLanguage } from '@/i18n';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const { language } = useLanguage();
  const isRTL = language === 'ar';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Update document direction
  useEffect(() => {
    if (mounted) {
      document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
      document.documentElement.lang = isRTL ? 'ar' : 'en';
    }
  }, [isRTL, mounted]);

  useEffect(() => {
    // Wait for both mounting and hydration before redirecting
    if (mounted && _hasHydrated) {
      if (isAuthenticated) {
        router.push('/dashboard');
      } else {
        // Redirect to landing page for unauthenticated users
        router.push('/landing');
      }
    }
  }, [isAuthenticated, _hasHydrated, mounted, router]);

  // Show a loading state while waiting
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center animate-pulse">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h1 className="text-xl font-display font-bold text-surface-900">Jawab24</h1>
        <p className="text-surface-500 mt-2">
          {t('common.loading')}
        </p>
      </div>
    </div>
  );
}
