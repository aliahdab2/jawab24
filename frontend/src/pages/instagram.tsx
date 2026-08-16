import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { BRAND_ASSETS } from '@/constants/brand';
import { InstagramIcon } from '@/components/ui';
import { isRTLLocale } from '@/utils/locale';

/**
 * Public Instagram channel page — /instagram
 *
 * Two audiences, one page:
 *  1. Merchants — what Jawab24 does on Instagram and how to connect.
 *  2. Meta App Review — the permission-by-permission disclosure of what each
 *     Instagram scope is used for, what we do NOT request, and how a merchant
 *     revokes access. Meta reviewers read a public use-case URL; this is it.
 *
 * Everything claimed here must be wired in production code (AI_INSTRUCTIONS §15).
 */

/** The Instagram scopes Jawab24 asks for, in the order the page discloses them. */
const PERMISSIONS = [
  { scope: 'instagram_business_basic', key: 'basic' },
  { scope: 'instagram_business_manage_messages', key: 'messages' },
  { scope: 'instagram_business_manage_comments', key: 'comments' },
] as const;

const STEP_COUNT = 4;
const FEATURE_COUNT = 6;
const FAQ_COUNT = 6;

export default function InstagramChannelPage() {
  const t = useTranslations('instagram');
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
              'url': BRAND_ASSETS.urls.canonical('/instagram'),
              'isPartOf': {
                '@type': 'WebSite',
                'name': 'Jawab24',
                'url': 'https://jawab24.com',
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
              <InstagramIcon size={32} aria-hidden="true" />
            </div>
            <h1 className="text-4xl font-bold">{t('heroTitle')}</h1>
          </div>
          <p className="text-lg text-foreground/70 leading-relaxed mb-4">
            {t('heroSubtitle')}
          </p>
          <p className="text-sm text-muted-foreground mb-12">{t('badge')}</p>

          {/* How it works */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-6">
              {t('howItWorks.title')}
            </h2>
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

          {/* Connect options */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-3">{t('connect.title')}</h2>
            <p className="text-foreground/80 leading-relaxed mb-4">{t('connect.text')}</p>
            <div className="space-y-3">
              <div className="bg-muted/50 rounded-lg p-4 border border-theme-border">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {t('connect.viaPageTitle')}
                </h3>
                <p className="text-foreground/70 leading-relaxed">{t('connect.viaPageText')}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 border border-theme-border">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {t('connect.directTitle')}
                </h3>
                <p className="text-foreground/70 leading-relaxed">{t('connect.directText')}</p>
                <p className="text-sm text-muted-foreground mt-2">{t('connect.directStatus')}</p>
              </div>
            </div>
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

          {/* Permissions & data use — the section Meta reviewers read */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-3">
              {t('permissions.title')}
            </h2>
            <p className="text-foreground/80 leading-relaxed mb-4">{t('permissions.intro')}</p>
            <div className="space-y-3">
              {PERMISSIONS.map(({ scope, key }) => (
                <div key={scope} className="bg-muted/50 rounded-lg p-4 border border-theme-border">
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {t(`permissions.${key}Name`)}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-2 font-mono" dir="ltr">
                    {scope}
                  </p>
                  <p className="text-foreground/70 leading-relaxed">
                    {t(`permissions.${key}Use`)}
                  </p>
                </div>
              ))}
            </div>
            <h3 className="text-lg font-semibold text-foreground mt-6 mb-1">
              {t('permissions.notRequestedTitle')}
            </h3>
            <p className="text-foreground/70 leading-relaxed">{t('permissions.notRequestedText')}</p>
          </section>

          {/* Data handling */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-3">{t('data.title')}</h2>
            <p className="text-foreground/80 leading-relaxed">{t('data.text')}</p>
            <ul className="mt-4 space-y-2 text-foreground/70 ps-6">
              <li className="list-disc">{t('data.p1')}</li>
              <li className="list-disc">{t('data.p2')}</li>
              <li className="list-disc">{t('data.p3')}</li>
              <li className="list-disc">{t('data.p4')}</li>
            </ul>
            <p className="mt-4 text-foreground/70 leading-relaxed">
              <Link href="/privacy" className="text-brand-400 hover:text-brand-300 transition-colors">
                {t('data.privacyLink')}
              </Link>
              {' · '}
              <Link
                href="/data-deletion"
                className="text-brand-400 hover:text-brand-300 transition-colors"
              >
                {t('data.deletionLink')}
              </Link>
            </p>
          </section>

          {/* Merchant control */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-3">{t('control.title')}</h2>
            <p className="text-foreground/80 leading-relaxed">{t('control.text')}</p>
            <ul className="mt-4 space-y-2 text-foreground/70 ps-6">
              <li className="list-disc">{t('control.c1')}</li>
              <li className="list-disc">{t('control.c2')}</li>
              <li className="list-disc">{t('control.c3')}</li>
            </ul>
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
                <Link
                  href="/what-is-jawab24"
                  className="text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {t('related.whatIs')}
                </Link>
              </li>
              <li>
                <Link
                  href="/compare"
                  className="text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {t('related.compare')}
                </Link>
              </li>
              <li>
                <Link href="/help" className="text-brand-400 hover:text-brand-300 transition-colors">
                  {t('related.help')}
                </Link>
              </li>
            </ul>
          </section>

          {/* Footer */}
          <div className="pt-8 border-t border-theme-border text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('disclaimer')}
            </p>
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
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.instagram]);
