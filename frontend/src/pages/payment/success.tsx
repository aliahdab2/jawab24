import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';
import { CheckCircle2 } from 'lucide-react';

export default function PaymentSuccessPage() {
  const router = useRouter();
  const { session_id } = router.query;
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(5);
  
  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);

  useEffect(() => {
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
  }, [session_id]);

  return (
    <>
      <Head>
        <title>{t('payment.success.title')} - Jawab24</title>
      </Head>

      <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center px-4 pt-safe pb-safe">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
            {/* Success Icon */}
            <div className="mb-6 flex justify-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </div>
            </div>

            {/* Success Message */}
            <h1 className="text-3xl font-bold text-surface-900 mb-4">
              {t('payment.success.title')}
            </h1>
            <p className="text-surface-600 mb-6">
              {t('payment.success.message')}
            </p>

            {/* Redirect Info */}
            <div className="bg-brand-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-brand-700">
                {t('payment.success.redirecting')} {countdown}s...
              </p>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <Link href="/dashboard" className="block">
                <Button size="lg" className="w-full">
                  {t('payment.success.goToDashboard')}
                </Button>
              </Link>
              <Link href="/pricing" className="block">
                <Button variant="secondary" size="lg" className="w-full">
                  {t('payment.success.backToPricing')}
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Fixed safe area backgrounds */}
        <div className="fixed-safe-bg top-safe-bg bg-white" aria-hidden="true" />
        <div className="fixed-safe-bg bottom-safe-bg bg-surface-100" aria-hidden="true" />
      </div>
    </>
  );
}

