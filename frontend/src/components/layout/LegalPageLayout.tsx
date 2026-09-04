import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { VersionStamp } from './VersionStamp';


interface Section {
  title: string;
  text: string;
  items?: string[];
  /** Closing paragraph rendered after the bullet list (e.g. a responsibility statement). */
  note?: string;
  email?: string;
  phone?: { label: string; href: string };
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
  lastUpdatedLabel?: string;
  lastUpdatedDate?: string;
  backToHomeLabel: string;
  sections: Section[];
}

export function LegalPageLayout({
  title,
  seoTitle,
  metaDescription,
  lastUpdatedLabel,
  lastUpdatedDate,
  backToHomeLabel,
  sections,
}: LegalPageLayoutProps) {
  return (
    <>
      <Head>
        <title>{seoTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta key="og:title" property="og:title" content={seoTitle} />
        <meta key="og:description" property="og:description" content={metaDescription} />
        <meta name="twitter:title" content={seoTitle} />
        <meta name="twitter:description" content={metaDescription} />
      </Head>

      <div className="flex-1 overflow-y-auto bg-background text-foreground">
        {/* Fixed top safe area background */}
        <div
          className="fixed-safe-bg top-safe-bg bg-background"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto px-6 sm:px-8 px-safe-landscape py-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            {backToHomeLabel}
          </Link>

          <h1 className="text-4xl font-bold mb-2">{title}</h1>
          {lastUpdatedLabel && lastUpdatedDate && (
            <p className="text-muted-foreground mb-8">
              {lastUpdatedLabel} {lastUpdatedDate}
            </p>
          )}
          {!lastUpdatedLabel && <div className="mb-8" />}

          <div className="space-y-8">
            {sections.map((section, index) => (
              <section key={index}>
                <h2 className="text-xl font-semibold text-brand-400 mb-3">{section.title}</h2>
                <p className="text-foreground/70 leading-relaxed">{section.text}</p>

                {section.items && (
                  <ul className="mt-3 space-y-2 text-foreground/70 ps-6">
                    {section.items.map((item, i) => (
                      <li key={i} className="list-disc">{item}</li>
                    ))}
                  </ul>
                )}

                {section.note && (
                  <p className="mt-3 text-foreground/70 leading-relaxed">{section.note}</p>
                )}

                {section.email && (
                  <p className="mt-3">
                    <a href={`mailto:${section.email}`} className="text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2">
                      {section.email}
                    </a>
                  </p>
                )}

                {section.phone && (
                  <p className="mt-3">
                    <a href={section.phone.href} className="text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2" dir="ltr">
                      {section.phone.label}
                    </a>
                  </p>
                )}

                {section.corporate && (
                  <div className="mt-3 text-foreground/70 space-y-1">
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
          <VersionStamp />
        </div>

        {/* Fixed bottom safe area background - matches dark page background */}
        <div
          className="fixed-safe-bg bottom-safe-bg bg-background"
          aria-hidden="true"
        />
      </div>
    </>
  );
}
