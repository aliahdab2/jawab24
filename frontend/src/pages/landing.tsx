import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button, BrandLogo } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { BRAND_ASSETS } from '@/constants/brand';
import {
  WaitlistForm,
  SallaIcon,
  LandingHero,
  LandingFeatures,
  LandingHowItWorks,
  LandingSocialProof,
  LandingPricing,
  LandingFAQ,
  LandingFooter,
} from '@/components/landing';

export default function LandingPage() {
  const { t, language, setLanguage } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleLanguage = () => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  };

  const faqs = [
    { question: t('landing.faq.q1'), answer: t('landing.faq.a1') },
    { question: t('landing.faq.q2'), answer: t('landing.faq.a2') },
    { question: t('landing.faq.q3'), answer: t('landing.faq.a3') },
    { question: t('landing.faq.q4'), answer: t('landing.faq.a4') },
  ];

  const statsList = [
    { value: '24/7', label: t('landing.stats.available') },
    { value: '<1s', label: t('landing.stats.speed') },
  ];

  if (!mounted) {
    return null;
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-card">
      <Head>
        <title>{BRAND_ASSETS.meta.appTitle}</title>
        <meta name="description" content={t('landing.seoDescription')} />
        <link rel="canonical" href={BRAND_ASSETS.urls.canonical('/landing')} />
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

      <div className="flex-1 overflow-y-auto bg-card overflow-x-hidden relative">
        {/* Dark mode decorative background — blue glows + cubes pattern */}
        <div className="hidden dark:block fixed inset-0 pointer-events-none z-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(79,116,178,0.15),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_90%,rgba(79,116,178,0.10),transparent_60%)]" />
          <div className="absolute inset-0 bg-[url('/images/cubes.png')] opacity-[0.06]" />
        </div>

        {/* Navigation */}
        <nav
          className="fixed w-full z-50 transition-all duration-300 bg-card/80 backdrop-blur-md border-b border-theme-border pt-safe px-safe-landscape"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16 sm:h-20">
              <Link href="/landing" className="flex items-center gap-2 sm:gap-3 group">
                <BrandLogo
                  variant="main"
                  className="w-10 h-10 sm:w-12 sm:h-12 transition-transform group-hover:rotate-6 flex-shrink-0"
                />
                <span className="font-display font-bold text-xl sm:text-2xl text-foreground tracking-tight">{BRAND_ASSETS.meta.appName}</span>
              </Link>

              <div className="flex items-center gap-1 sm:gap-4">
                <Link href="/pricing" className="hidden md:block px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-all">
                  {t('landing.nav.pricing')}
                </Link>
                <button
                  onClick={toggleLanguage}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-muted-foreground hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-all"
                >
                  {t('common.switchLanguage')}
                </button>
                {isAuthenticated ? (
                  <Link href="/dashboard">
                    <Button size="sm" className="font-bold shadow-xl shadow-brand-500/20 px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5">
                      {t('nav.dashboard') || 'Dashboard'}
                    </Button>
                  </Link>
                ) : (
                  <Link href="/login?redirect=%2Fdashboard">
                    <Button variant="secondary" size="sm" className="font-bold border-none bg-muted">
                      {t('landing.nav.login')}
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </nav>

        {/* Spacer for fixed nav (includes pt-safe to match nav's safe area padding) */}
        <div className="mt-16 sm:mt-20 pt-safe" />

        <LandingHero isAuthenticated={isAuthenticated} />

        {/* Stats Section */}
        <section className="py-8 sm:py-16 landing-section-dark relative">
          <div className="absolute top-0 start-0 w-full h-1 bg-gradient-to-r from-transparent via-brand-500 to-transparent"></div>
          <div className="flex items-center justify-center gap-8 sm:gap-20 lg:gap-32 relative z-10">
            {statsList.map((stat, i) => (
              <div key={i} className="text-center group">
                <div className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-2 sm:mb-3 group-hover:scale-110 transition-transform duration-500">{stat.value}</div>
                <div className="text-brand-300 font-bold uppercase tracking-widest text-xs sm:text-sm lg:text-base">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Upcoming Integrations Section */}
        <section className="py-10 sm:py-16 bg-gradient-to-br from-background via-card to-emerald-50/30 dark:to-emerald-950/20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative rounded-2xl sm:rounded-3xl bg-card border border-theme-border shadow-xl shadow-surface-200/50 overflow-hidden">
              <div className="absolute top-0 start-0 end-0 h-1 bg-gradient-to-r from-[#96bf48] to-[#004956]" />
              <div className="p-6 sm:p-10 flex flex-col items-center text-center gap-5 sm:gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#96bf48]/10 dark:bg-[#96bf48]/20 flex items-center justify-center">
                    <ShoppingBag className="w-7 h-7 sm:w-8 sm:h-8 text-[#96bf48]" />
                  </div>
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#BAF3E6] dark:bg-[#004956] flex items-center justify-center">
                    <SallaIcon className="w-7 h-7 sm:w-8 sm:h-8 text-[#004956] dark:text-[#BAF3E6]" />
                  </div>
                </div>
                <div>
                  <h3 className="text-lg sm:text-2xl font-display font-bold text-foreground mb-2">
                    {t('landing.features.integrationsTitle')}
                  </h3>
                  <p className="text-sm sm:text-base text-muted-foreground font-medium max-w-md mx-auto">
                    {t('landing.features.integrationsDesc')}
                  </p>
                </div>
                <WaitlistForm feature="ecommerce_integrations" variant="card" />
              </div>
            </div>
          </div>
        </section>

        <LandingFeatures />
        <LandingHowItWorks isAuthenticated={isAuthenticated} />
        <LandingSocialProof />
        <LandingPricing />
        <LandingFAQ />
        <LandingFooter isAuthenticated={isAuthenticated} />

        {/* Fixed bottom safe area background (native/PWA only via --min-safe-bottom) */}
        <div
          className="fixed-safe-bg bottom-safe-bg landing-section-dark"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
