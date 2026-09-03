import Head from 'next/head';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  KeyRound,
  Lock,
  FileSignature,
  Server,
  Users,
  Trash2,
  Activity,
  ShieldAlert,
  Eye,
} from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';
import { BRAND_ASSETS } from '@/constants/brand';
import { UPTIME_STATS } from '@/data/uptime';

const PATH = '/security';

/** Where a reader can report a vulnerability. Same address the Organization
 *  contactPoint in _document.tsx publishes, so the two cannot drift. */
const SECURITY_CONTACT = 'support@jawab24.com';

/** Used only as the `url` inside the JSON-LD block — the <link rel="canonical">
 *  tag itself is _app.tsx's job, exactly as on /trust. */
function canonicalFor(locale: string) {
  return BRAND_ASSETS.urls.canonical(locale === 'en' ? `/en${PATH}` : PATH);
}

/** One section: an icon-led heading over its own content. */
function Section({
  id,
  icon: Icon,
  heading,
  children,
}: {
  id: string;
  icon: typeof Lock;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        className="flex items-center gap-2 text-2xl font-semibold text-brand-400 mb-3"
      >
        <Icon className="w-6 h-6 shrink-0" aria-hidden="true" />
        {heading}
      </h2>
      {children}
    </section>
  );
}

/** A list of statements. `list-disc` with logical padding so RTL mirrors. */
function Points({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 ps-6 text-foreground/80 leading-relaxed">
      {items.map((text) => (
        <li key={text} className="list-disc">
          {text}
        </li>
      ))}
    </ul>
  );
}

export default function Security() {
  const t = useTranslations('security');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const canonical = canonicalFor(locale);

  return (
    <>
      <Head>
        {/* canonical, hreflang, og:url, og:image and robots are emitted globally
            by _app.tsx from the current path — setting them again here would
            render a SECOND canonical tag and let a crawler pick either one. */}
        <title>{t('seoTitle')}</title>
        <meta name="description" content={t('seoDescription')} />

        <meta key="og:title" property="og:title" content={t('seoTitle')} />
        <meta key="og:description" property="og:description" content={t('seoDescription')} />

        <meta name="twitter:title" content={t('seoTitle')} />
        <meta name="twitter:description" content={t('seoDescription')} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebPage',
              name: t('title'),
              description: t('seoDescription'),
              url: canonical,
              isPartOf: {
                '@type': 'WebSite',
                name: 'Jawab24',
                url: 'https://jawab24.com',
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
            {/* ── The scope limit, stated FIRST ──────────────────────────
                Deliberately above the protections rather than in a footnote
                below them. The page's credibility rests on naming the limit
                before the reader has to go looking for it — a broad
                "everything is encrypted" claim is the one thing here nobody
                could verify from outside. */}
            <section
              aria-labelledby="scope-heading"
              className="bg-muted/50 rounded-lg border border-theme-border p-6 sm:p-8"
            >
              <h2
                id="scope-heading"
                className="flex items-center gap-2 text-xl font-semibold text-foreground mb-3"
              >
                <Eye className="w-6 h-6 shrink-0 text-brand-400" aria-hidden="true" />
                {t('scopeHeading')}
              </h2>
              <p className="text-foreground/80 leading-relaxed">{t('scopeBody')}</p>
            </section>

            <Section id="access-heading" icon={KeyRound} heading={t('accessHeading')}>
              <Points items={[t('accessItem1'), t('accessItem2'), t('accessItem3')]} />
            </Section>

            <Section id="encryption-heading" icon={Lock} heading={t('encryptionHeading')}>
              <Points
                items={[t('encryptionItem1'), t('encryptionItem2'), t('encryptionItem3')]}
              />
            </Section>

            <Section id="integrity-heading" icon={FileSignature} heading={t('integrityHeading')}>
              <p className="text-foreground/80 leading-relaxed">{t('integrityBody')}</p>
            </Section>

            <Section id="hosting-heading" icon={Server} heading={t('hostingHeading')}>
              <Points items={[t('hostingItem1'), t('hostingItem2')]} />
            </Section>

            <Section id="subprocessors-heading" icon={Users} heading={t('subprocessorsHeading')}>
              <p className="text-foreground/80 leading-relaxed">{t('subprocessorsBody')}</p>
              <p className="mt-3 text-foreground/90 font-medium" dir="ltr">
                {t('subprocessorsList')}
              </p>
              <p className="mt-3 text-foreground/70 leading-relaxed">{t('subprocessorsNote')}</p>
            </Section>

            <Section id="deletion-heading" icon={Trash2} heading={t('deletionHeading')}>
              <Points items={[t('deletionItem1'), t('deletionItem2')]} />
            </Section>

            <Section id="monitoring-heading" icon={Activity} heading={t('monitoringHeading')}>
              <Points items={[t('monitoringItem1'), t('monitoringItem2')]} />
            </Section>

            <Section id="report-heading" icon={ShieldAlert} heading={t('reportHeading')}>
              <p className="text-foreground/80 leading-relaxed">
                {t('reportBody', { email: SECURITY_CONTACT })}
              </p>
            </Section>

            {/* ── Where to check us ──────────────────────────────────────
                The status page is the only link here we cannot edit, which
                is exactly why it is included. */}
            <Section id="verify-heading" icon={ExternalLink} heading={t('verifyHeading')}>
              <p className="text-foreground/80 leading-relaxed mb-4">{t('verifyBody')}</p>
              <ul className="space-y-2 ps-6">
                <li className="list-disc">
                  <Link href="/trust" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkTrust')}
                  </Link>
                </li>
                <li className="list-disc">
                  <Link href="/privacy" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkPrivacy')}
                  </Link>
                </li>
                <li className="list-disc">
                  <Link href="/data-deletion" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkDataDeletion')}
                  </Link>
                </li>
                <li className="list-disc">
                  <Link
                    href="/blog/jawab24-data-security"
                    className="text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    {t('linkBlog')}
                  </Link>
                </li>
                <li className="list-disc">
                  <Link href="/contact" className="text-brand-400 hover:text-brand-300 transition-colors">
                    {t('linkContact')}
                  </Link>
                </li>
                <li className="list-disc">
                  <a
                    href={UPTIME_STATS.statusPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    {UPTIME_STATS.provider}
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  </a>
                </li>
              </ul>
            </Section>
          </div>
        </div>

        <div className="fixed-safe-bg bottom-safe-bg bg-background" aria-hidden="true" />
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.security]);
