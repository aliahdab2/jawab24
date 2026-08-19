import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ExternalLink, ShieldCheck, Activity } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';
import { BRAND_ASSETS } from '@/constants/brand';
import { UPTIME_STATS, CHECK_INTERVAL_MINUTES, DOWNTIME_MINUTES } from '@/data/uptime';

const PATH = '/trust';

/** Used only as the `url` inside the JSON-LD block — the <link rel="canonical">
 *  tag itself is _app.tsx's job. Built through the same helper _app.tsx uses so
 *  the two cannot disagree if the origin or the locale-prefix scheme changes. */
function canonicalFor(locale: string) {
  return BRAND_ASSETS.urls.canonical(locale === 'en' ? `/en${PATH}` : PATH);
}

/** One measured figure with its label, rendered large. */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-5xl sm:text-6xl font-bold text-brand-400 leading-none">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export default function Trust() {
  const t = useTranslations('trust');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const canonical = canonicalFor(locale);

  /** seoDescription interpolates these; seoTitle deliberately does not. */
  const seoValues = {
    percent: UPTIME_STATS.percent,
    days: UPTIME_STATS.windowDays,
  };

  return (
    <>
      <Head>
        {/* canonical, hreflang, og:url, og:image and robots are emitted globally
            by _app.tsx from the current path — setting them again here would
            render a SECOND canonical tag and let a crawler pick either one. */}
        <title>{t('seoTitle')}</title>
        <meta name="description" content={t('seoDescription', seoValues)} />

        <meta key="og:title" property="og:title" content={t('seoTitle')} />
        <meta key="og:description" property="og:description" content={t('seoDescription', seoValues)} />

        <meta name="twitter:title" content={t('seoTitle')} />
        <meta name="twitter:description" content={t('seoDescription', seoValues)} />

        {/* The measured figure restated as structured data, with the third-party
            status page as the citation an assistant can follow and check. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebPage',
              name: t('title'),
              description: t('seoDescription', seoValues),
              url: canonical,
              isPartOf: {
                '@type': 'WebSite',
                name: 'Jawab24',
                url: 'https://jawab24.com',
              },
              mainEntity: {
                '@type': 'Dataset',
                name: 'Jawab24 service availability',
                description:
                  `${UPTIME_STATS.percent}% uptime measured over ${UPTIME_STATS.windowDays} days ` +
                  `(${UPTIME_STATS.windowStart} to ${UPTIME_STATS.windowEnd}), from the lower-scoring ` +
                  `of ${UPTIME_STATS.monitors} monitored endpoints rather than their average: ` +
                  `${UPTIME_STATS.incidents} incidents totalling ${DOWNTIME_MINUTES} minutes. ` +
                  `Measured independently by ${UPTIME_STATS.provider}, polling every ` +
                  `${CHECK_INTERVAL_MINUTES} minutes.`,
                creator: { '@type': 'Organization', name: UPTIME_STATS.provider },
                temporalCoverage: `${UPTIME_STATS.windowStart}/${UPTIME_STATS.windowEnd}`,
                url: UPTIME_STATS.statusPageUrl,
                isAccessibleForFree: true,
              },
            }),
          }}
        />
      </Head>

      <div className="flex-1 overflow-y-auto bg-background text-foreground">
        <div className="fixed-safe-bg top-safe-bg bg-background" aria-hidden="true" />

        <div className="max-w-4xl mx-auto px-6 sm:px-8 px-safe-landscape py-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            <BackArrow className="w-5 h-5" aria-hidden="true" />
            {t('backToHome')}
          </Link>

          <h1 className="text-4xl font-bold mb-3">{t('title')}</h1>
          <p className="text-lg text-foreground/70 leading-relaxed mb-10">{t('intro')}</p>

          <div className="space-y-12">
            {/* ── Availability ───────────────────────────────────────── */}
            <section aria-labelledby="uptime-heading">
              <h2
                id="uptime-heading"
                className="flex items-center gap-2 text-2xl font-semibold text-brand-400 mb-4"
              >
                <Activity className="w-6 h-6" aria-hidden="true" />
                {t('uptimeHeading')}
              </h2>

              <div className="bg-muted/50 rounded-lg border border-theme-border p-6 sm:p-8">
                <Figure
                  value={t('uptimeValue', { percent: UPTIME_STATS.percent })}
                  label={t('uptimeValueLabel')}
                />

                <dl className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-center">
                  {/* Each <dt> must NAME its own <dd>. Repeating one heading
                      three times makes a screen reader announce three identical
                      terms with different definitions. */}
                  <div>
                    <dt className="sr-only">{t('termWindow')}</dt>
                    <dd className="text-foreground/80">
                      {t('uptimeWindow', {
                        start: UPTIME_STATS.windowStart,
                        end: UPTIME_STATS.windowEnd,
                        days: UPTIME_STATS.windowDays,
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('termIncidents')}</dt>
                    <dd className="text-foreground/80">
                      {t('uptimeIncidents', { count: UPTIME_STATS.incidents })}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('termDowntime')}</dt>
                    <dd className="text-foreground/80">
                      {t('uptimeDowntime', { count: DOWNTIME_MINUTES })}
                    </dd>
                  </div>
                </dl>

                {/* Without this, the figure reads as an average across both
                    monitors — and the reader can compute otherwise from the
                    status page we ourselves link to. */}
                <p className="mt-6 text-sm text-foreground/70 leading-relaxed">
                  {t('uptimeWorstCase')}
                </p>

                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  {t('uptimeProvider', { provider: UPTIME_STATS.provider })}
                </p>

                <a
                  href={UPTIME_STATS.statusPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('uptimeCtaAria', { provider: UPTIME_STATS.provider })}
                  className="mt-6 inline-flex items-center gap-2 text-brand-400 hover:text-brand-300 transition-colors font-medium"
                >
                  {t('uptimeCta')}
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                </a>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">{t('uptimeDisclaimer')}</p>
            </section>

            {/* ── How it is measured ─────────────────────────────────── */}
            <section aria-labelledby="measured-heading">
              <h2 id="measured-heading" className="text-2xl font-semibold text-brand-400 mb-3">
                {t('measuredHeading')}
              </h2>
              <p className="text-foreground/80 leading-relaxed">
                {t('measuredBody', {
                  minutes: CHECK_INTERVAL_MINUTES,
                  provider: UPTIME_STATS.provider,
                })}
              </p>
              <p className="mt-3 text-foreground/70">
                {t('uptimeInterval', { minutes: CHECK_INTERVAL_MINUTES })}
              </p>
            </section>

            {/* ── Data & transparency ────────────────────────────────── */}
            <section aria-labelledby="transparency-heading">
              <h2
                id="transparency-heading"
                className="flex items-center gap-2 text-2xl font-semibold text-brand-400 mb-3"
              >
                <ShieldCheck className="w-6 h-6" aria-hidden="true" />
                {t('transparencyHeading')}
              </h2>
              <p className="text-foreground/80 leading-relaxed mb-4">{t('transparencyBody')}</p>
              <ul className="space-y-2 ps-6">
                <li className="list-disc">
                  <Link href="/privacy" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkPrivacy')}
                  </Link>
                </li>
                <li className="list-disc">
                  <Link href="/terms" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkTerms')}
                  </Link>
                </li>
                <li className="list-disc">
                  <Link href="/data-deletion" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkDataDeletion')}
                  </Link>
                </li>
                <li className="list-disc">
                  <Link href="/contact" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkContact')}
                  </Link>
                </li>
              </ul>
            </section>
          </div>
        </div>

        <div className="fixed-safe-bg bottom-safe-bg bg-background" aria-hidden="true" />
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.trust]);
