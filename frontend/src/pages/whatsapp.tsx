import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { BRAND_ASSETS } from '@/constants/brand';
// Direct imports, NOT the '@/components/ui' barrel (43 re-exports) — public
// page. The barrel reaches '@jawab24/shared', which is CommonJS and cannot
// be tree-shaken, so one named import pulls zod + libphonenumber-js.
import { WhatsAppIcon } from '@/components/ui/BrandIcons';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { buildWebUrl } from '@/lib/webUrl';
import { isRTLLocale } from '@/utils/locale';

/**
 * Public WhatsApp channel page — /whatsapp
 *
 * Query-shaped, unlike the launch blog post (whose H1 is a news headline
 * nobody searches for — 08-22 audit §1.3). WhatsApp went GA 2026-07-26 while
 * most of the crawlable corpus predates it; this page is the channel's
 * canonical description for both merchants and AI engines.
 */

const STEP_COUNT = 4;
const FEATURE_COUNT = 6;
const FAQ_COUNT = 6;

/** Publish/substantive-revision dates, mirrored in generate-sitemap.js STATIC_PAGES. */
const DATE_PUBLISHED = '2026-08-31';
const DATE_MODIFIED = '2026-08-31';

export default function WhatsAppChannelPage() {
  const t = useTranslations('whatsapp');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  const steps = Array.from({ length: STEP_COUNT }, (_, i) => ({
    title: t(`howItWorks.step${i + 1}Title`),
    desc: t(`howItWorks.step${i + 1}Desc`),
  }));

  const features = Array.from({ length: FEATURE_COUNT }, (_, i) =>
    t(`features.f${i + 1}`),
  );

  const faqs = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    question: t(`faq.q${i + 1}`),
    answer: t(`faq.a${i + 1}`),
  }));

  return (
    <>
      <Head>
        <title>{t('seoTitle')}</title>
        <meta name="description" content={t('seoDescription')} />

        <meta key="og:title" property="og:title" content={t('seoTitle')} />
        <meta key="og:description" property="og:description" content={t('seoDescription')} />

        <meta name="twitter:title" content={t('seoTitle')} />
        <meta name="twitter:description" content={t('seoDescription')} />

        {/* WebPage structured data for AI extraction */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebPage',
              'name': t('seoTitle'),
              'description': t('seoDescription'),
              'url': BRAND_ASSETS.urls.canonical('/whatsapp'),
              'datePublished': DATE_PUBLISHED,
              'dateModified': DATE_MODIFIED,
              'isPartOf': {
                '@type': 'WebSite',
                'name': BRAND_ASSETS.meta.appName,
                'url': BRAND_ASSETS.urls.base,
              },
            }),
          }}
        />

        {/* FAQPage structured data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              'mainEntity': faqs.map((faq) => ({
                '@type': 'Question',
                'name': faq.question,
                'acceptedAnswer': {
                  '@type': 'Answer',
                  'text': faq.answer,
                },
              })),
            }),
          }}
        />

        <BreadcrumbJsonLd
          items={[
            { name: 'Jawab24', url: buildWebUrl('/', locale) },
            { name: t('heroTitle'), url: buildWebUrl('/whatsapp', locale) },
          ]}
        />
      </Head>

      <div className="flex-1 overflow-y-auto bg-background text-foreground">
        {/* Fixed top safe area background */}
        <div className="fixed-safe-bg top-safe-bg bg-background" aria-hidden="true" />

        <div className="max-w-4xl mx-auto px-6 sm:px-8 px-safe-landscape py-12">
          {/* Back link */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            <BackArrow className="w-5 h-5" aria-hidden="true" />
            {t('backToHome')}
          </Link>

          {/* Hero */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-muted/50 text-brand-400 flex-shrink-0">
              <WhatsAppIcon size={32} aria-hidden="true" />
            </div>
            <h1 className="text-4xl font-bold">{t('heroTitle')}</h1>
          </div>
          <p className="text-lg text-foreground/70 leading-relaxed mb-4">{t('heroSubtitle')}</p>
          <p className="text-sm text-muted-foreground mb-12">{t('badge')}</p>

          {/* How it works */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-6">{t('howItWorks.title')}</h2>
            <ol className="space-y-6">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-4">
                  <span
                    className="flex-shrink-0 w-10 h-10 rounded-full bg-brand-400 text-white flex items-center justify-center font-bold text-lg"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-1">{step.title}</h3>
                    <p className="text-foreground/70 leading-relaxed">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Features */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">{t('features.title')}</h2>
            <ul className="space-y-3">
              {features.map((feature, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5 text-brand-400" aria-hidden="true" />
                  <span className="text-foreground/80 leading-relaxed">{feature}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Coexistence — the phone stays in the merchant's hands */}
          <section className="mb-12 rounded-lg border-s-4 border-brand-400 bg-muted/40 p-5">
            <h2 className="text-2xl font-semibold text-brand-400 mb-3">{t('coexist.title')}</h2>
            <p className="text-foreground/80 leading-relaxed">{t('coexist.text')}</p>
          </section>

          {/* FAQ */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">{t('faq.title')}</h2>
            <div className="space-y-6">
              {faqs.map((faq, i) => (
                <div key={i}>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{faq.question}</h3>
                  <p className="text-foreground/70 leading-relaxed">{faq.answer}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="text-center py-8 mb-8">
            <h2 className="text-2xl font-bold mb-3">{t('cta.title')}</h2>
            <p className="text-foreground/70 mb-6">{t('cta.text')}</p>
            <Link
              href="/login"
              className="inline-flex items-center px-8 py-3 bg-brand-400 text-white rounded-lg hover:bg-brand-500 transition-colors font-medium text-lg"
            >
              {t('cta.button')}
            </Link>
          </section>

          {/* Related reading */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-3">{t('related.title')}</h2>
            <ul className="space-y-2">
              <li>
                <Link href="/no-store" className="text-brand-400 hover:text-brand-300 transition-colors">
                  {t('related.noStore')}
                </Link>
              </li>
              <li>
                <Link href="/instagram" className="text-brand-400 hover:text-brand-300 transition-colors">
                  {t('related.instagram')}
                </Link>
              </li>
              <li>
                <Link
                  href="/blog/whatsapp-auto-reply-jawab24"
                  className="text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {t('related.launchPost')}
                </Link>
              </li>
              <li>
                <Link
                  href="/blog/jawab24-data-security"
                  className="text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {t('related.security')}
                </Link>
              </li>
            </ul>
          </section>

          {/* Footer */}
          <div className="pt-8 border-t border-theme-border text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">{t('disclaimer')}</p>
            <p className="text-xs text-muted-foreground mt-2">
              &copy; {new Date().getFullYear()} Jawab24
            </p>
          </div>
        </div>

        {/* Fixed bottom safe area background */}
        <div className="fixed-safe-bg bottom-safe-bg bg-background" aria-hidden="true" />
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.whatsapp]);
