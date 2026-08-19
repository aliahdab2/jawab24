import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { FB_CALLBACK_PATH } from '@/constants/auth';
import { BRAND_ASSETS } from '@/constants/brand';
import { AppSkeleton } from '@/components/ui';
import { captureError, getBackendErrorCode } from '@/lib/sentryHelpers';
import { getLocalePath } from '@/utils/locale';
import { resolveLoginLanguage } from '@/lib/dashboardLanguage';

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

    // Strip OAuth code from URL so a back-nav or reload can't replay an expired/spent code.
    // Replace state silently — no React re-render, no navigation.
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }

    try {
      // Exchange code for token via our backend with timeout
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

      // If the user is already authenticated and this is a reconnect (e.g. phone user
      // connecting Facebook pages), link Facebook to their existing account instead of
      // creating a second user. If the session has since expired, fall through to
      // normal login so the user isn't left stranded on the callback page.
      if (isReconnect && useAuthStore.getState().isAuthenticated) {
        const existingToken = useAuthStore.getState().token;
        const canonicalOrigin = BRAND_ASSETS.urls.base;
        const origin = platform === 'mobile' ? canonicalOrigin : (window.location.hostname === 'localhost' ? window.location.origin.replace(/\/+$/, '') : canonicalOrigin);
        const localePath = getLocalePath(preferredLocale);
        const redirectUri = `${origin}${localePath}${FB_CALLBACK_PATH}`;

        const linkResponse = await fetch(`${apiUrl}/auth/facebook/link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(existingToken ? { 'Authorization': `Bearer ${existingToken}` } : {}),
          },
          body: JSON.stringify({ code, redirectUri }),
          credentials: 'include',
          signal: abortSignal,
        });

        if (linkResponse.ok) {
          const linkData = await linkResponse.json();
          setAuthRef.current(linkData.user, linkData.token, linkData.fbAccessToken);
          if (linkData.workspaces?.length) setWorkspacesRef.current(linkData.workspaces, { defaultWorkspaceId: linkData.defaultWorkspaceId ?? null });

          if (platform === 'mobile') {
            const tokenStr = encodeURIComponent(linkData.token);
            const fbTokenStr = encodeURIComponent(linkData.fbAccessToken || '');
            const userStr = encodeURIComponent(JSON.stringify(linkData.user));
            // App Link: Android verifies jawab24.com ownership via assetlinks.json and opens
            // the native app directly, closing Chrome in the process (proper fix, not a workaround)
            window.location.href = `https://jawab24.com/auth/app-sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${encodeURIComponent('/pages')}&user=${userStr}`;
            return;
          }

          routerRef.current.replace('/pages', '/pages', { locale: preferredLocale });
          return;
        }

        const errData = await linkResponse.json().catch(() => ({}));
        // Session expired between reconnect-OAuth start and callback. Industry standard
        // (RFC 6749 + OpenID Connect Account Linking): re-authenticate with intent
        // preserved. Do NOT fall through to /auth/facebook — that would create a new
        // FB-only account orphaned from the user's existing phone account.
        if (linkResponse.status === 401 && (errData.code === 'AUTH_FAILED' || errData.code === 'INVALID_TOKEN')) {
          authAttemptedRef.current = true;
          setError(t('sessionExpiredReconnect'));
          setTimeout(() => routerRef.current.push({ pathname: '/login', query: { reconnect: 'facebook', redirect: '/pages' } }), 3000);
          return;
        }

        const err = new Error(errData.message || t('loginError')) as Error & { backendCode?: string };
        err.backendCode = errData.code;
        throw err;
      }

      // Create a timeout promise (15 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(Object.assign(new Error(t('loginTimeout')), { isLoginTimeout: true })), 15000);
      });

      // Determine appropriate origin based on platform
      // INDUSTRY STANDARD: Force Canonical Origin from environment variables
      const canonicalOrigin = BRAND_ASSETS.urls.base;
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
        const err = new Error(data.message || t('loginError')) as Error & { backendCode?: string };
        err.backendCode = data.code;
        throw err;
      }

      const data = await response.json();

      // Store auth data including FB token and workspace context.
      // Pass the server-resolved defaultWorkspaceId so the store can override
      // any stale persisted activeWorkspaceId (this is the heart of the
      // last-active fix — Noor's old device-side state can't outvote the server).
      setAuthRef.current(data.user, data.token, data.fbAccessToken);
      if (data.workspaces?.length) {
        setWorkspacesRef.current(data.workspaces, { defaultWorkspaceId: data.defaultWorkspaceId ?? null });
      }

      // Apply language setting if available — account language first, then the
      // locale the merchant signed in from. Shared with the phone-OTP login so
      // the two sign-in paths cannot drift apart.
      const finalLocale = resolveLoginLanguage(data.settings?.dashboardLanguage, preferredLocale);
      useUIStore.getState().setLanguage(finalLocale);

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
          // App Link: Android verifies jawab24.com ownership via assetlinks.json and opens
          // the native app directly, closing Chrome in the process (proper fix, not a workaround)
          window.location.href = `https://jawab24.com/auth/app-sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${encodeURIComponent('/pages')}&user=${userStr}`;
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
      if (data.zidOnboarding) {
        routerRef.current.replace('/zid/onboarding', '/zid/onboarding', { locale: finalLocale });
        return;
      }

      // Phone collection is intentionally NOT forced during onboarding. Phone/OTP
      // verification (Vonage SMS today, WhatsApp Cloud API next) can't deliver to
      // sanctions-blocked regions like Syria, so making it mandatory walled out
      // whole segments. Phone remains an optional, opt-in feature — never a gate.

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

        // App Link: Android verifies jawab24.com ownership via assetlinks.json and opens
        // the native app directly, closing Chrome in the process (proper fix, not a workaround)
        window.location.href = `https://jawab24.com/auth/app-sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${redirectStr}&user=${userStr}`;
        return;
      }

      // Web: replace navigation with correct locale (don't keep callback in history)
      routerRef.current.replace(safeUrl, safeUrl, { locale: finalLocale });
    } catch (err) {
      // Aborted — user navigated away, silently ignore
      if (err instanceof Error && err.name === 'AbortError') return;

      const isNetworkError = err instanceof Error && (
        err.message.includes('Failed to fetch') || // Chrome
        err.message.includes('NetworkError')       // Firefox
      );
      const isTimeout = err instanceof Error && (err as Error & { isLoginTimeout?: boolean }).isLoginTimeout === true;
      const backendCode = getBackendErrorCode(err);
      const isAuthExpired = backendCode === 'INVALID_TOKEN' || backendCode === 'AUTH_FAILED';
      // Facebook returned an OAuth error (expired/replayed code, invalid token) — user-actionable, not a bug
      const isFbOauthFailed = backendCode === 'FACEBOOK_OAUTH_FAILED';
      // Backend rate limiter said no — show a translated message, not the raw English body
      const isRateLimited = backendCode === 'RATE_LIMIT_EXCEEDED';
      // Demo sessions can't link Facebook (would hijack the shared demo account) — user-actionable
      const isDemoLinkForbidden = backendCode === 'DEMO_LINK_FORBIDDEN';

      // Network blips, timeouts, expired/invalid sessions, FB OAuth errors, and demo-link refusals are not actionable — skip Sentry to avoid noise
      if (!isNetworkError && !isTimeout && !isAuthExpired && !isFbOauthFailed && !isDemoLinkForbidden) {
        captureError(err, 'Auth callback error', { tags: { page: 'auth-callback' } });
      }

      let errorMessage = t('loginError');
      if (isNetworkError) {
        errorMessage = tErrors('networkError');
      } else if (isRateLimited) {
        errorMessage = tErrors('tooManyRequests');
      } else if (isDemoLinkForbidden) {
        errorMessage = t('demoLinkForbidden');
      } else if (isTimeout) {
        errorMessage = err instanceof Error ? err.message : t('loginTimeout');
      } else if (err instanceof Error && err.message) {
        errorMessage = err.message;
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
