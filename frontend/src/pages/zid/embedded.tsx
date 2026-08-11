import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import axios from 'axios';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { setEmbeddedSession } from '@/lib/embeddedSession';
import { captureError } from '@/lib/sentryHelpers';
import type { WorkspaceSummary } from '@jawab24/shared';

type Status = 'loading' | 'error';

/**
 * Zid Embedded Apps entry — the app's Application URL, framed by the Zid
 * Merchant Dashboard (docs.zid.sa/embedded-apps).
 *
 * Zid loads this page with `?token=<uuid>&language=<ar|en>`. The UUID is the
 * credential: it is traded at `POST /zid/embedded/session` for a normal
 * short-lived access token, which the embedded surface then sends as a Bearer
 * header (third-party-frame cookies never arrive — see lib/embeddedSession.ts).
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
      token: string;
      defaultWorkspaceId: string | null;
    }>(`${apiUrl}/zid/embedded/session`, { token: embeddedToken });

    const { token, defaultWorkspaceId } = sessionRes.data;
    if (!token) throw new Error('Embedded session response has no token');

    // Persist BEFORE any further call — the api client reads the Bearer token
    // from here, and /auth/me below is the first request that needs it.
    setEmbeddedSession('zid', embeddedToken, token);

    const userRes = await axios.get(`${apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user = userRes.data;
    if (!user?.id) throw new Error('Failed to fetch user profile');

    try {
      const wsRes = await axios.get<WorkspaceSummary[]>(`${apiUrl}/workspaces`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (wsRes.data?.length) setWorkspaces(wsRes.data, { defaultWorkspaceId });
    } catch {
      // Non-fatal — workspace middleware auto-selects when the user has one.
    }

    setAuth(user, token, '');
    return user;
  }, [setAuth, setWorkspaces]);

  useEffect(() => {
    if (!router.isReady) return;

    const { token, expired } = router.query;

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

    establishSession(token)
      .then(() => {
        // Straight into the app. The merchant is authenticated and inside the
        // Zid dashboard iframe; onboarding self-skips once a page is linked.
        router.replace('/zid/onboarding');
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
