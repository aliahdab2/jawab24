import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticPaths, GetStaticProps } from 'next';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { BRAND_ASSETS } from '@/constants/brand';
import { isRTLLocale, getIntlLocale } from '@/utils/locale';
import { formatPlainDate } from '@/utils/dateUtils';
import { contentLastModified } from '@/data/contentDates';
import { ShopifyIcon, SallaIcon, ZidIcon } from '@/components/landing';
import type { MessageKeys, NestedKeyOf } from 'use-intl';
import {
  getAllIntegrationSlugs,
  getIntegration,
  type Integration,
} from '@/data/integrations';

/** Cast a dynamic ecommerce key for next-intl — all keys are validated at build time via translation:validate */
type IntegrationKey = MessageKeys<IntlMessages['integrations'], NestedKeyOf<IntlMessages['integrations']>>;
const k = (key: string) => key as unknown as IntegrationKey;

interface IntegrationPageProps {
  integration: Integration;
}

const PLATFORM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  shopify: ShopifyIcon,
  salla: SallaIcon,
  zid: ZidIcon,
};

export default function IntegrationPage({ integration }: IntegrationPageProps) {
  const t = useTranslations('ecommerce');
  const tc = useTranslations('common');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const slug = integration.slug;
  // See ContentDates — shown to the reader and emitted as dateModified.
  const lastModified = contentLastModified(integration);
  const formattedLastModified = formatPlainDate(lastModified, getIntlLocale(locale), { alwaysYear: true }) ?? lastModified;

  const PlatformIcon = PLATFORM_ICONS[slug];

  const faqs = Array.from({ length: integration.faqCount }, (_, i) => ({
    question: t(k(`${slug}.faqQ${i + 1}`)),
    answer: t(k(`${slug}.faqA${i + 1}`)),
  }));

  const features = Array.from({ length: integration.featureCount }, (_, i) =>
    t(k(`${slug}.feature${i + 1}`)),
  );

  const steps = Array.from({ length: integration.stepCount }, (_, i) => ({
    title: t(k(`${slug}.step${i + 1}Title`)),
    desc: t(k(`${slug}.step${i + 1}Desc`)),
  }));

  return (
    <>
      <Head>
        <title>{t(k(`${slug}.seoTitle`))}</title>
        <meta name="description" content={t(k(`${slug}.seoDescription`))} />

        <meta key="og:title" property="og:title" content={t(k(`${slug}.seoTitle`))} />
        <meta key="og:description" property="og:description" content={t(k(`${slug}.seoDescription`))} />

        <meta name="twitter:title" content={t(k(`${slug}.seoTitle`))} />
        <meta name="twitter:description" content={t(k(`${slug}.seoDescription`))} />

        {/* WebPage structured data for AI extraction */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebPage',
              'name': t(k(`${slug}.seoTitle`)),
              'description': t(k(`${slug}.seoDescription`)),
              'url': BRAND_ASSETS.urls.canonical(`/integrations/${slug}`),
              'datePublished': integration.date,
              'dateModified': lastModified,
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
            <BackArrow className="w-5 h-5" />
            {t('backToHome')}
          </Link>

          {/* Hero */}
          <div className="flex items-center gap-4 mb-4">
            {PlatformIcon && (
              <div
                className="flex items-center justify-center w-14 h-14 rounded-xl"
                style={{ backgroundColor: `${integration.brandColor}15` }}
              >
                <PlatformIcon className="w-8 h-8" />
              </div>
            )}
            <h1 className="text-4xl font-bold">
              {t(k(`${slug}.heroTitle`))}
            </h1>
          </div>
          <p className="text-lg text-foreground/70 leading-relaxed mb-3">
            {t(k(`${slug}.heroSubtitle`))}
          </p>
          <p className="text-sm text-muted-foreground mb-12">
            <time dateTime={lastModified}>{tc('lastUpdatedOn', { date: formattedLastModified })}</time>
          </p>

          {/* How It Works */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-6">
              {t('howItWorks')}
            </h2>
            <div className="space-y-6">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: integration.brandColor }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-1">
                      {step.title}
                    </h3>
                    <p className="text-foreground/70 leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Key Features */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">
              {t('keyFeatures')}
            </h2>
            <div className="space-y-3">
              {features.map((feature, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Check
                    className="w-5 h-5 flex-shrink-0 mt-0.5"
                    style={{ color: integration.brandColor }}
                    aria-hidden="true"
                  />
                  <p className="text-foreground/80 leading-relaxed">{feature}</p>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">
              {t('faqTitle')}
            </h2>
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
            <h2 className="text-2xl font-bold mb-3">{t('ctaTitle')}</h2>
            <p className="text-foreground/70 mb-6">{t('ctaDescription')}</p>
            <Link
              href="/login"
              className="inline-flex items-center px-8 py-3 bg-brand-400 text-white rounded-lg hover:bg-brand-500 transition-colors font-medium text-lg"
            >
              {t('cta')}
            </Link>
          </section>

          {/* Footer */}
          <div className="pt-8 border-t border-theme-border text-center">
            <p className="text-xs text-muted-foreground">
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

export const getStaticPaths: GetStaticPaths = async () => {
  const slugs = getAllIntegrationSlugs();
  const isMobile = process.env.IS_MOBILE_BUILD === 'true';
  const paths = isMobile
    ? slugs.map((slug) => ({ params: { slug } }))
    : slugs.flatMap((slug) => [
        { params: { slug }, locale: 'ar' },
        { params: { slug }, locale: 'en' },
      ]);
  return { paths, fallback: false };
};

export const getStaticProps: GetStaticProps<IntegrationPageProps> = async (ctx) => {
  const { getI18nProps } = await import('@/i18n/getMessages');
  const { PAGE_NAMESPACES } = await import('@/i18n/namespaces');
  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.ecommerce]);
  const slug = ctx.params?.slug as string;
  const integration = getIntegration(slug);

  if (!integration) {
    return { notFound: true };
  }

  return { props: { integration, ...i18nProps } };
};
