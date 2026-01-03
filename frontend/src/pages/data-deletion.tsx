import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from '@/i18n';
import { ArrowLeft } from 'lucide-react';

export default function DataDeletion() {
  const { t } = useTranslation();

  return (
    <>
      <Head>
        <title>{t('dataDeletion.title')}</title>
        <meta name="description" content={t('dataDeletion.metaDescription')} />
      </Head>

      <div className="min-h-screen bg-surface-50 py-12 px-4 sm:px-6 lg:px-8 text-start">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm p-8 border border-surface-200">
          <h1 className="text-3xl font-bold text-surface-900 mb-8">{t('dataDeletion.header')}</h1>

          <div className="prose prose-slate max-w-none">
            <p className="text-surface-500 mb-6 italic text-sm">
              <strong>{t('dataDeletion.lastUpdated')}</strong> {t('dataDeletion.updateDate')}
            </p>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-surface-900 mb-4">{t('dataDeletion.howToDeleteTitle')}</h2>
              <p className="text-surface-700 mb-4">
                {t('dataDeletion.howToDeleteText')}
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-surface-900 mb-4">{t('dataDeletion.option1Title')}</h2>
              <ol className="list-decimal ps-6 text-surface-700 space-y-2">
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
              <p className="text-surface-600 mt-4 p-3 bg-red-50 rounded-lg border border-red-100 text-sm">
                {t('dataDeletion.option1Note')}
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-surface-900 mb-4">{t('dataDeletion.option2Title')}</h2>
              <ol className="list-decimal ps-6 text-surface-700 space-y-2">
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
              <h2 className="text-xl font-semibold text-surface-900 mb-4">{t('dataDeletion.option3Title')}</h2>
              <p className="text-surface-700 mb-4">
                {t('dataDeletion.option3Text')}
              </p>
              <p className="text-surface-700">
                <strong>{t('dataDeletion.option3Email')}</strong>{' '}
                <a href="mailto:support@jawab24.com" className="text-brand-600 hover:underline font-medium">
                  support@jawab24.com
                </a>
              </p>
              <p className="text-surface-600 mt-4 text-sm">
                {t('dataDeletion.option3Note')}
              </p>
            </section>

            <section className="mb-8 p-6 bg-surface-50 rounded-2xl border border-surface-100">
              <h2 className="text-xl font-semibold text-surface-900 mb-4">{t('dataDeletion.whatWillBeDeletedTitle')}</h2>
              <ul className="list-disc ps-6 text-surface-700 space-y-2">
                <li>{t('dataDeletion.whatItemAccount')}</li>
                <li>{t('dataDeletion.whatItemPages')}</li>
                <li>{t('dataDeletion.whatItemContent')}</li>
                <li>{t('dataDeletion.whatItemHistory')}</li>
                <li>{t('dataDeletion.whatItemKnowledge')}</li>
                <li>{t('dataDeletion.whatItemSettings')}</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-surface-900 mb-4">{t('dataDeletion.dataRetentionTitle')}</h2>
              <p className="text-surface-700 leading-relaxed">
                {t('dataDeletion.dataRetentionText')}
              </p>
            </section>
          </div>

          <div className="mt-8 pt-8 border-t border-surface-100">
            <Link href="/landing" className="text-brand-600 hover:text-brand-700 font-bold inline-flex items-center gap-2 transition-colors">
              <ArrowLeft className="w-5 h-5 transition-transform rtl:rotate-180" />
              {t('dataDeletion.backToHome')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}


