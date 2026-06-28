import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

/**
 * Data Deletion Status page — the URL returned by the Facebook Data Deletion
 * Callback (see backend webhookController.handleDataDeletion). Meta requires this
 * URL to resolve to a page where a user can check the status of their request.
 *
 * Deletion is processed automatically when the callback fires, so by the time a
 * user lands here the request has been actioned — this page confirms receipt and
 * echoes the confirmation code. It is intentionally static (no per-code lookup):
 * confirmation codes are opaque and not exposed via a public endpoint.
 */
export default function DeletionStatus() {
  const t = useTranslations('dataDeletion');
  const router = useRouter();

  // Only reflect a well-formed confirmation code (hex, as minted by the callback).
  const codeParam = router.query.code;
  const code = typeof codeParam === 'string' && /^[a-f0-9]{1,64}$/i.test(codeParam) ? codeParam : null;

  return (
    <>
      <Head>
        <title>{t('statusTitle')}</title>
        <meta name="description" content={t('statusMetaDescription')} />
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex-1 overflow-y-auto bg-background py-12 px-4 sm:px-6 lg:px-8 text-start">
        <div className="max-w-2xl mx-auto bg-card rounded-2xl shadow-sm p-8 border border-theme-border">
          <div className="flex items-center gap-3 mb-6">
            <CheckCircle2 className="w-8 h-8 text-brand-600 shrink-0" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">{t('statusHeader')}</h1>
          </div>

          <p className="text-muted-foreground mb-6 leading-relaxed">{t('statusReceived')}</p>

          {router.isReady && (
            code ? (
              <div className="mb-6 p-4 bg-background rounded-xl border border-theme-border">
                <p className="text-sm text-muted-foreground mb-1">{t('statusCodeLabel')}</p>
                <p className="font-mono text-foreground break-all" dir="ltr">{code}</p>
              </div>
            ) : (
              <p className="text-muted-foreground mb-6 text-sm">{t('statusNoCode')}</p>
            )
          )}

          <p className="text-muted-foreground mb-8 text-sm leading-relaxed">{t('statusProcessedNote')}</p>

          <p className="text-muted-foreground text-sm">
            {t('statusSupport')}{' '}
            <a href="mailto:support@jawab24.com" className="text-brand-600 hover:underline font-medium">
              support@jawab24.com
            </a>
          </p>

          <div className="mt-8 pt-8 border-t border-theme-border">
            <Link href="/" className="text-brand-600 hover:text-brand-700 font-bold inline-flex items-center gap-2 transition-colors">
              <ArrowLeft className="w-5 h-5 transition-transform rtl:rotate-180" />
              {t('backToHome')}
            </Link>
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
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.dataDeletion]);
