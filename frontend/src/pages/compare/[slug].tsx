import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticPaths, GetStaticProps } from 'next';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { BRAND_ASSETS } from '@/constants/brand';
import {
  getAllCompetitorSlugs,
  getCompetitor,
  FEATURE_KEYS,
  type Competitor,
} from '@/data/competitors';

/** Cast a dynamic compare key to TranslationKey — all keys are validated at build time via translation:validate */
const k = (key: string) => key as TranslationKey;

interface ComparePageProps {
  competitor: Competitor;
}

function FeatureValue({ value }: { value: boolean | string }) {
  if (typeof value === 'string') {
    return <span className="text-foreground font-medium">{value}</span>;
  }
  if (value) {
    return <Check className="w-5 h-5 text-green-600 dark:text-green-400 mx-auto" aria-hidden="true" />;
  }
  return <X className="w-5 h-5 text-red-500 dark:text-red-400 mx-auto" aria-hidden="true" />;
}

function FeatureLabel({ value }: { value: boolean | string }) {
  const { t } = useTranslation();
  if (typeof value === 'string') return null;
  return (
    <span className="sr-only">
      {value ? t('compare.yes') : t('compare.no')}
    </span>
  );
}

export default function ComparePage({ competitor }: ComparePageProps) {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const slug = competitor.slug;

  const faqs = [
    { question: t(k(`compare.${slug}.faq.q1`)), answer: t(k(`compare.${slug}.faq.a1`)) },
    { question: t(k(`compare.${slug}.faq.q2`)), answer: t(k(`compare.${slug}.faq.a2`)) },
    { question: t(k(`compare.${slug}.faq.q3`)), answer: t(k(`compare.${slug}.faq.a3`)) },
  ];

  const advantages = [
    t(k(`compare.${slug}.advantage1`)),
    t(k(`compare.${slug}.advantage2`)),
    t(k(`compare.${slug}.advantage3`)),
    t(k(`compare.${slug}.advantage4`)),
  ];

  return (
    <>
      <Head>
        <title>{t(k(`compare.${slug}.seoTitle`))}</title>
        <meta name="description" content={t(k(`compare.${slug}.seoDescription`))} />
        <link rel="canonical" href={BRAND_ASSETS.urls.canonical(`/compare/${slug}`)} />

        <meta property="og:title" content={t(k(`compare.${slug}.seoTitle`))} />
        <meta property="og:description" content={t(k(`compare.${slug}.seoDescription`))} />
        <meta property="og:url" content={BRAND_ASSETS.urls.canonical(`/compare/${slug}`)} />
        <meta property="og:image" content={BRAND_ASSETS.urls.ogImage()} />
        <meta property="og:type" content="website" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={t(k(`compare.${slug}.seoTitle`))} />
        <meta name="twitter:description" content={t(k(`compare.${slug}.seoDescription`))} />
        <meta name="twitter:image" content={BRAND_ASSETS.urls.ogImage()} />

        {/* WebPage structured data for AI extraction */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebPage',
              'name': t(k(`compare.${slug}.seoTitle`)),
              'description': t(k(`compare.${slug}.seoDescription`)),
              'url': `https://jawab24.com/compare/${slug}`,
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

      <div dir={isRTL ? 'rtl' : 'ltr'} className="flex-1 overflow-y-auto bg-background text-foreground">
        {/* Fixed top safe area background */}
        <div className="fixed-safe-bg top-safe-bg bg-background" aria-hidden="true" />

        <div className="max-w-4xl mx-auto px-6 sm:px-8 px-safe-landscape py-12">
          {/* Back link */}
          <Link
            href="/landing"
            className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            <BackArrow className="w-5 h-5" />
            {t('compare.backToHome')}
          </Link>

          {/* Hero */}
          <h1 className="text-4xl font-bold mb-3">
            {t('compare.vsTitle', { name: competitor.name })}
          </h1>
          <p className="text-lg text-foreground/70 leading-relaxed mb-10">
            {t(k(`compare.${slug}.subtitle`))}
          </p>

          {/* Feature Comparison Table */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">
              {t('compare.featureComparison')}
            </h2>

            {/* Desktop table */}
            <div className="overflow-x-auto rounded-lg border border-theme-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-start py-3 px-4 font-semibold text-foreground">
                      {t('compare.feature')}
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
                          {t(`compare.feat.${key}`)}
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
              {t('compare.whyChoose')}
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
              {t('compare.faqTitle')}
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
            <h2 className="text-2xl font-bold mb-3">{t('compare.ctaTitle')}</h2>
            <p className="text-foreground/70 mb-6">{t('compare.ctaDescription')}</p>
            <Link
              href="/login"
              className="inline-flex items-center px-8 py-3 bg-brand-400 text-white rounded-lg hover:bg-brand-500 transition-colors font-medium text-lg"
            >
              {t('compare.cta')}
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
  const paths = slugs.flatMap((slug) => [
    { params: { slug }, locale: 'ar' },
    { params: { slug }, locale: 'en' },
  ]);
  return { paths, fallback: false };
};

export const getStaticProps: GetStaticProps<ComparePageProps> = async ({ params }) => {
  const slug = params?.slug as string;
  const competitor = getCompetitor(slug);

  if (!competitor) {
    return { notFound: true };
  }

  return { props: { competitor } };
};
