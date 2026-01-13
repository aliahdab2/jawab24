import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface Section {
  title: string;
  text: string;
  items?: string[];
  email?: string;
  corporate?: {
    name: string;
    type: string;
    orgNr: string;
    address: string;
  };
}

interface LegalPageLayoutProps {
  title: string;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  lastUpdatedLabel: string;
  lastUpdatedDate: string;
  backToHomeLabel: string;
  sections: Section[];
}

export function LegalPageLayout({
  title,
  seoTitle,
  metaDescription,
  canonicalUrl,
  lastUpdatedLabel,
  lastUpdatedDate,
  backToHomeLabel,
  sections,
}: LegalPageLayoutProps) {
  const { language } = useTranslation();
  const isRTL = language === 'ar';

  return (
    <>
      <Head>
        <title>{seoTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:url" content={canonicalUrl} />
      </Head>

      <div dir={isRTL ? 'rtl' : 'ltr'} className="flex-1 overflow-y-auto bg-slate-900 text-white landscape:px-12">
        {/* Fixed top safe area background */}
        <div
          className="fixed-safe-bg top-safe-bg bg-slate-900"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12 pt-safe pb-safe">
          <Link
            href="/landing"
            className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            {backToHomeLabel}
          </Link>

          <h1 className="text-4xl font-bold mb-2">{title}</h1>
          <p className="text-slate-400 mb-8">
            {lastUpdatedLabel} {lastUpdatedDate}
          </p>

          <div className="space-y-8">
            {sections.map((section, index) => (
              <section key={index}>
                <h2 className="text-xl font-semibold text-brand-400 mb-3">{section.title}</h2>
                <p className="text-slate-300 leading-relaxed">{section.text}</p>

                {section.items && (
                  <ul className="mt-3 space-y-2 text-slate-300 ps-6">
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

          {/* Version Info */}
          <div className="mt-12 pt-8 border-t border-slate-700 text-center">
            <p className="text-xs text-slate-500">
              © {new Date().getFullYear()} Jawab24 • v{process.env.NEXT_PUBLIC_BUILD_TIME 
                ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleDateString() 
                : 'Dev'}
            </p>
          </div>
        </div>

        {/* Fixed bottom safe area background - matches dark page background */}
        <div
          className="fixed-safe-bg bottom-safe-bg bg-slate-900"
          aria-hidden="true"
        />
      </div>
    </>
  );
}
