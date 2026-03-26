import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

type SessionStatus = 'loading' | 'complete' | 'open' | 'expired';

export default function PaymentReturnPage() {
  const router = useRouter();
  const { session_id } = router.query;
  const t = useTranslations('payment');
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [countdown, setCountdown] = useState(5);

  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);

  // Check session status
  useEffect(() => {
    // Missing or invalid session_id — show incomplete state
    if (router.isReady && (!session_id || typeof session_id !== 'string')) {
      setStatus('open');
      return;
    }
    if (!session_id || typeof session_id !== 'string') return;

    const checkStatus = async () => {
      try {
        const response = await api.get(`/payment/checkout-session-status?session_id=${encodeURIComponent(session_id)}`);
        const { status: sessionStatus } = response.data;
        setStatus(sessionStatus === 'complete' ? 'complete' : sessionStatus === 'expired' ? 'expired' : 'open');
      } catch (err) {
        captureError(err, 'Failed to check checkout session status', { tags: { page: 'payment-return' } });
        setStatus('open');
      }
    };

    checkStatus();
  }, [session_id, router.isReady]);

  // Countdown redirect on success
  useEffect(() => {
    if (status !== 'complete') return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1 && !redirectedRef.current) {
          redirectedRef.current = true;
          routerRef.current.push('/dashboard');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center px-4" role="status" aria-busy="true">
        <div className="text-center" aria-live="polite">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto mb-3" aria-hidden="true" />
          <p className="text-muted-foreground text-sm">{t('return.checking')}</p>
        </div>
      </div>
    );
  }

  if (status === 'complete') {
    return (
      <>
        <Head>
          <title>{t('success.title')} - Jawab24</title>
        </Head>

        <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-emerald-50 dark:from-green-950/20 dark:via-background dark:to-emerald-950/20 flex items-center justify-center px-4">
          <div className="max-w-md w-full">
            <div className="bg-card rounded-3xl shadow-xl p-8 text-center">
              <div className="mb-6 flex justify-center" aria-hidden="true">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
                </div>
              </div>

              <h1 className="text-3xl font-bold text-foreground mb-4">
                {t('success.title')}
              </h1>
              <p className="text-muted-foreground mb-6">
                {t('success.message')}
              </p>

              <div className="bg-brand-50 dark:bg-brand-900/20 rounded-lg p-4 mb-6" aria-live="polite">
                <p className="text-sm text-brand-700 dark:text-brand-300">
                  {t('success.redirecting')} {countdown}s...
                </p>
              </div>

              <div className="space-y-3">
                <Link href="/dashboard" className="block">
                  <Button size="lg" className="w-full">
                    {t('success.goToDashboard')}
                  </Button>
                </Link>
                <Link href="/pricing" className="block">
                  <Button variant="secondary" size="lg" className="w-full">
                    {t('success.backToPricing')}
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          <div className="fixed-safe-bg top-safe-bg bg-card" aria-hidden="true" />
          <div className="fixed-safe-bg bottom-safe-bg bg-muted" aria-hidden="true" />
        </div>
      </>
    );
  }

  // open or expired
  return (
    <>
      <Head>
        <title>{status === 'expired' ? t('return.expired') : t('return.incomplete')} - Jawab24</title>
      </Head>

      <div className="min-h-[100dvh] bg-gradient-to-br from-red-50 via-white to-orange-50 dark:from-red-950/20 dark:via-background dark:to-orange-950/20 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-card rounded-3xl shadow-xl p-8 text-center">
            <div className="mb-6 flex justify-center" aria-hidden="true">
              <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
              </div>
            </div>

            <h1 className="text-3xl font-bold text-foreground mb-4">
              {status === 'expired' ? t('return.expired') : t('return.incomplete')}
            </h1>
            <p className="text-muted-foreground mb-6">
              {status === 'expired' ? t('return.expiredMessage') : t('return.incompleteMessage')}
            </p>

            <div className="space-y-3">
              <Link href="/pricing" className="block">
                <Button size="lg" className="w-full">
                  {t('return.tryAgain')}
                </Button>
              </Link>
              <Link href="/dashboard" className="block">
                <Button variant="secondary" size="lg" className="w-full">
                  {t('return.goToDashboard')}
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="fixed-safe-bg top-safe-bg bg-card" aria-hidden="true" />
        <div className="fixed-safe-bg bottom-safe-bg bg-muted" aria-hidden="true" />
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.paymentReturn]);
