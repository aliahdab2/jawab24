import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import { useTranslation } from '@/i18n';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const [mounted, setMounted] = useState(false);
  
  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);

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
    // Only redirect once to prevent loops
    if (mounted && _hasHydrated && !redirectedRef.current) {
      redirectedRef.current = true;
      if (isAuthenticated) {
        routerRef.current.push('/dashboard');
      } else {
        // Redirect to landing page for unauthenticated users
        routerRef.current.push('/landing');
      }
    }
  }, [isAuthenticated, _hasHydrated, mounted]);

  // Minimal loading - just white screen while redirecting
  return (
    <div className="min-h-screen bg-white" dir={isRTL ? 'rtl' : 'ltr'} />
  );
}
