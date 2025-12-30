import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from '@/i18n';

export default function TermsOfService() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  const sections = [
    { title: t('terms.acceptTitle'), text: t('terms.acceptText') },
    { title: t('terms.descTitle'), text: t('terms.descText') },
    { 
      title: t('terms.requireTitle'), 
      text: t('terms.requireText'), 
      items: [t('terms.requireItem1'), t('terms.requireItem2'), t('terms.requireItem3'), t('terms.requireItem4')]
    },
    { 
      title: t('terms.useTitle'), 
      text: t('terms.useText'), 
      items: [t('terms.useItem1'), t('terms.useItem2'), t('terms.useItem3'), t('terms.useItem4'), t('terms.useItem5')]
    },
    { 
      title: t('terms.aiTitle'), 
      text: t('terms.aiText'), 
      items: [t('terms.aiItem1'), t('terms.aiItem2'), t('terms.aiItem3')]
    },
    { title: t('terms.availTitle'), text: t('terms.availText') },
    { 
      title: t('terms.liabilityTitle'), 
      text: t('terms.liabilityText'), 
      items: [t('terms.liabilityItem1'), t('terms.liabilityItem2'), t('terms.liabilityItem3'), t('terms.liabilityItem4')]
    },
    { title: t('terms.termTitle'), text: t('terms.termText') },
    { title: t('terms.changesTitle'), text: t('terms.changesText') },
    { 
      title: t('terms.contactTitle'), 
      text: t('terms.contactText'),
      email: t('terms.contactEmail')
    },
    { 
      title: t('terms.corporateTitle'), 
      text: t('terms.corporateText'),
      corporate: {
        name: t('terms.corporateName'),
        type: t('terms.corporateType'),
        orgNr: t('terms.corporateOrgNr'),
        address: t('terms.corporateAddress')
      }
    },
  ];

  return (
    <>
      <Head>
        <title>{t('terms.title')} | Jawab24</title>
        <meta name="description" content={t('terms.metaDescription')} />
      </Head>
      
      <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <Link 
            href="/landing" 
            className="inline-block mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            {t('terms.backToHome')}
          </Link>
          
          <h1 className="text-4xl font-bold mb-2">{t('terms.title')}</h1>
          <p className="text-slate-400 mb-8">
            {t('terms.lastUpdated')} {t('terms.updateDate')}
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
