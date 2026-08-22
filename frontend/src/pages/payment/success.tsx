import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { CheckCircle2 } from 'lucide-react';
import { useIOSPaymentRedirect } from '@/hooks';

export default function PaymentSuccessPage() {
  const router = useRouter();
  const { session_id } = router.query;
  const t = useTranslations('payment');
  const [countdown, setCountdown] = useState(5);
  const iosRedirecting = useIOSPaymentRedirect();

  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (iosRedirecting) return;
    if (!session_id) return;

    // Countdown redirect to dashboard
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
  }, [session_id, iosRedirecting]);

  if (iosRedirecting) return null;

  return (
    <>
      <Head>
        <title>{t('success.title')} - Jawab24</title>
      </Head>

      <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-emerald-50 dark:from-green-950/20 dark:via-background dark:to-emerald-950/20 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-card rounded-3xl shadow-xl p-8 text-center">
            {/* Success Icon */}
            <div className="mb-6 flex justify-center" aria-hidden="true">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
              </div>
            </div>

            {/* Success Message */}
            <h1 className="text-3xl font-bold text-foreground mb-4">
              {t('success.title')}
            </h1>
            <p className="text-muted-foreground mb-6">
              {t('success.message')}
            </p>

            {/* Redirect Info */}
            <div className="bg-brand-50 dark:bg-brand-900/20 rounded-lg p-4 mb-6" aria-live="polite">
              <p className="text-sm text-brand-700 dark:text-brand-400">
                {t('success.redirecting')} {countdown}s...
              </p>
            </div>

            {/* Actions */}
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

        {/* Fixed safe area backgrounds */}
        <div className="fixed-safe-bg top-safe-bg bg-card" aria-hidden="true" />
        <div className="fixed-safe-bg bottom-safe-bg bg-muted" aria-hidden="true" />
      </div>
    </>
  );
}


import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.paymentSuccess]);
