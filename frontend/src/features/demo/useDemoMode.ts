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
import { useAuthStore, useUIStore, type Language } from '@/lib/store';
import { useTranslations, useLocale } from 'next-intl';
import { captureError } from '@/lib/sentryHelpers';

export function useDemoMode() {
  const router = useRouter();
  const t = useTranslations('auth');
  const locale = useLocale();
  const setAuth = useAuthStore((state) => state.setAuth);
  const setWorkspaces = useAuthStore((state) => state.setWorkspaces);

  const [isEnabled, setIsEnabled] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Check if demo mode is enabled on mount. Guard the post-await state updates
  // with a mounted flag: if the component unmounts before the request resolves
  // (route change, or jsdom teardown in tests), setState-after-unmount throws an
  // unhandled rejection (e.g. "window is not defined" once the test env is gone).
  useEffect(() => {
    let mounted = true;
    const checkDemoStatus = async () => {
      try {
        const response = await publicApi.get('/auth/demo/status');
        if (mounted) setIsEnabled(response.data?.enabled === true);
      } catch {
        if (mounted) setIsEnabled(false);
      } finally {
        if (mounted) setIsChecking(false);
      }
    };
    checkDemoStatus();
    return () => { mounted = false; };
  }, []);

  // Handle demo login
  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await publicApi.post('/auth/demo', { locale });
      const { user, token, workspaces, settings } = response.data;

      setAuth(user, token, 'demo_token');
      if (workspaces?.length) {
        setWorkspaces(workspaces);
      }

      // Match real login: prefer user's dashboardLanguage, fall back to browsing locale
      const finalLocale = (settings?.dashboardLanguage || locale) as Language;
      useUIStore.getState().setLanguage(finalLocale);

      const returnUrl = router.query.redirect as string || '/dashboard';
      await router.push(returnUrl, returnUrl, { locale: finalLocale });

    } catch (error: unknown) {
      captureError(error, 'Demo login error', { level: 'warning', tags: { context: 'demo' } });
      toast.error(t('demoError'));
    } finally {
      setIsLoading(false);
    }
  }, [router, t, locale, setAuth, setWorkspaces]);

  return {
    isEnabled,
    isChecking,
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
