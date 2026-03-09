import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic translation keys need `as any` cast for next-intl */

export default function DataDeletion() {
  const t = useTranslations('dataDeletion');
  const tNav = useTranslations('nav');
  const tSettings = useTranslations('settings');
  const tc = useTranslations('common');

  return (
    <>
      <Head>
        <title>{t('title')}</title>
        <meta name="description" content={t('metaDescription')} />
        <link rel="canonical" href="https://jawab24.com/data-deletion" />
      </Head>

      <div className="flex-1 overflow-y-auto bg-background py-12 px-4 sm:px-6 lg:px-8 text-start ">
        <div className="max-w-3xl mx-auto bg-card rounded-2xl shadow-sm p-8 border border-theme-border">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('header')}</h1>
          <h2 className="text-lg font-semibold text-brand-600 mb-4">{t('subheader' as any)}</h2>
          <p className="text-foreground/70 mb-8 leading-relaxed">{t('intro' as any)}</p>

          <div className="prose prose-slate max-w-none">
            <p className="text-muted-foreground mb-6 italic text-sm">
              <strong>{t('lastUpdated')}</strong> {t('updateDate')}
            </p>

            {/* Section 1: Deletion Options */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('howToDeleteTitle')}</h2>
              <p className="text-foreground/70 mb-4">
                {t('howToDeleteText')}
              </p>
            </section>

            <section className="mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('option1Title')}</h3>
              <ol className="list-decimal ps-6 text-foreground/70 space-y-2">
                <li>
                  {t('option1Step1')}{' '}
                  <a href="https://jawab24.com" className="text-brand-600 hover:underline font-medium">
                    jawab24.com
                  </a>
                </li>
                <li>{t('option1Step2')} <strong>{tNav('settings')}</strong></li>
                <li>{t('option1Step3')} <strong>{tSettings('deleteAccount')}</strong></li>
                <li>{t('option1Step4')}</li>
              </ol>
              <p className="text-muted-foreground mt-4 p-3 status-danger rounded-lg text-sm">
                {t('option1Note')}
              </p>
            </section>

            <section className="mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('option2Title')}</h3>
              <ol className="list-decimal ps-6 text-foreground/70 space-y-2">
                <li>
                  {t('option2Step1')}{' '}
                  <a
                    href="https://www.facebook.com/settings?tab=business_tools"
                    className="text-brand-600 hover:underline font-medium"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('option2Step1Link')}
                  </a>
                </li>
                <li>{t('option2Step2')} <strong>Jawab24</strong> {t('option2Step2Suffix')}</li>
                <li>{t('option2Step3')} <strong>{tc('delete')}</strong></li>
                <li>{t('option2Step4')}</li>
              </ol>
            </section>

            <section className="mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('option3Title')}</h3>
              <p className="text-foreground/70 mb-4">
                {t('option3Text')}
              </p>
              <p className="text-foreground/70">
                <strong>{t('option3Email')}</strong>{' '}
                <a href="mailto:support@jawab24.com" className="text-brand-600 hover:underline font-medium">
                  support@jawab24.com
                </a>
              </p>
              <p className="text-muted-foreground mt-4 text-sm">
                {t('option3Note')}
              </p>
            </section>

            {/* Section 2: Data Associated with Meta Platforms */}
            <section className="mb-8 p-6 bg-background rounded-2xl border border-theme-border">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('metaDataTitle' as any)}</h2>
              <p className="text-foreground/70 mb-4">{t('metaDataIntro' as any)}</p>
              <ul className="list-disc ps-6 text-foreground/70 space-y-2">
                <li>{t('metaItemPageIds' as any)}</li>
                <li>{t('metaItemInstagramIds' as any)}</li>
                <li>{t('metaItemWebhooks' as any)}</li>
                <li>{t('metaItemTokens' as any)}</li>
              </ul>
            </section>

            {/* Section 3: What Will Be Deleted */}
            <section className="mb-8 p-6 bg-background rounded-2xl border border-theme-border">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('whatWillBeDeletedTitle')}</h2>
              <ul className="list-disc ps-6 text-foreground/70 space-y-2">
                <li>{t('whatItemAccount')}</li>
                <li>{t('whatItemPages')}</li>
                <li>{t('whatItemContent')}</li>
                <li>{t('whatItemHistory')}</li>
                <li>{t('whatItemKnowledge')}</li>
                <li>{t('whatItemSettings')}</li>
              </ul>
            </section>

            {/* Section 4: Processing Time */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('processingTimeTitle' as any)}</h2>
              <p className="text-foreground/70 leading-relaxed">
                {t('processingTimeText' as any)}
              </p>
            </section>

            {/* Section 5: Revoking Access */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('revokeAccessTitle' as any)}</h2>
              <p className="text-foreground/70 leading-relaxed">
                {t('revokeAccessText' as any)}{' '}
                <a
                  href="https://www.facebook.com/settings?tab=applications"
                  className="text-brand-600 hover:underline font-medium"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('revokeAccessLink' as any)}
                </a>.
              </p>
            </section>

            {/* Section 6: Data Retention */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('dataRetentionTitle')}</h2>
              <p className="text-foreground/70 leading-relaxed">
                {t('dataRetentionText')}
              </p>
            </section>
          </div>

          <div className="mt-8 pt-8 border-t border-theme-border">
            <Link href="/landing" className="text-brand-600 hover:text-brand-700 font-bold inline-flex items-center gap-2 transition-colors">
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
