import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import { useAuthStore, useUIStore } from '@/lib/store';
import axios from 'axios';
import { captureError } from '@/lib/sentryHelpers';
import { clearEmbeddedSession } from '@/lib/embeddedSession';
import { isSafeRedirectPath, type WorkspaceSummary } from '@jawab24/shared';

export default function AuthSync() {
  const router = useRouter();
  const { setAuth, setWorkspaces } = useAuthStore();
  const t = useTranslations('auth');
  const [status, setStatus] = useState(() => t('syncInitializing'));

  useEffect(() => {
    if (!router.isReady) return;

    const syncAuth = async () => {
      // This page only ever runs top-level and first-party, so an embedded
      // (platform-frame) marker here can only be a clone: browsers without
      // storage partitioning copy sessionStorage into a tab opened by
      // window.open — exactly how the embedded break-out opens this tab. Left in
      // place it would make the API client prefer the frame's Bearer token over
      // the session minted below, and make /pages believe it is still framed.
      clearEmbeddedSession();
      try {
        setStatus(t('syncSyncing'));

        // 1. Get credentials from URL — two shapes:
        //    - token=…  (mobile-login deep link): a ready session token; backend
        //      appends defaultWorkspaceId so the active workspace is correct
        //      before the dashboard loads, even on cold-launch installs.
        //    - code=…   (app→browser handoff, e.g. WhatsApp connect): an opaque
        //      single-use 60s code. Only the code rides the URL — it is traded
        //      below for a real login (token + refresh cookie), so the session
        //      outlives long flows like Meta's wizard.
        const { token, code, fbToken, redirect, defaultWorkspaceId } = router.query;
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

        let sessionToken = typeof token === 'string' ? token : '';
        let workspaceHint = typeof defaultWorkspaceId === 'string' ? defaultWorkspaceId : null;
        if (!sessionToken && typeof code === 'string') {
          const exchangeRes = await axios.post<{ token: string; defaultWorkspaceId: string | null }>(
            `${apiUrl}/auth/browser-handoff/exchange`,
            { code },
            { withCredentials: true },
          );
          sessionToken = exchangeRes.data.token;
          workspaceHint = exchangeRes.data.defaultWorkspaceId ?? workspaceHint;
        }

        if (!sessionToken) {
            throw new Error('No token provided');
        }

        // 2. Fetch fresh user profile using the token
        setStatus(t('syncVerifying'));

        const userRes = await axios.get(`${apiUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${sessionToken}` }
        });

        const user = userRes.data;

        if (!user || !user.id) {
          throw new Error('Failed to fetch user profile');
        }

        // 3. Fetch workspaces so activeWorkspaceId is set before dashboard loads.
        //    Required for native: sync.tsx runs in the app WebView which doesn't share
        //    state with the system browser where callback.tsx ran setWorkspaces.
        try {
          const wsRes = await axios.get<WorkspaceSummary[]>(`${apiUrl}/workspaces`, {
            headers: { Authorization: `Bearer ${sessionToken}` }
          });
          if (wsRes.data?.length) setWorkspaces(wsRes.data, {
            defaultWorkspaceId: workspaceHint,
          });
        } catch {
          // Non-fatal — workspace middleware will auto-select if user has exactly 1 workspace
        }

        // 4. Hydrate the store
        setAuth(user, sessionToken, fbToken as string || '');

        // 5. The surface that opened this tab knew the merchant's language and
        //    put it in the URL (the Zid frame's locale, the app's locale). Adopt
        //    it into the persisted UI store too: `_app.tsx` re-routes the next
        //    page to the STORED language, which in a fresh browser is whatever it
        //    last persisted first-party — an Arabic merchant breaking out of the
        //    Zid frame landed on /en/pages (2026-08-30).
        const urlLocale = router.locale === 'ar' || router.locale === 'en' ? router.locale : undefined;
        if (urlLocale) useUIStore.getState().setLanguage(urlLocale);

        setStatus(t('syncRedirecting'));

        // Brief delay to ensure storage persistence
        setTimeout(() => {
            // redirect from query is already URL-decoded by Next.js router.
            // isSafeRedirectPath rejects protocol-relative "//evil.com" that a bare
            // startsWith('/') check would accept (open redirect).
            const redirectPath = isSafeRedirectPath(redirect) ? redirect : '/dashboard';
            if (urlLocale) {
                router.replace(redirectPath, undefined, { locale: urlLocale });
            } else {
                router.replace(redirectPath);
            }
        }, 100);

      } catch (err) {
        captureError(err, 'Auth sync error', { tags: { page: 'auth-sync' } });
        setStatus(t('syncFailed'));
        // Give user a chance to read the error before redirecting
        setTimeout(() => router.replace('/login'), 2500);
      }
    };

    syncAuth();
  }, [router.isReady, router.query, setAuth, setWorkspaces, router, t]);

  return (
    <>
      <Head><meta name="robots" content="noindex, nofollow" /></Head>
      <div className="flex-1 overflow-y-auto flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground text-sm font-medium">{status}</p>
        </div>
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.authSync]);
