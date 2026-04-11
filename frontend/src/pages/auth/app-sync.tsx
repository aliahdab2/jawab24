import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { AppSkeleton } from '@/components/ui';
import { captureError } from '@/lib/sentryHelpers';

/**
 * Fallback page for Android App Links.
 *
 * Normally, Android intercepts https://jawab24.com/auth/app-sync and opens the native
 * app directly (via App Links), so this page is never rendered. It only loads in Chrome
 * when App Links verification hasn't completed yet (e.g. fresh install before first
 * background verification). In that case we forward via the custom scheme.
 */
export default function AuthAppSync() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    const { token, fbToken, redirect, user } = router.query;

    if (!token || typeof token !== 'string') {
      captureError(new Error('app-sync fallback: no token'), 'App-sync fallback reached without token', { tags: { page: 'auth-app-sync' } });
      router.replace('/login');
      return;
    }

    // Forward to native app via custom scheme — last resort when App Links didn't fire
    const redirectStr = encodeURIComponent((redirect && typeof redirect === 'string' && redirect.startsWith('/')) ? redirect : '/dashboard');
    const tokenStr = encodeURIComponent(token);
    const fbTokenStr = encodeURIComponent((fbToken as string) || '');
    const userStr = user && typeof user === 'string' ? user : '';

    window.location.href = `com.jawab24.app://auth/sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${redirectStr}&user=${encodeURIComponent(userStr)}`;
  }, [router.isReady, router.query, router]);

  return (
    <>
      <Head><meta name="robots" content="noindex, nofollow" /></Head>
      <AppSkeleton variant="dashboard" />
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.authSync]);
