import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from '@/i18n';

export default function PrivacyPolicy() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  const sections = [
    { title: t('legal.privacy.section1Title'), text: t('legal.privacy.section1Text') },
    { title: t('legal.privacy.section2Title'), text: t('legal.privacy.section2Text'), items: t('legal.privacy.section2Items') },
    { title: t('legal.privacy.section3Title'), text: t('legal.privacy.section3Text'), items: t('legal.privacy.section3Items') },
    { title: t('legal.privacy.section4Title'), text: t('legal.privacy.section4Text'), items: t('legal.privacy.section4Items') },
    { title: t('legal.privacy.section5Title'), text: t('legal.privacy.section5Text') },
    { title: t('legal.privacy.section6Title'), text: t('legal.privacy.section6Text') },
    { title: t('legal.privacy.section7Title'), text: t('legal.privacy.section7Text'), items: t('legal.privacy.section7Items') },
    { title: t('legal.privacy.section8Title'), text: t('legal.privacy.section8Text'), items: t('legal.privacy.section8Items') },
    { title: t('legal.privacy.section9Title'), text: t('legal.privacy.section9Text') },
    { title: t('legal.privacy.section10Title'), text: t('legal.privacy.section10Text'), showContact: true },
    { title: t('legal.privacy.section11Title'), text: t('legal.privacy.section11Text'), showCorporate: true },
  ];

  return (
    <>
      <Head>
        <title>{t('legal.privacy.title')} - Jawab24</title>
        <meta name="description" content={t('legal.privacy.metaDescription')} />
      </Head>

      <div 
        className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8" 
        dir={isRTL ? 'rtl' : 'ltr'}
        lang={isRTL ? 'ar' : 'en'}
      >
        <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            {t('legal.privacy.title')}
          </h1>

          <div className="prose prose-gray max-w-none">
            <p className="text-gray-600 mb-6">
              <strong>{t('legal.lastUpdated')}</strong> {t('legal.december2024')}
            </p>

            {sections.map((section, index) => (
              <section key={index} className="mb-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">
                  {section.title}
                </h2>
                <p className="text-gray-700 mb-4">{section.text}</p>
                
                {section.items && Array.isArray(section.items) && (
                  <ul className="list-disc ltr:pl-6 rtl:pr-6 text-gray-700 space-y-2">
                    {section.items.map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}

                {section.showContact && (
                  <p className="text-gray-700 mt-4">
                    <strong>{t('legal.contact.email')}</strong>
                  </p>
                )}

                {section.showCorporate && (
                  <p className="text-gray-700 mt-4">
                    <strong>{t('legal.corporate.name')}</strong><br />
                    {t('legal.corporate.type')}<br />
                    <strong>{t('legal.corporate.orgNr')}</strong><br />
                    <strong>{t('legal.corporate.address')}</strong>
                  </p>
                )}
              </section>
            ))}
          </div>

          <div className="mt-8 pt-8 border-t border-gray-200">
            <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
              {t('legal.backToHome')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
