import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import axios from 'axios';
import { ShoppingBag, Loader2, XCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { sallaApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/**
 * Salla Easy Mode post-install landing page (the app's configured "App URL").
 *
 * In Easy Mode the tokens arrive server-to-server via the app.store.authorize webhook,
 * which stages a merchant-id-keyed pending install. This page lets the now-logged-in
 * merchant CLAIM that install. The `merchant` query param is read defensively — its exact
 * name/availability from Salla's redirect is confirmed during the live round-trip; we also
 * keep it in sessionStorage so it survives a login round-trip.
 */
type Phase = 'needLogin' | 'checking' | 'found' | 'claiming' | 'notFound' | 'missing' | 'error';

const MERCHANT_STORAGE_KEY = 'salla_connect_merchant';

export default function SallaConnected() {
  const router = useRouter();
  const t = useTranslations('salla');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // Salla loads this page (the Easy-Mode App URL) as a fresh full-page navigation, so the
  // persisted auth store hasn't rehydrated on first paint — isAuthenticated reads false
  // transiently. Wait for _hasHydrated before deciding, or a logged-in merchant flashes
  // the "you need to log in" screen. (Same rule as DashboardLayout — AI_INSTRUCTIONS §12.)
  const _hasHydrated = useAuthStore((s) => s._hasHydrated);
  const [phase, setPhase] = useState<Phase>('checking');
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Resolve the merchant id from the query (preferred) or a prior visit (sessionStorage).
  useEffect(() => {
    if (!router.isReady) return;
    const fromQuery = typeof router.query.merchant === 'string' ? router.query.merchant : null;
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(MERCHANT_STORAGE_KEY) : null;
    const resolved = fromQuery || stored;
    if (fromQuery && typeof window !== 'undefined') {
      window.sessionStorage.setItem(MERCHANT_STORAGE_KEY, fromQuery);
    }
    setMerchantId(resolved);
  }, [router.isReady, router.query.merchant]);

  const findPending = useCallback(async (merchant: string) => {
    setPhase('checking');
    try {
      const res = await sallaApi.getPendingInstalls(merchant);
      const first = res.pending?.[0];
      if (first) {
        setStoreName(first.storeName);
        setPendingId(first.id);
        setPhase('found');
      } else {
        setPhase('notFound');
      }
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (!router.isReady || !_hasHydrated) return; // keep the 'checking' spinner until auth rehydrates
    if (!isAuthenticated) {
      setPhase('needLogin');
      return;
    }
    if (!merchantId) {
      setPhase('missing');
      return;
    }
    findPending(merchantId);
  }, [router.isReady, _hasHydrated, isAuthenticated, merchantId, findPending]);

  const handleClaim = useCallback(async () => {
    if (!merchantId) return;
    setPhase('claiming');
    try {
      await sallaApi.claimInstall(pendingId ? { pendingId } : { merchantId });
      if (typeof window !== 'undefined') window.sessionStorage.removeItem(MERCHANT_STORAGE_KEY);
      router.replace('/salla/onboarding');
    } catch (err) {
      // Ownership binding: the backend proves the claim by matching the logged-in
      // account's email against the store's registered Salla email (D-012).
      const code = axios.isAxiosError(err)
        ? (err.response?.data as { code?: string } | undefined)?.code
        : undefined;
      if (code === 'email_mismatch' || code === 'no_email') {
        toast.error(t('claim.emailMismatch'));
      } else if (code === 'store_info_unavailable') {
        toast.error(t('claim.verifyUnavailable'));
      } else {
        toast.error(t('claim.error'));
      }
      setPhase('found');
    }
  }, [merchantId, pendingId, router, t]);

  const goLogin = useCallback(() => {
    router.push('/login?salla_pending=true');
  }, [router]);

  return (
    <>
      <Head>
        <title>{t('claim.title')}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-[100dvh] flex items-center justify-center bg-surface-50 px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-surface-200 dark:border-surface-400 bg-white dark:bg-surface-100 p-8 shadow-sm text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl icon-bg-brand">
            <ShoppingBag className="h-7 w-7" aria-hidden="true" />
          </div>

          {phase === 'checking' && (
            <Status icon={<Loader2 className="h-6 w-6 animate-spin text-icon-muted" aria-hidden="true" />}
              title={t('claim.title')} desc={t('claim.checking')} busy />
          )}

          {phase === 'found' && (
            <div>
              <h1 className="font-display text-xl font-semibold text-surface-900 dark:text-white">{t('claim.foundTitle')}</h1>
              <p className="mt-2 text-muted-foreground">
                {t('claim.foundDesc', { store: storeName || t('claim.yourStore') })}
              </p>
              <Button onClick={handleClaim} size="lg" className="mt-6 w-full bg-teal-700 hover:bg-teal-800 text-white rounded-2xl py-4">
                {t('claim.connectButton')}
                <ArrowRight className="ms-2 h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </Button>
            </div>
          )}

          {phase === 'claiming' && (
            <Status icon={<Loader2 className="h-6 w-6 animate-spin text-icon-muted" aria-hidden="true" />}
              title={t('claim.title')} desc={t('claim.connecting')} busy />
          )}

          {phase === 'needLogin' && (
            <div>
              <h1 className="font-display text-xl font-semibold text-surface-900 dark:text-white">{t('claim.needLoginTitle')}</h1>
              <p className="mt-2 text-muted-foreground">{t('claim.needLoginDesc')}</p>
              <Button onClick={goLogin} size="lg" className="mt-6 w-full bg-teal-700 hover:bg-teal-800 text-white rounded-2xl py-4">
                {t('claim.login')}
              </Button>
            </div>
          )}

          {phase === 'notFound' && (
            <ErrorState icon={<XCircle className="h-6 w-6 text-amber-500" aria-hidden="true" />}
              title={t('claim.notFoundTitle')} desc={t('claim.notFoundDesc')}
              action={<Button variant="secondary" size="lg" className="mt-6 w-full rounded-2xl py-4" onClick={() => router.push('/integrations')}>{t('claim.goToIntegrations')}</Button>} />
          )}

          {phase === 'missing' && (
            <ErrorState icon={<XCircle className="h-6 w-6 text-amber-500" aria-hidden="true" />}
              title={t('claim.title')} desc={t('claim.missingMerchant')}
              action={<Button variant="secondary" size="lg" className="mt-6 w-full rounded-2xl py-4" onClick={() => router.push('/integrations')}>{t('claim.goToIntegrations')}</Button>} />
          )}

          {phase === 'error' && (
            <ErrorState icon={<XCircle className="h-6 w-6 text-red-500" aria-hidden="true" />}
              title={t('claim.title')} desc={t('claim.error')}
              action={<Button size="lg" className="mt-6 w-full bg-teal-700 hover:bg-teal-800 text-white rounded-2xl py-4" onClick={() => merchantId && findPending(merchantId)}>{t('claim.retry')}</Button>} />
          )}
        </div>
      </div>
    </>
  );
}

function Status({ icon, title, desc, busy }: { icon: React.ReactNode; title: string; desc: string; busy?: boolean }) {
  return (
    <div aria-busy={busy} aria-live="polite">
      <div className="mb-3 flex justify-center">{icon}</div>
      <h1 className="font-display text-xl font-semibold text-surface-900 dark:text-white">{title}</h1>
      <p className="mt-2 text-muted-foreground">{desc}</p>
    </div>
  );
}

function ErrorState({ icon, title, desc, action }: { icon: React.ReactNode; title: string; desc: string; action: React.ReactNode }) {
  return (
    <div aria-live="polite">
      <div className="mb-3 flex justify-center">{icon}</div>
      <h1 className="font-display text-xl font-semibold text-surface-900 dark:text-white">{title}</h1>
      <p className="mt-2 text-muted-foreground">{desc}</p>
      {action}
    </div>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.sallaOnboard]);
