import Head from 'next/head';
import Link from 'next/link';
import { useTranslation, type TranslationKey } from '@/i18n';
import { ArrowLeft } from 'lucide-react';

export default function DataDeletion() {
  const { t } = useTranslation();

  return (
    <>
      <Head>
        <title>{t('dataDeletion.title')}</title>
        <meta name="description" content={t('dataDeletion.metaDescription')} />
        <link rel="canonical" href="https://jawab24.com/data-deletion" />
      </Head>

      <div className="flex-1 overflow-y-auto bg-background py-12 px-4 sm:px-6 lg:px-8 text-start ">
        <div className="max-w-3xl mx-auto bg-card rounded-2xl shadow-sm p-8 border border-theme-border">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('dataDeletion.header')}</h1>
          <h2 className="text-lg font-semibold text-brand-600 mb-4">{t('dataDeletion.subheader' as TranslationKey)}</h2>
          <p className="text-foreground/70 mb-8 leading-relaxed">{t('dataDeletion.intro' as TranslationKey)}</p>

          <div className="prose prose-slate max-w-none">
            <p className="text-muted-foreground mb-6 italic text-sm">
              <strong>{t('dataDeletion.lastUpdated')}</strong> {t('dataDeletion.updateDate')}
            </p>

            {/* Section 1: Deletion Options */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('dataDeletion.howToDeleteTitle')}</h2>
              <p className="text-foreground/70 mb-4">
                {t('dataDeletion.howToDeleteText')}
              </p>
            </section>

            <section className="mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('dataDeletion.option1Title')}</h3>
              <ol className="list-decimal ps-6 text-foreground/70 space-y-2">
                <li>
                  {t('dataDeletion.option1Step1')}{' '}
                  <a href="https://jawab24.com" className="text-brand-600 hover:underline font-medium">
                    jawab24.com
                  </a>
                </li>
                <li>{t('dataDeletion.option1Step2')} <strong>{t('nav.settings')}</strong></li>
                <li>{t('dataDeletion.option1Step3')} <strong>{t('settings.deleteAccount')}</strong></li>
                <li>{t('dataDeletion.option1Step4')}</li>
              </ol>
              <p className="text-muted-foreground mt-4 p-3 status-danger rounded-lg text-sm">
                {t('dataDeletion.option1Note')}
              </p>
            </section>

            <section className="mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('dataDeletion.option2Title')}</h3>
              <ol className="list-decimal ps-6 text-foreground/70 space-y-2">
                <li>
                  {t('dataDeletion.option2Step1')}{' '}
                  <a
                    href="https://www.facebook.com/settings?tab=business_tools"
                    className="text-brand-600 hover:underline font-medium"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('dataDeletion.option2Step1Link')}
                  </a>
                </li>
                <li>{t('dataDeletion.option2Step2')} <strong>Jawab24</strong> {t('dataDeletion.option2Step2Suffix')}</li>
                <li>{t('dataDeletion.option2Step3')} <strong>{t('common.delete')}</strong></li>
                <li>{t('dataDeletion.option2Step4')}</li>
              </ol>
            </section>

            <section className="mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('dataDeletion.option3Title')}</h3>
              <p className="text-foreground/70 mb-4">
                {t('dataDeletion.option3Text')}
              </p>
              <p className="text-foreground/70">
                <strong>{t('dataDeletion.option3Email')}</strong>{' '}
                <a href="mailto:support@jawab24.com" className="text-brand-600 hover:underline font-medium">
                  support@jawab24.com
                </a>
              </p>
              <p className="text-muted-foreground mt-4 text-sm">
                {t('dataDeletion.option3Note')}
              </p>
            </section>

            {/* Section 2: Data Associated with Meta Platforms */}
            <section className="mb-8 p-6 bg-background rounded-2xl border border-theme-border">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('dataDeletion.metaDataTitle' as TranslationKey)}</h2>
              <p className="text-foreground/70 mb-4">{t('dataDeletion.metaDataIntro' as TranslationKey)}</p>
              <ul className="list-disc ps-6 text-foreground/70 space-y-2">
                <li>{t('dataDeletion.metaItemPageIds' as TranslationKey)}</li>
                <li>{t('dataDeletion.metaItemInstagramIds' as TranslationKey)}</li>
                <li>{t('dataDeletion.metaItemWebhooks' as TranslationKey)}</li>
                <li>{t('dataDeletion.metaItemTokens' as TranslationKey)}</li>
              </ul>
            </section>

            {/* Section 3: What Will Be Deleted */}
            <section className="mb-8 p-6 bg-background rounded-2xl border border-theme-border">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('dataDeletion.whatWillBeDeletedTitle')}</h2>
              <ul className="list-disc ps-6 text-foreground/70 space-y-2">
                <li>{t('dataDeletion.whatItemAccount')}</li>
                <li>{t('dataDeletion.whatItemPages')}</li>
                <li>{t('dataDeletion.whatItemContent')}</li>
                <li>{t('dataDeletion.whatItemHistory')}</li>
                <li>{t('dataDeletion.whatItemKnowledge')}</li>
                <li>{t('dataDeletion.whatItemSettings')}</li>
              </ul>
            </section>

            {/* Section 4: Processing Time */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('dataDeletion.processingTimeTitle' as TranslationKey)}</h2>
              <p className="text-foreground/70 leading-relaxed">
                {t('dataDeletion.processingTimeText' as TranslationKey)}
              </p>
            </section>

            {/* Section 5: Revoking Access */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('dataDeletion.revokeAccessTitle' as TranslationKey)}</h2>
              <p className="text-foreground/70 leading-relaxed">
                {t('dataDeletion.revokeAccessText' as TranslationKey)}{' '}
                <a
                  href="https://www.facebook.com/settings?tab=applications"
                  className="text-brand-600 hover:underline font-medium"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('dataDeletion.revokeAccessLink' as TranslationKey)}
                </a>.
              </p>
            </section>

            {/* Section 6: Data Retention */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('dataDeletion.dataRetentionTitle')}</h2>
              <p className="text-foreground/70 leading-relaxed">
                {t('dataDeletion.dataRetentionText')}
              </p>
            </section>
          </div>

          <div className="mt-8 pt-8 border-t border-theme-border">
            <Link href="/landing" className="text-brand-600 hover:text-brand-700 font-bold inline-flex items-center gap-2 transition-colors">
              <ArrowLeft className="w-5 h-5 transition-transform rtl:rotate-180" />
              {t('dataDeletion.backToHome')}
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

export { getStaticProps } from '@/i18n/getMessages';
