import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from '@/i18n';

export default function PrivacyPolicy() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  const sections = [
    { title: t('privacy.introTitle'), text: t('privacy.introText') },
    {
      title: t('privacy.collectTitle'),
      text: t('privacy.collectText'),
      items: [t('privacy.collectItem1'), t('privacy.collectItem2'), t('privacy.collectItem3'), t('privacy.collectItem4')]
    },
    {
      title: t('privacy.useTitle'),
      text: t('privacy.useText'),
      items: [t('privacy.useItem1'), t('privacy.useItem2'), t('privacy.useItem3'), t('privacy.useItem4')]
    },
    { title: t('privacy.geoTitle'), text: t('privacy.geoText') },
    {
      title: t('privacy.shareTitle'),
      text: t('privacy.shareText'),
      items: [t('privacy.shareItem1'), t('privacy.shareItem2'), t('privacy.shareItem3')]
    },
    { title: t('privacy.securityTitle'), text: t('privacy.securityText') },
    { title: t('privacy.retentionTitle'), text: t('privacy.retentionText') },
    {
      title: t('privacy.rightsTitle'),
      text: t('privacy.rightsText'),
      items: [t('privacy.rightsItem1'), t('privacy.rightsItem2'), t('privacy.rightsItem3'), t('privacy.rightsItem4'), t('privacy.rightsItem5')]
    },
    {
      title: t('privacy.deletionTitle'),
      text: t('privacy.deletionText'),
      items: [t('privacy.deletionItem1'), t('privacy.deletionItem2'), t('privacy.deletionItem3')]
    },
    { title: t('privacy.changesTitle'), text: t('privacy.changesText') },
    {
      title: t('privacy.contactTitle'),
      text: t('privacy.contactText'),
      email: t('privacy.contactEmail')
    },
    {
      title: t('privacy.corporateTitle'),
      text: t('privacy.corporateText'),
      corporate: {
        name: t('privacy.corporateName'),
        type: t('privacy.corporateType'),
        orgNr: t('privacy.corporateOrgNr'),
        address: t('privacy.corporateAddress')
      }
    },
  ];

  return (
    <>
      <Head>
        <title>{t('privacy.seoTitle')}</title>
        <meta name="description" content={t('privacy.metaDescription')} />
        <link rel="canonical" href="https://jawab24.com/privacy" />
        <meta property="og:title" content={t('privacy.seoTitle')} />
        <meta property="og:url" content="https://jawab24.com/privacy" />
      </Head>

      <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-900 text-white pt-safe pb-safe">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <Link
            href="/landing"
            className="inline-block mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            {t('privacy.backToHome')}
          </Link>

          <h1 className="text-4xl font-bold mb-2">{t('privacy.title')}</h1>
          <p className="text-slate-400 mb-8">
            {t('privacy.lastUpdated')} {t('privacy.updateDate')}
          </p>

          <div className="space-y-8">
            {sections.map((section, index) => (
              <section key={index}>
                <h2 className="text-xl font-semibold text-brand-400 mb-3">{section.title}</h2>
                <p className="text-slate-300 leading-relaxed">{section.text}</p>

                {section.items && (
                  <ul className="mt-3 space-y-2 text-slate-300 ltr:pl-6 rtl:pr-6">
                    {section.items.map((item, i) => (
                      <li key={i} className="list-disc">{item}</li>
                    ))}
                  </ul>
                )}

                {section.email && (
                  <p className="mt-3 text-brand-400">{section.email}</p>
                )}

                {section.corporate && (
                  <div className="mt-3 text-slate-300 space-y-1">
                    <p><strong>{section.corporate.name}</strong></p>
                    <p>{section.corporate.type}</p>
                    <p>{section.corporate.orgNr}</p>
                    <p>{section.corporate.address}</p>
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
