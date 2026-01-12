import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';
import { XCircle } from 'lucide-react';

export default function PaymentCancelPage() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  return (
    <>
      <Head>
        <title>{t('payment.cancel.title')} - Jawab24</title>
      </Head>

      <div className="flex-1 overflow-y-auto bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center px-4 pt-safe pb-safe" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            {/* Cancel Icon */}
            <div className="mb-6 flex justify-center">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                <XCircle className="w-12 h-12 text-red-600" />
              </div>
            </div>

            {/* Cancel Message */}
            <h1 className="text-3xl font-bold text-surface-900 mb-4">
              {t('payment.cancel.title')}
            </h1>
            <p className="text-surface-600 mb-6">
              {t('payment.cancel.message')}
            </p>

            {/* Actions */}
            <div className="space-y-3">
              <Link href="/pricing" className="block">
                <Button size="lg" className="w-full">
                  {t('payment.cancel.backToPricing')}
                </Button>
              </Link>
              <Link href="/dashboard" className="block">
                <Button variant="secondary" size="lg" className="w-full">
                  {t('payment.cancel.goToDashboard')}
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

