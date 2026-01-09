import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore, useUIStore } from '@/lib/store';
import { PageSpinner } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { FB_CALLBACK_PATH } from '@/constants/auth';

export default function AuthCallback() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const authAttemptedRef = useRef(false);

  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;

  // Memoize setAuth to ensure stable reference
  const setAuthRef = useRef(setAuth);
  setAuthRef.current = setAuth;

  const handleCallback = useCallback(async (abortSignal: AbortSignal) => {
    // Prevent multiple auth attempts
    if (authAttemptedRef.current) return;

    const { code, error: fbError, state } = routerRef.current.query;

    // Parse state: format is "returnUrl|platform" (e.g., "/dashboard|mobile")
    // or legacy "returnUrl"
    const stateStr = state ? decodeURIComponent(state as string) : '/dashboard|web';
    const parts = stateStr.split('|');
    const returnUrlRaw = parts[0] || '/dashboard';
    const platform = parts.length > 1 ? parts[1] : 'web';
    const safeUrl = returnUrlRaw.startsWith('/') ? returnUrlRaw : '/dashboard';

    if (fbError) {
      authAttemptedRef.current = true;
      setError(t('auth.loginCancelled'));
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
        setTimeout(() => reject(new Error(t('auth.loginTimeout'))), 15000);
      });

      // Determine appropriate origin based on platform
      // INDUSTRY STANDARD: Force Canonical Origin from environment variables
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';
      const canonicalOrigin = siteUrl.replace(/\/+$/, ''); // Strip all trailing slashes
      
      // For mobile: ALWAYS use the canonical production origin
      // For web: Still use canonical for production, fallback to window.location.origin only for dev
      const origin = platform === 'mobile' ? canonicalOrigin : (window.location.hostname === 'localhost' ? window.location.origin.replace(/\/+$/, '') : canonicalOrigin);

      // Ensure redirectUri matches initial request exactly using shared constant
      // Next.js i18n handles locales via path prefixes (/en or default /)
      // Fallback: Check pathname if router locale isn't ready
      const currentPath = window.location.pathname;
      const detectedLocalePath = currentPath.startsWith('/en/') ? '/en' : '';
      const localePath = routerRef.current.locale ? (routerRef.current.locale === 'ar' ? '' : `/${routerRef.current.locale}`) : detectedLocalePath;
      
      const redirectUriClean = `${origin}${localePath}${FB_CALLBACK_PATH}`;
      const redirectUri = redirectUriClean;

      // Verification log with granular parts for debugging
      // eslint-disable-next-line no-console
      console.log(`[Auth] Exchange Debug:`, {
        origin,
        localePath,
        callbackPath: FB_CALLBACK_PATH,
        fullRedirectUri: redirectUri
      });
      
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
        throw new Error(data.message || t('auth.loginError'));
      }

      const data = await response.json();

      // Store auth data including FB token
      setAuthRef.current(data.user, data.token, data.fbAccessToken);

      // Apply language setting if available
      if (data.settings?.dashboardLanguage) {
        useUIStore.getState().setLanguage(data.settings.dashboardLanguage);
      }

      // Check if user has email - if not, redirect to complete profile
      if (!data.user.email) {
        routerRef.current.push(`/complete-profile?redirect=${encodeURIComponent(safeUrl)}`);
        return;
      }
      
      // If request came from mobile app, redirect using custom URL scheme
      // This will open the app directly instead of staying in the browser
      // If request came from mobile app, redirect using custom URL scheme with Auth Bridge
      // This handles cases where Callback runs in Browser (App Link failed) 
      // by passing the session to the App via Deep Link.
      if (platform === 'mobile') {
        const cap = (window as any).Capacitor;
        const isNative = typeof window !== 'undefined' && !!cap?.isNativePlatform?.();
        
        if (isNative) {
          routerRef.current.push(safeUrl);
          return;
        }

        const userStr = encodeURIComponent(JSON.stringify(data.user));
        const tokenStr = encodeURIComponent(data.token);
        const fbTokenStr = encodeURIComponent(data.fbAccessToken || '');
        const redirectStr = encodeURIComponent(safeUrl);
        
        alert(`Cloud: In Browser. Sending to App...`);
        window.location.href = `com.jawab24.app://auth/sync?token=${tokenStr}&user=${userStr}&fbToken=${fbTokenStr}&redirect=${redirectStr}`;
        return;
      }
      
      // Web: standard navigation
      routerRef.current.push(safeUrl);
    } catch (err) {
      // Don't show error if request was aborted (user navigated away)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Auth error:', err);
      // Use translation for generic error if custom message isn't set, mainly attempting fallback
      setError(err instanceof Error ? err.message : t('auth.loginError'));
      setTimeout(() => routerRef.current.push('/login'), 3000);
    }
  }, [t]);

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
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">❌</div>
          <h1 className="text-xl font-semibold text-surface-900 mb-2">{t('auth.loginError')}</h1>
          <p className="text-surface-500 mb-4">{error}</p>
          <p className="text-sm text-surface-400">{t('auth.redirecting')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="text-center">
        <PageSpinner />
        <p className="mt-4 text-surface-500">{t('auth.loggingIn')}</p>
      </div>
    </div>
  );
}
