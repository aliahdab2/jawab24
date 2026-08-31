import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticPaths, GetStaticProps } from 'next';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale, getIntlLocale } from '@/utils/locale';
import { formatPlainDate } from '@/utils/dateUtils';
import { contentLastModified } from '@/data/contentDates';
import { buildWebUrl } from '@/lib/webUrl';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import type { MessageKeys, NestedKeyOf } from 'use-intl';
import {
  getAllCompetitorSlugs,
  getCompetitor,
  FEATURE_KEYS,
  type Competitor,
} from '@/data/competitors';

/** Cast a dynamic compare key for next-intl — all keys are validated at build time via translation:validate */
type CompareKey = MessageKeys<IntlMessages['compare'], NestedKeyOf<IntlMessages['compare']>>;
const k = (key: string) => key as unknown as CompareKey;

interface ComparePageProps {
  competitor: Competitor;
}

function FeatureValue({ value }: { value: boolean | string }) {
  const t = useTranslations('compare');
  // A string value is an i18n key under `compare.val.*`, never display text —
  // see the CompetitorFeature doc comment in data/competitors.ts.
  if (typeof value === 'string') {
    return <span className="text-foreground font-medium">{t(k(`val.${value}`))}</span>;
  }
  if (value) {
    return <Check className="w-5 h-5 text-green-600 dark:text-green-400 mx-auto" aria-hidden="true" />;
  }
  return <X className="w-5 h-5 text-red-500 dark:text-red-400 mx-auto" aria-hidden="true" />;
}

function FeatureLabel({ value }: { value: boolean | string }) {
  const t = useTranslations('compare');
  if (typeof value === 'string') return null;
  return (
    <span className="sr-only">
      {value ? t('yes') : t('no')}
    </span>
  );
}

export default function ComparePage({ competitor }: ComparePageProps) {
  const t = useTranslations('compare');
  const tc = useTranslations('common');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const slug = competitor.slug;
  // The date the comparison was last re-verified (see ContentDates) — shown to
  // the reader and emitted as dateModified, so a rewrite is not indistinguishable
  // from the March original.
  const lastModified = contentLastModified(competitor);
  const formattedLastModified = formatPlainDate(lastModified, getIntlLocale(locale), { alwaysYear: true }) ?? lastModified;

  const faqs = [
    { question: t(k(`${slug}.faqQ1`)), answer: t(k(`${slug}.faqA1`)) },
    { question: t(k(`${slug}.faqQ2`)), answer: t(k(`${slug}.faqA2`)) },
    { question: t(k(`${slug}.faqQ3`)), answer: t(k(`${slug}.faqA3`)) },
  ];

  const advantages = [
    t(k(`${slug}.advantage1`)),
    t(k(`${slug}.advantage2`)),
    t(k(`${slug}.advantage3`)),
    t(k(`${slug}.advantage4`)),
  ];

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
              'url': buildWebUrl(`/compare/${slug}`, locale),
              'datePublished': competitor.date,
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

        <BreadcrumbJsonLd
          items={[
            { name: 'Jawab24', url: buildWebUrl('/', locale) },
            { name: t('hubBreadcrumb'), url: buildWebUrl('/compare', locale) },
            { name: t('vsTitle', { name: competitor.name }), url: buildWebUrl(`/compare/${slug}`, locale) },
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
            <BackArrow className="w-5 h-5" />
            {t('backToHome')}
          </Link>

          {/* Hero */}
          <h1 className="text-4xl font-bold mb-3">
            {t('vsTitle', { name: competitor.name })}
          </h1>
          <p className="text-lg text-foreground/70 leading-relaxed mb-3">
            {t(k(`${slug}.subtitle`))}
          </p>
          <p className="text-sm text-muted-foreground mb-8">
            <time dateTime={lastModified}>{tc('lastUpdatedOn', { date: formattedLastModified })}</time>
          </p>

          {/* The verdict — a self-contained, liftable summary placed BEFORE the
              feature table so engines extract Jawab24's claim, not a rival's row */}
          <section className="mb-12 rounded-lg border-s-4 border-brand-400 bg-muted/40 p-5">
            <h2 className="text-xl font-semibold text-brand-400 mb-2">{t('verdictTitle')}</h2>
            <p className="leading-relaxed text-foreground/90">{t(k(`${slug}.verdict`))}</p>
          </section>

          {/* Feature Comparison Table */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">
              {t('featureComparison')}
            </h2>

            {/* Desktop table */}
            <div className="overflow-x-auto rounded-lg border border-theme-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-start py-3 px-4 font-semibold text-foreground">
                      {t('feature')}
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-brand-500 w-32">
                      Jawab24
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-muted-foreground w-32">
                      {competitor.name}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_KEYS.map((key) => {
                    const feature = competitor.features[key];
                    if (!feature) return null;
                    return (
                      <tr key={key} className="border-t border-theme-border hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 text-foreground">
                          { }
                          {t(k(`feat.${key}`))}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <FeatureValue value={feature.jawab24} />
                          <FeatureLabel value={feature.jawab24} />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <FeatureValue value={feature.competitor} />
                          <FeatureLabel value={feature.competitor} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Why Choose Jawab24 */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">
              {t('whyChoose')}
            </h2>
            <div className="space-y-3">
              {advantages.map((advantage, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-foreground/80 leading-relaxed">{advantage}</p>
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
  const slugs = getAllCompetitorSlugs();
  const isMobile = process.env.IS_MOBILE_BUILD === 'true';
  const paths = isMobile
    ? slugs.map((slug) => ({ params: { slug } }))
    : slugs.flatMap((slug) => [
        { params: { slug }, locale: 'ar' },
        { params: { slug }, locale: 'en' },
      ]);
  return { paths, fallback: false };
};

export const getStaticProps: GetStaticProps<ComparePageProps> = async (ctx) => {
  const { getI18nProps } = await import('@/i18n/getMessages');
  const { PAGE_NAMESPACES } = await import('@/i18n/namespaces');
  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.compare]);
  const slug = ctx.params?.slug as string;
  const competitor = getCompetitor(slug);

  if (!competitor) {
    return { notFound: true };
  }

  return { props: { competitor, ...i18nProps } };
};
