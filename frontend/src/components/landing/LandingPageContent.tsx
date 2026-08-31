import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
// Direct imports, NOT the '@/components/ui' barrel (43 re-exports). The
// barrel reaches NotificationBell -> the '@/hooks' barrel -> the whole Post
// Reply feature, and WhatsAppHelpButton/FeedSnippet/FlagTag/CtaButtonPill ->
// '@jawab24/shared', which is CommonJS and therefore cannot be tree-shaken:
// one named import pulls zod + libphonenumber-js. Measured 2026-08-18 on
// prod at Slow 3G: 155.4 kB gzip of the landing's pre-paint bytes came in
// this way, for four components. See frontend/scripts/perf/README.md.
import { Button } from '@/components/ui/Button';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { ThemeToggleButton } from '@/components/ui/ThemeToggleButton';
import { useAuthStore } from '@/lib/store';
import { BRAND_ASSETS } from '@/constants/brand';
import { isRTLLocale, getNextLocale } from '@/utils/locale';
import { motion, MotionConfig, useInView } from 'framer-motion';
import { EASE_OUT, DUR, STAGGER } from '@/constants/motion';
import {
  LandingHero,
  LandingFeatures,
  LandingHowItWorks,
  LandingSocialProof,
  LandingPricing,
  LandingFAQ,
  LandingFooter,
  IntegrationShowcase,
  LandingLatestBlog,
  type LatestBlogPost,
} from '@/components/landing';

function StatsSection({ statsList }: { statsList: { value: string; label: string }[] }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-40px' });

  return (
    <section className="py-10 sm:py-20 landing-section-dark relative overflow-hidden" ref={ref}>
      {/* Background cosmic glow */}
      <div
        aria-hidden="true"
        className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full pointer-events-none landing-glow-emerald-soft"
        style={{ filter: 'blur(60px)' }}
      />

      <div className="flex items-center justify-center gap-8 sm:gap-20 lg:gap-32 relative z-10">
        {statsList.map((stat, i) => (
          <motion.div
            key={i}
            className="text-center group"
            initial={{ opacity: 1, y: 30, scale: 0.9 }}
            animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: 30, scale: 0.9 }}
            transition={{ duration: DUR.section, delay: i * STAGGER, ease: EASE_OUT }}
          >
            <div className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-2 sm:mb-3 group-hoverable:scale-110 transition-transform duration-200 stat-neon-breathe">{stat.value}</div>
            <div className="text-brand-300 font-bold uppercase tracking-widest text-xs sm:text-sm lg:text-base">{stat.label}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

interface LandingPageContentProps {
  latestPosts?: LatestBlogPost[];
}

export default function LandingPageContent({ latestPosts = [] }: LandingPageContentProps = {}) {
  const t = useTranslations('landing');
  const tc = useTranslations('common');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const isPricingPage = router.pathname === '/pricing';
  const { setLanguage } = useLanguage();
  // SSR renders with isAuthenticated=false (shows login button).
  // After hydration, swaps to dashboard button if authenticated.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const isAuthenticated = mounted ? useAuthStore.getState().isAuthenticated : false;

  const isRTL = isRTLLocale(locale);
  const dir = isRTL ? 'rtl' : 'ltr';

  const toggleLanguage = () => {
    setLanguage(getNextLocale(locale));
  };

  const faqs = [
    { question: t('faq.q1'), answer: t('faq.a1') },
    { question: t('faq.q2'), answer: t('faq.a2') },
    { question: t('faq.q3'), answer: t('faq.a3') },
    { question: t('faq.q4'), answer: t('faq.a4') },
    { question: t('faq.q5'), answer: t('faq.a5') },
    { question: t('faq.q6'), answer: t('faq.a6') },
  ];

  const statsList = [
    { value: '24/7', label: t('stats.available') },
    { value: '<1s', label: t('stats.speed') },
  ];

  return (
    <MotionConfig reducedMotion="user">
    <div dir={dir} className="flex-1 overflow-y-auto overflow-x-hidden bg-gradient-to-br from-sky-50 via-white to-violet-50 dark:from-surface-50 dark:via-surface-100 dark:to-surface-200 relative">
      <Head>
        <title>{t('seoTitle')}</title>
        <meta name="description" content={t('seoDescription')} />

        {/* Open Graph — title/desc override MetaHead defaults; image/type/locale/site_name inherited */}
        <meta key="og:title" property="og:title" content={t('seoTitle')} />
        <meta key="og:description" property="og:description" content={t('seoDescription')} />

        {/* Twitter — title/desc override MetaHead defaults; card/image inherited */}
        <meta name="twitter:title" content={t('seoTitle')} />
        <meta name="twitter:description" content={t('seoDescription')} />

        {/* FAQ Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              "mainEntity": faqs.map(faq => ({
                "@type": "Question",
                "name": faq.question,
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": faq.answer
                }
              }))
            })
          }}
        />
      </Head>

      {/* Dark mode decorative background */}
      <div className="hidden dark:block fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(79,116,178,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_90%,rgba(79,116,178,0.10),transparent_60%)]" />
        <div className="absolute inset-0 bg-[url('/images/cubes.png')] opacity-[0.06]" />
      </div>

      {/* Navigation — fixed, extends into safe area via pt-safe + box-content.
           Solid background — no backdrop-blur to avoid per-frame compositing on scroll. */}
      <nav
        dir={dir}
        className="fixed top-0 w-full z-50 bg-card/95 dark:bg-surface-50/95 border-b border-theme-border pt-safe box-content"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 px-safe-landscape">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <Link href="/" className="flex items-center gap-2 sm:gap-3 group">
              <BrandLogo
                variant="main"
                className="w-10 h-10 sm:w-12 sm:h-12 transition-transform duration-200 group-hoverable:rotate-6 flex-shrink-0"
              />
              <span className="font-display font-bold text-xl sm:text-2xl text-foreground tracking-tight">{BRAND_ASSETS.meta.appName}</span>
            </Link>

            <div className="flex items-center gap-1 sm:gap-4">
              {!isPricingPage && (
                <Link href="/pricing" className="hidden md:block max-lg:landscape:hidden px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-all">
                  {t('nav.pricing')}
                </Link>
              )}
              <button
                onClick={toggleLanguage}
                className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-all"
              >
                {tc('switchLanguage')}
              </button>
              <ThemeToggleButton />
              {isAuthenticated ? (
                <Link href="/dashboard">
                  <Button size="sm" className="font-bold shadow-xl shadow-brand-500/20 px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5">
                    {tNav('dashboard')}
                  </Button>
                </Link>
              ) : (
                <Link href="/login?redirect=%2Fdashboard">
                  <Button variant="secondary" size="sm" className="font-bold border-none bg-muted whitespace-nowrap">
                    {t('nav.login')}
                  </Button>
                </Link>
              )}
              {/* Spacer to keep nav items clear of Android nav bar in landscape */}
              <div className="native-landscape-spacer" aria-hidden="true" />
            </div>
          </div>
        </div>
      </nav>

      {/* Spacer for fixed nav */}
      <div className="h-16 sm:h-20" />

      <LandingHero isAuthenticated={isAuthenticated} />

      {/* Stats Section — deep space with neon glow */}
      <StatsSection statsList={statsList} />

      <IntegrationShowcase isAuthenticated={isAuthenticated} />

      <LandingFeatures />
      <LandingHowItWorks isAuthenticated={isAuthenticated} />
      <LandingSocialProof />
      <LandingPricing />
      <LandingFAQ />
      <LandingLatestBlog posts={latestPosts} />
      <LandingFooter />

      {/* Fixed bottom safe area background (native only) */}
      <div
        className="fixed-safe-bg bottom-safe-bg landing-section-dark"
        aria-hidden="true"
      />
    </div>
    </MotionConfig>
  );
}
