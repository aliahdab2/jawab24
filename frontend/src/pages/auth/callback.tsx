import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuthStore, useUIStore, type Language } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { FB_CALLBACK_PATH } from '@/constants/auth';
import { AppSkeleton } from '@/components/ui';
import { captureError } from '@/lib/sentryHelpers';
import { getLocalePath } from '@/utils/locale';

export default function AuthCallback() {
  const router = useRouter();
  const { setAuth, setWorkspaces } = useAuthStore();
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const [error, setError] = useState<string | null>(null);
  const authAttemptedRef = useRef(false);

  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;

  // Memoize callbacks to ensure stable references
  const setAuthRef = useRef(setAuth);
  setAuthRef.current = setAuth;
  const setWorkspacesRef = useRef(setWorkspaces);
  setWorkspacesRef.current = setWorkspaces;

  const handleCallback = useCallback(async (abortSignal: AbortSignal) => {
    // Prevent multiple auth attempts
    if (authAttemptedRef.current) return;

    const { code, error: fbError, state } = routerRef.current.query;

    // Parse state: format is "returnUrl|platform|locale[|reconnect]"
    // e.g. "/dashboard|mobile|ar" or "/pages|web|ar|reconnect"
    const stateStr = state ? decodeURIComponent(state as string) : '/dashboard|web|ar';
    const parts = stateStr.split('|');
    const returnUrlRaw = parts[0] || '/dashboard';
    const platform = parts.length > 1 ? parts[1] : 'web';
    const preferredLocale = parts.length > 2 ? parts[2] : 'ar';
    const isReconnect = parts[3] === 'reconnect';
    const safeUrl = returnUrlRaw.startsWith('/') ? returnUrlRaw : '/dashboard';
    
    if (fbError) {
      authAttemptedRef.current = true;
      setError(t('loginCancelled'));
      setTimeout(() => routerRef.current.push('/login'), 3000);
      return;
    }

    if (!code || typeof code !== 'string') {
      // Wait for query params to be available
      return;
    }

    // Mark as attempted before making the API call
    authAttemptedRef.current = true;

    try {
      // Exchange code for token via our backend with timeout
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

      // Create a timeout promise (15 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(t('loginTimeout'))), 15000);
      });

      // Determine appropriate origin based on platform
      // INDUSTRY STANDARD: Force Canonical Origin from environment variables
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';
      const canonicalOrigin = siteUrl.replace(/\/+$/, ''); // Strip all trailing slashes
      
      // For mobile: ALWAYS use the canonical production origin
      // For web: Still use canonical for production, fallback to window.location.origin only for dev
      const origin = platform === 'mobile' ? canonicalOrigin : (window.location.hostname === 'localhost' ? window.location.origin.replace(/\/+$/, '') : canonicalOrigin);

      // Ensure redirectUri matches initial request exactly using shared constant
      // INDUSTRY STANDARD: Use locale-specific callback URL (matches what Facebook received)
      const localePath = getLocalePath(preferredLocale);
      const redirectUriClean = `${origin}${localePath}${FB_CALLBACK_PATH}`;
      const redirectUri = redirectUriClean;

      // Race between fetch and timeout
      const response = await Promise.race([
        fetch(`${apiUrl}/auth/facebook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirectUri
          }),
          signal: abortSignal,
        }),
        timeoutPromise
      ]);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || t('loginError'));
      }

      const data = await response.json();

      // Store auth data including FB token and workspace context
      setAuthRef.current(data.user, data.token, data.fbAccessToken);
      if (data.workspaces?.length) {
        setWorkspacesRef.current(data.workspaces);
      }

      // Apply language setting if available
      // Priority: 1. User Profile Settings, 2. Preferred Locale from State, 3. Default
      const finalLocale = data.settings?.dashboardLanguage || preferredLocale || 'ar';
      useUIStore.getState().setLanguage(finalLocale as Language);

      // Reconnect flow: sync pages with the fresh token then redirect back to pages
      if (isReconnect && data.fbAccessToken) {
        try {
          await fetch(`${apiUrl}/pages/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.token}`,
            },
            body: JSON.stringify({ accessToken: data.fbAccessToken }),
            signal: abortSignal,
          });
        } catch {
          // Non-fatal — pages will still show, user can manually sync
        }

        if (platform === 'mobile') {
          const tokenStr = encodeURIComponent(data.token);
          const fbTokenStr = encodeURIComponent(data.fbAccessToken);
          const userStr = encodeURIComponent(JSON.stringify(data.user));
          window.location.href = `com.jawab24.app://auth/sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${encodeURIComponent('/pages')}&user=${userStr}`;
          return;
        }

        routerRef.current.replace('/pages', '/pages', { locale: finalLocale });
        return;
      }

      // Check if e-commerce onboarding is needed (install-first flow)
      if (data.shopifyOnboarding) {
        routerRef.current.replace('/shopify/onboarding', '/shopify/onboarding', { locale: finalLocale });
        return;
      }
      if (data.sallaOnboarding) {
        routerRef.current.replace('/salla/onboarding', '/salla/onboarding', { locale: finalLocale });
        return;
      }

      // Check if user has email - if not, redirect to complete profile
      if (!data.user.email) {
        const profileUrl = `/complete-profile?redirect=${encodeURIComponent(safeUrl)}`;
        routerRef.current.replace(profileUrl, profileUrl, { locale: finalLocale });
        return;
      }

      // If request came from mobile app, deep link back to the app.
      // Pass the full user object so the app can hydrate the store instantly
      // without an extra /auth/me network round-trip.
      if (platform === 'mobile') {
        const tokenStr = encodeURIComponent(data.token);
        const fbTokenStr = encodeURIComponent(data.fbAccessToken || '');
        const redirectStr = encodeURIComponent(safeUrl);
        const userStr = encodeURIComponent(JSON.stringify(data.user));

        window.location.href = `com.jawab24.app://auth/sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${redirectStr}&user=${userStr}`;
        return;
      }

      // Web: replace navigation with correct locale (don't keep callback in history)
      routerRef.current.replace(safeUrl, safeUrl, { locale: finalLocale });
    } catch (err) {
      // Don't show error if request was aborted (user navigated away)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      captureError(err, 'Auth callback error', { tags: { page: 'auth-callback' } });
      
      // Provide user-friendly error messages
      let errorMessage = t('loginError');
      if (err instanceof Error) {
        if (err.message === 'Failed to fetch' || err.message.includes('NetworkError')) {
          // Network connectivity issue
          errorMessage = tErrors('networkError');
        } else if (err.message === t('loginTimeout')) {
          // Timeout
          errorMessage = err.message;
        } else if (err.message) {
          // API error message
          errorMessage = err.message;
        }
      }
      
      setError(errorMessage);
      setTimeout(() => routerRef.current.push('/login'), 3000);
    }
  }, [t, tErrors]);

  useEffect(() => {
    if (router.isReady) {
      const abortController = new AbortController();
      handleCallback(abortController.signal);

      // Cleanup: abort request if component unmounts
      return () => {
        abortController.abort();
      };
    }
  }, [router.isReady, handleCallback]);

  if (error) {
    return (
      <>
        <Head><meta name="robots" content="noindex, nofollow" /></Head>
        <div className="flex-1 overflow-y-auto flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"><span className="text-red-500 text-2xl font-bold" aria-hidden="true">&times;</span></div>
          <h1 className="text-xl font-semibold text-foreground mb-2">{t('loginError')}</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
        </div>
      </div>
      </>
    );
  }

  // Show dashboard skeleton while processing - consistent with native app flow
  return (
    <>
      <Head><meta name="robots" content="noindex, nofollow" /></Head>
      <AppSkeleton variant="dashboard" />
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.authCallback]);
