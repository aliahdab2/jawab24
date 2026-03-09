import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { XCircle } from 'lucide-react';

export default function PaymentCancelPage() {
  const t = useTranslations('payment');

  return (
    <>
      <Head>
        <title>{t('cancel.title')} - Jawab24</title>
      </Head>

      <div className="min-h-[100dvh] bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-card rounded-3xl shadow-xl p-8 text-center">
            {/* Cancel Icon */}
            <div className="mb-6 flex justify-center">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                <XCircle className="w-12 h-12 text-red-600" />
              </div>
            </div>

            {/* Cancel Message */}
            <h1 className="text-3xl font-bold text-foreground mb-4">
              {t('cancel.title')}
            </h1>
            <p className="text-muted-foreground mb-6">
              {t('cancel.message')}
            </p>

            {/* Actions */}
            <div className="space-y-3">
              <Link href="/pricing" className="block">
                <Button size="lg" className="w-full">
                  {t('cancel.backToPricing')}
                </Button>
              </Link>
              <Link href="/dashboard" className="block">
                <Button variant="secondary" size="lg" className="w-full">
                  {t('cancel.goToDashboard')}
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
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.paymentCancel]);
