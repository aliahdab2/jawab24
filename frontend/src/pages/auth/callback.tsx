import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import { PageSpinner } from '@/components/ui';
import { useTranslation } from '@/i18n';

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

      // Race between fetch and timeout
      const response = await Promise.race([
        fetch(`${apiUrl}/auth/facebook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirectUri: `${window.location.origin}${window.location.pathname}`
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

      // Check if user has email - if not, redirect to complete profile
      if (!data.user.email) {
        // Store the intended destination in query param
        const returnUrl = state ? decodeURIComponent(state as string) : '/dashboard';
        const safeUrl = returnUrl.startsWith('/') ? returnUrl : '/dashboard';
        routerRef.current.push(`/complete-profile?redirect=${encodeURIComponent(safeUrl)}`);
        return;
      }

      // Redirect to the original destination (from state param) or dashboard
      const returnUrl = state ? decodeURIComponent(state as string) : '/dashboard';
      // Validate the URL is a relative path (security)
      const safeUrl = returnUrl.startsWith('/') ? returnUrl : '/dashboard';
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
