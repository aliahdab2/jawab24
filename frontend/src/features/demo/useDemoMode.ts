/**
 * Demo Mode Hook
 * 
 * Encapsulates all demo mode logic in one place.
 * To remove demo mode: delete this folder and remove imports.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { publicApi } from '@/lib/api';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslations, useLocale } from 'next-intl';
import { captureError } from '@/lib/sentryHelpers';

export function useDemoMode() {
  const router = useRouter();
  const t = useTranslations('auth');
  const locale = useLocale();
  const setAuth = useAuthStore((state) => state.setAuth);
  
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check if demo mode is enabled on mount
  useEffect(() => {
    const checkDemoStatus = async () => {
      try {
        const response = await publicApi.get('/auth/demo/status');
        setIsEnabled(response.data?.enabled === true);
      } catch {
        setIsEnabled(false);
      }
    };
    checkDemoStatus();
  }, []);

  // Handle demo login
  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await publicApi.post('/auth/demo');
      const { user, token, settings } = response.data;
      
      setAuth(user, token, 'demo_token');
      
      const finalLocale = settings?.dashboardLanguage || locale || 'ar';
      useUIStore.getState().setLanguage(finalLocale);

      const returnUrl = router.query.redirect as string || '/dashboard';
      await router.push(returnUrl, returnUrl, { locale: finalLocale });
      
    } catch (error: unknown) {
      captureError(error, 'Demo login error', { level: 'warning', tags: { context: 'demo' } });
      toast.error(t('demoError'));
    } finally {
      setIsLoading(false);
    }
  }, [router, t, locale, setAuth]);

  return {
    isEnabled,
    isLoading,
    login,
  };
}

/**
 * Check if current user is in demo mode
 */
export function useIsDemoUser(): boolean {
  const user = useAuthStore((state) => state.user);
  return user?.facebookId?.startsWith('demo_') ?? false;
}
