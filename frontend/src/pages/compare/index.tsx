import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticProps } from 'next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';
import { buildWebUrl } from '@/lib/webUrl';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { getCompetitorSummaries } from '@/data/competitors';

interface CompareHubProps {
  competitors: { slug: string; name: string }[];
}

export default function CompareHubPage({ competitors }: CompareHubProps) {
  const t = useTranslations('compare');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const ForwardArrow = isRTL ? ArrowLeft : ArrowRight;

  return (
    <>
      <Head>
        <title>{t('hubSeoTitle')}</title>
        <meta name="description" content={t('hubSeoDescription')} />

        <meta key="og:title" property="og:title" content={t('hubSeoTitle')} />
        <meta key="og:description" property="og:description" content={t('hubSeoDescription')} />
        <meta name="twitter:title" content={t('hubSeoTitle')} />
        <meta name="twitter:description" content={t('hubSeoDescription')} />

        {/* CollectionPage + ItemList — lets search/AI engines see all comparisons at once */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              'name': t('hubSeoTitle'),
              'description': t('hubSeoDescription'),
              'url': buildWebUrl('/compare', locale),
              'isPartOf': { '@type': 'WebSite', 'name': 'Jawab24', 'url': 'https://jawab24.com' },
              'mainEntity': {
                '@type': 'ItemList',
                'itemListElement': competitors.map((c, i) => ({
                  '@type': 'ListItem',
                  'position': i + 1,
                  'name': t('vsTitle', { name: c.name }),
                  'url': buildWebUrl(`/compare/${c.slug}`, locale),
                })),
              },
            }),
          }}
        />

        <BreadcrumbJsonLd
          items={[
            { name: 'Jawab24', url: buildWebUrl('/', locale) },
            { name: t('hubBreadcrumb'), url: buildWebUrl('/compare', locale) },
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
          <h1 className="text-4xl font-bold mb-3">{t('hubTitle')}</h1>
          <p className="text-lg text-foreground/70 leading-relaxed mb-6">{t('hubSubtitle')}</p>

          {/* Self-contained Jawab24 summary — the extractable block AI engines lift,
              so the publisher reads as a candidate and not only as the author (C2/GEO) */}
          <p className="mb-10 rounded-lg border-s-4 border-brand-400 bg-muted/40 p-5 leading-relaxed text-foreground/90">
            {t('hubJawabSummary')}
          </p>

          {/* Comparison cards */}
          <section className="mb-12" aria-labelledby="compare-cards-heading">
            <h2 id="compare-cards-heading" className="sr-only">{t('hubCardsHeading')}</h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {competitors.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/compare/${c.slug}`}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-theme-border p-5 hover:border-brand-400 hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-lg font-semibold text-foreground">
                      {t('vsTitle', { name: c.name })}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-400 flex-shrink-0">
                      {t('hubViewComparison')}
                      <ForwardArrow className="w-4 h-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Related reading — internal link equity to the money post */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-brand-400 mb-4">{t('hubRelatedTitle')}</h2>
            <Link
              href="/blog/best-auto-reply-tools-2026"
              className="inline-flex items-center gap-1.5 text-foreground/80 hover:text-brand-400 transition-colors"
            >
              {t('hubBestTools')}
              <ForwardArrow className="w-4 h-4" aria-hidden="true" />
            </Link>
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
            <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Jawab24</p>
          </div>
        </div>

        {/* Fixed bottom safe area background */}
        <div className="fixed-safe-bg bottom-safe-bg bg-background" aria-hidden="true" />
      </div>
    </>
  );
}

export const getStaticProps: GetStaticProps<CompareHubProps> = async (ctx) => {
  const { getI18nProps } = await import('@/i18n/getMessages');
  const { PAGE_NAMESPACES } = await import('@/i18n/namespaces');
  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.compare]);
  const competitors = getCompetitorSummaries();

  return { props: { competitors, ...i18nProps } };
};
