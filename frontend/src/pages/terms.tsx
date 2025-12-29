import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from '@/i18n';

export default function TermsOfService() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  const sections = [
    { title: t('legal.terms.section1Title'), text: t('legal.terms.section1Text') },
    { title: t('legal.terms.section2Title'), text: t('legal.terms.section2Text') },
    { title: t('legal.terms.section3Title'), text: t('legal.terms.section3Text'), items: t('legal.terms.section3Items') },
    { title: t('legal.terms.section4Title'), text: t('legal.terms.section4Text'), items: t('legal.terms.section4Items') },
    { title: t('legal.terms.section5Title'), text: t('legal.terms.section5Text'), items: t('legal.terms.section5Items') },
    { title: t('legal.terms.section6Title'), text: t('legal.terms.section6Text') },
    { title: t('legal.terms.section7Title'), text: t('legal.terms.section7Text'), items: t('legal.terms.section7Items') },
    { title: t('legal.terms.section8Title'), text: t('legal.terms.section8Text') },
    { title: t('legal.terms.section9Title'), text: t('legal.terms.section9Text') },
    { title: t('legal.terms.section10Title'), text: t('legal.terms.section10Text'), showContact: true },
    { title: t('legal.terms.section11Title'), text: t('legal.terms.section11Text'), showCorporate: true },
  ];

  return (
    <>
      <Head>
        <title>{t('legal.terms.title')} - Jawab24</title>
        <meta name="description" content={t('legal.terms.metaDescription')} />
      </Head>

      <div 
        className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8" 
        dir={isRTL ? 'rtl' : 'ltr'}
        lang={isRTL ? 'ar' : 'en'}
      >
        <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            {t('legal.terms.title')}
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
