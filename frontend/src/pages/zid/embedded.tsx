import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import axios from 'axios';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { setEmbeddedSession } from '@/lib/embeddedSession';
import { captureError } from '@/lib/sentryHelpers';
import type { Page, WorkspaceSummary } from '@jawab24/shared';

type Status = 'loading' | 'error';

/**
 * Zid Embedded Apps entry — the app's Application URL, framed by the Zid
 * Merchant Dashboard (docs.zid.sa/embedded-apps).
 *
 * Zid loads this page with `?token=<uuid>&language=<ar|en>`. The UUID is the
 * credential: it is traded at `POST /zid/embedded/session` for a normal
 * short-lived, WORKSPACE-SCOPED access token, which the embedded surface then
 * sends as a Bearer header (third-party-frame cookies never arrive — see
 * lib/embeddedSession.ts).
 *
 * The credential is stripped from the URL the instant it is read: it rides the
 * iframe src, so it would otherwise sit in browser history and any error report.
 *
 * Nothing here asks the merchant to sign in. A failure shows how to reopen the
 * app from the Zid dashboard; it must never render a login form, which is the
 * exact defect that got app 7367 rejected on 2026-08-10.
 */
export default function ZidEmbedded() {
  const router = useRouter();
  const t = useTranslations('zid');
  const { setAuth, setWorkspaces } = useAuthStore();
  const [status, setStatus] = useState<Status>('loading');

  const establishSession = useCallback(async (embeddedToken: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

    const sessionRes = await axios.post<{
      accessToken: string;
      workspaceId: string;
    }>(`${apiUrl}/zid/embedded/session`, { embeddedToken });

    const { accessToken, workspaceId } = sessionRes.data;
    if (!accessToken) throw new Error('Embedded session response has no token');

    // Persist BEFORE any further call — the api client reads the Bearer token
    // from here, and the requests below are the first that need it.
    setEmbeddedSession('zid', embeddedToken, accessToken);

    const authHeader = { headers: { Authorization: `Bearer ${accessToken}` } };

    // /auth/me, /workspaces and /pages are independent — fetch them together so
    // the frame is not blocked on sequential round trips before first paint.
    // The session is pinned to one workspace, so /workspaces is best-effort; so
    // is /pages, which only decides where to land (see `onboardingDone`).
    const [userRes, wsRes, pagesRes] = await Promise.all([
      axios.get(`${apiUrl}/auth/me`, authHeader),
      axios.get<WorkspaceSummary[]>(`${apiUrl}/workspaces`, authHeader).catch(() => null),
      axios.get<Page[]>(`${apiUrl}/pages`, authHeader).catch(() => null),
    ]);

    const user = userRes.data;
    if (!user?.id) throw new Error('Failed to fetch user profile');

    if (wsRes?.data?.length) setWorkspaces(wsRes.data, { defaultWorkspaceId: workspaceId });

    setAuth(user, accessToken, '');

    // The onboarding wizard's last step is linking a page to the store
    // (`pages.ecommerceStoreId`). Once any page carries that link the merchant
    // has finished it, and every later open must land in the app — until
    // 2026-08-23 this entry sent a fully connected store back to «let's connect
    // your Zid store» on EVERY open. A failed /pages read falls back to the
    // wizard: showing it once too often is recoverable, hiding it is not.
    const onboardingDone = (pagesRes?.data ?? []).some((p) => Boolean(p.ecommerceStoreId));
    return { user, onboardingDone };
  }, [setAuth, setWorkspaces]);

  useEffect(() => {
    if (!router.isReady) return;

    const { token, expired, language } = router.query;

    // Zid tells us the merchant's dashboard language; honour it so the app is
    // not pinned to the default locale inside the frame.
    const locale = language === 'en' || language === 'ar' ? language : undefined;

    // Arrived from an embedded logout (session ended, credential cleared) —
    // there is nothing to exchange, so explain rather than spin.
    if (expired) {
      setStatus('error');
      return;
    }

    if (typeof token !== 'string' || !token) {
      setStatus('error');
      return;
    }

    // Strip the credential from the URL before anything can log or store it —
    // it rides the iframe src, so a back-nav, a reload, or an error report must
    // not carry a live merchant credential. Silent (no re-render, no nav),
    // exactly like auth/callback.tsx does for the OAuth code.
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }

    establishSession(token)
      .then(({ onboardingDone }) => {
        // The merchant is authenticated and inside the Zid dashboard iframe.
        // First open: the wizard (store → product sync → link a page). Every
        // open after the page is linked: straight into the app. The wizard
        // itself has no notion of "already done" — this entry is the only
        // place that decides, so the decision must be made here.
        const destination = onboardingDone ? '/dashboard' : '/zid/onboarding';
        router.replace(destination, undefined, locale ? { locale } : undefined);
      })
      .catch((err) => {
        captureError(err, 'Zid embedded session failed', { tags: { page: 'zid-embedded' } });
        setStatus('error');
      });
  }, [router.isReady, router.query, router, establishSession]);

  return (
    <>
      <Head>
        <title>{t('embedded.title')}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="flex-1 overflow-y-auto flex items-center justify-center bg-background p-6">
        {status === 'loading' ? (
          <div className="text-center" aria-busy="true" aria-live="polite">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-brand-600" aria-hidden="true" />
            <p className="text-muted-foreground text-sm font-medium">{t('embedded.loading')}</p>
          </div>
        ) : (
          <div className="text-center max-w-md" role="alert">
            <AlertCircle className="w-8 h-8 mx-auto mb-3 text-icon-muted" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-foreground mb-2">{t('embedded.errorTitle')}</h1>
            <p className="text-muted-foreground text-sm">{t('embedded.errorBody')}</p>
          </div>
        )}
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.zidEmbedded]);
