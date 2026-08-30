import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import axios from 'axios';
import { Loader2, AlertCircle, CheckCircle2, Store, MessageCircle, ExternalLink } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { setEmbeddedSession, getEmbeddedCredential } from '@/lib/embeddedSession';
import { openTopLevelAuthenticated } from '@/lib/embeddedBreakout';
import { getMarketplaceBilling, openMarketplaceManageUrl } from '@/lib/marketplaceBilling';
import { captureError } from '@/lib/sentryHelpers';
import { Button, Badge } from '@/components/ui';
import { isAnyChannelReplying } from '@jawab24/shared';
import type { Page, WorkspaceSummary, EcommerceStore, UsageSummary } from '@jawab24/shared';

type Status = 'loading' | 'error' | 'ready';

/**
 * Zid Embedded Apps entry — the app's Application URL, framed by the Zid
 * Merchant Dashboard (docs.zid.sa/embedded-apps).
 *
 * Zid loads this page with `?token=<uuid>&language=<ar|en>`. The UUID is the
 * credential: it is traded at `POST /zid/embedded/session` for a short-lived,
 * WORKSPACE-SCOPED access token (third-party-frame cookies never arrive — see
 * lib/embeddedSession.ts). The credential is stripped from the URL the instant
 * it is read: it rides the iframe src, so it would otherwise sit in browser
 * history and any error report.
 *
 * D-119: this frame is a LAUNCHPAD, not the app. It renders a read-only status
 * card (store synced, linked page, reply state) and opens the real product —
 * jawab24.com — as an authenticated top-level tab via the browser-handoff.
 * Running the full dashboard inside the iframe was retired: every framed
 * session bug (SameSite cookies, SSE re-minting, wizard state resets) came
 * from it, and the flow that matters most — connecting a Facebook page —
 * must leave the frame anyway (facebook.com refuses to be framed).
 *
 * Nothing here asks the merchant to sign in. A failure shows how to reopen the
 * app from the Zid dashboard; it must never render a login form, which is the
 * exact defect that got app 7367 rejected on 2026-08-10.
 */
export default function ZidEmbedded() {
  const router = useRouter();
  const t = useTranslations('zid');
  const activeLocale = useLocale();
  const { setAuth, setWorkspaces } = useAuthStore();
  const [status, setStatus] = useState<Status>('loading');
  const [store, setStore] = useState<EcommerceStore | null>(null);
  const [linkedPage, setLinkedPage] = useState<Page | null>(null);
  const [manageUrl, setManageUrl] = useState<string | undefined>(undefined);
  // The Bearer for card refreshes; state would re-run effects for no reason.
  const accessTokenRef = useRef<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const readCard = useCallback(async () => {
    const accessToken = accessTokenRef.current;
    if (!accessToken) return;
    const authHeader = { headers: { Authorization: `Bearer ${accessToken}` } };
    // Both reads are best-effort: the card degrades to the CTA alone rather
    // than blocking the frame on a transient failure.
    const [pagesRes, storeRes] = await Promise.all([
      axios.get<Page[]>(`${apiUrl}/pages`, authHeader).catch(() => null),
      axios.get<EcommerceStore | null>(`${apiUrl}/zid/store`, authHeader).catch(() => null),
    ]);
    if (pagesRes) {
      const list = pagesRes.data ?? [];
      setLinkedPage(list.find((p) => Boolean(p.ecommerceStoreId)) ?? list[0] ?? null);
    }
    if (storeRes) setStore(storeRes.data ?? null);
  }, [apiUrl]);

  const establishSession = useCallback(async (embeddedToken: string) => {
    const sessionRes = await axios.post<{
      accessToken: string;
      workspaceId: string;
    }>(`${apiUrl}/zid/embedded/session`, { embeddedToken });

    const { accessToken, workspaceId } = sessionRes.data;
    if (!accessToken) throw new Error('Embedded session response has no token');

    // Persist BEFORE any further call — the api client reads the Bearer token
    // from here, and the requests below are the first that need it.
    setEmbeddedSession('zid', embeddedToken, accessToken);
    accessTokenRef.current = accessToken;

    const authHeader = { headers: { Authorization: `Bearer ${accessToken}` } };

    // /auth/me is the only required read; everything else shapes the card and
    // is best-effort — the launchpad must open even when a read hiccups.
    const [userRes, wsRes, usageRes] = await Promise.all([
      axios.get(`${apiUrl}/auth/me`, authHeader),
      axios.get<WorkspaceSummary[]>(`${apiUrl}/workspaces`, authHeader).catch(() => null),
      axios.get<{ data?: UsageSummary } & UsageSummary>(`${apiUrl}/subscription/usage`, authHeader).catch(() => null),
    ]);

    const user = userRes.data;
    if (!user?.id) throw new Error('Failed to fetch user profile');

    if (wsRes?.data?.length) setWorkspaces(wsRes.data, { defaultWorkspaceId: workspaceId });
    setAuth(user, accessToken, '');

    const usage = (usageRes?.data?.data ?? usageRes?.data ?? null) as UsageSummary | null;
    setManageUrl(getMarketplaceBilling(usage)?.manageUrl);

    await readCard();
  }, [apiUrl, setAuth, setWorkspaces, readCard]);

  useEffect(() => {
    if (!router.isReady) return;

    const { token, expired, language } = router.query;

    // Arrived from an embedded logout (session ended, credential cleared) —
    // there is nothing to exchange, so explain rather than spin.
    if (expired) {
      setStatus('error');
      return;
    }

    // Zid tells us the merchant's dashboard language; honour it. The URL token
    // (when present) is exchanged FIRST so the credential survives in storage,
    // then the locale switch remounts and re-establishes from storage.
    const locale = language === 'en' || language === 'ar' ? language : undefined;

    // The frame can remount with no `?token` — a locale switch below, or Zid
    // re-rendering its iframe mid-visit. The stored credential covers both.
    const urlToken = typeof token === 'string' && token ? token : null;
    const credential = urlToken ?? getEmbeddedCredential();
    if (!credential) {
      setStatus('error');
      return;
    }

    // Strip the credential from the URL before anything can log or store it —
    // it rides the iframe src, so a back-nav, a reload, or an error report must
    // not carry a live merchant credential. Silent (no re-render, no nav),
    // exactly like auth/callback.tsx does for the OAuth code.
    if (urlToken && typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }

    establishSession(credential)
      .then(() => {
        if (locale && locale !== activeLocale) {
          // Remount in Zid's language; the credential is stored, so the second
          // pass re-establishes without a URL token.
          void router.replace(router.pathname, undefined, { locale });
          return;
        }
        setStatus('ready');
      })
      .catch((err) => {
        captureError(err, 'Zid embedded session failed', { tags: { page: 'zid-embedded' } });
        setStatus('error');
      });
  }, [router.isReady, router.query, router, establishSession, activeLocale]);

  // The merchant does the actual work in the top-level tab and comes back to
  // the frame — refresh the card so it reflects what they just did (the page
  // they connected, the toggle they flipped) instead of a stale snapshot.
  useEffect(() => {
    if (status !== 'ready') return;
    const onReturn = () => {
      if (document.visibilityState === 'visible') void readCard();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [status, readCard]);

  const openJawab = useCallback(() => {
    // No page linked yet → land directly on the connect flow; otherwise the
    // dashboard. Called synchronously from the click so the popup keeps the
    // user gesture (openTopLevelAuthenticated opens the tab before awaiting).
    const destination = linkedPage?.ecommerceStoreId ? '/dashboard' : '/pages?connectFacebook=true';
    void openTopLevelAuthenticated(destination, { locale: activeLocale });
  }, [linkedPage, activeLocale]);

  const replying = linkedPage ? isAnyChannelReplying(linkedPage) : false;

  return (
    <>
      <Head>
        <title>{t('embedded.title')}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="flex-1 overflow-y-auto flex items-center justify-center bg-background p-6">
        {status === 'loading' && (
          <div className="text-center" aria-busy="true" aria-live="polite">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-brand-600" aria-hidden="true" />
            <p className="text-muted-foreground text-sm font-medium">{t('embedded.loading')}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center max-w-md" role="alert">
            <AlertCircle className="w-8 h-8 mx-auto mb-3 text-icon-muted" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-foreground mb-2">{t('embedded.errorTitle')}</h1>
            <p className="text-muted-foreground text-sm">{t('embedded.errorBody')}</p>
          </div>
        )}

        {status === 'ready' && (
          <div className="w-full max-w-lg">
            <div className="text-center mb-6">
              <h1 className="text-xl font-semibold text-foreground mb-1">{t('launchpad.title')}</h1>
              <p className="text-muted-foreground text-sm">{t('launchpad.subtitle')}</p>
            </div>

            <div className="rounded-xl border border-border bg-card divide-y divide-border mb-5">
              <div className="flex items-center gap-3 p-4">
                <Store className="w-5 h-5 text-icon-muted shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {store?.storeName || t('launchpad.storeFallbackName')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {store
                      ? t('launchpad.storeSynced', { count: store.productCount ?? 0 })
                      : t('launchpad.storeUnavailable')}
                  </p>
                </div>
                {store && <CheckCircle2 className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" />}
              </div>

              <div className="flex items-center gap-3 p-4">
                <MessageCircle className="w-5 h-5 text-icon-muted shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {linkedPage ? (
                    <>
                      <p className="text-sm font-medium text-foreground truncate">{linkedPage.name}</p>
                      {/* The card must not contradict its own CTA: a connected
                          page that is NOT yet linked to the store says so. */}
                      <p className="text-xs text-muted-foreground">
                        {t(linkedPage.ecommerceStoreId ? 'launchpad.pageLinked' : 'launchpad.pageNotLinkedYet')}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('launchpad.noPageYet')}</p>
                  )}
                </div>
                {linkedPage && (
                  <Badge variant={replying ? 'success' : 'warning'} size="xs">
                    {replying ? t('launchpad.replyOn') : t('launchpad.replyOff')}
                  </Badge>
                )}
              </div>
            </div>

            <Button onClick={openJawab} className="w-full" icon={<ExternalLink className="w-4 h-4" aria-hidden="true" />}>
              {linkedPage?.ecommerceStoreId ? t('launchpad.openApp') : t('launchpad.completeSetup')}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">{t('launchpad.opensNewTab')}</p>

            {manageUrl && (
              <div className="text-center mt-4">
                <button
                  type="button"
                  className="text-sm text-brand-600 hover:underline"
                  onClick={() => void openMarketplaceManageUrl(manageUrl, activeLocale)}
                >
                  {t('launchpad.managePlanInZid')}
                </button>
              </div>
            )}

            <p className="text-xs text-subtle text-center mt-6">{t('launchpad.footnote')}</p>
          </div>
        )}
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.zidEmbedded]);
