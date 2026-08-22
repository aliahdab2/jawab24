import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { useIOSPaymentRedirect } from '@/hooks';
import { getStripePromise } from '@/lib/stripeClient';

type SessionStatus = 'loading' | 'complete' | 'open' | 'expired';

export default function PaymentReturnPage() {
  const router = useRouter();
  const t = useTranslations('payment');
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [countdown, setCountdown] = useState(5);

  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);

  const iosRedirecting = useIOSPaymentRedirect();

  // Arrived from the native-app hosted-checkout bounce: this browser holds no
  // auth session, so auto-redirecting to /dashboard would dump a customer who
  // JUST PAID onto a login page. Show "return to the app" instead.
  const fromApp = router.query.hosted === '1';

  // Check payment status from Stripe query params or legacy session_id
  useEffect(() => {
    if (!router.isReady) return;
    if (iosRedirecting) return;

    const {
      payment_intent_client_secret,
      setup_intent_client_secret,
      session_id,
    } = router.query;

    // PaymentElement flow: check via Stripe.js client-side
    if (payment_intent_client_secret || setup_intent_client_secret) {
      const checkStripeIntent = async () => {
        const stripe = await getStripePromise();
        if (!stripe) { setStatus('open'); return; }

        if (typeof payment_intent_client_secret === 'string') {
          const { paymentIntent } = await stripe.retrievePaymentIntent(payment_intent_client_secret);
          setStatus(paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing' ? 'complete' : 'open');
        } else if (typeof setup_intent_client_secret === 'string') {
          const { setupIntent } = await stripe.retrieveSetupIntent(setup_intent_client_secret);
          setStatus(setupIntent?.status === 'succeeded' ? 'complete' : 'open');
        }
      };
      checkStripeIntent().catch((err) => {
        captureError(err, 'Failed to check intent status', { tags: { page: 'payment-return' } });
        setStatus('open');
      });
      return;
    }

    // Checkout Session flow (hosted or legacy embedded): check via backend API
    if (typeof session_id === 'string') {
      const checkSession = async () => {
        try {
          const response = await api.get(`/payment/checkout-session-status?session_id=${encodeURIComponent(session_id)}`);
          const { status: sessionStatus } = response.data;
          setStatus(sessionStatus === 'complete' ? 'complete' : sessionStatus === 'expired' ? 'expired' : 'open');
        } catch (err) {
          // Hosted checkout's success_url is only ever reached AFTER Stripe has
          // taken the payment, and the app-originated flow lands here in the
          // system browser, which holds no auth session — so the status call
          // 401s even though the payment succeeded. Showing failure to a
          // customer who just paid is worse than trusting Stripe's redirect
          // contract. (Activation is webhook/sweep-driven server-side either
          // way; this page is purely informational.)
          if (router.query.hosted === '1') {
            setStatus('complete');
            return;
          }
          captureError(err, 'Failed to check checkout session status', { tags: { page: 'payment-return' } });
          setStatus('open');
        }
      };
      checkSession();
      return;
    }

    // No valid params
    setStatus('open');
  }, [router.isReady, router.query, iosRedirecting]);

  // Countdown redirect on success (suppressed for the app-originated flow —
  // see fromApp above)
  useEffect(() => {
    if (status !== 'complete' || fromApp) return;

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
  }, [status, fromApp]);

  if (iosRedirecting) return null;

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
                <p className="text-sm text-brand-700 dark:text-brand-400">
                  {fromApp ? t('success.returnToApp') : `${t('success.redirecting')} ${countdown}s...`}
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
