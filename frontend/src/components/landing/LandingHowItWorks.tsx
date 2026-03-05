import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui';

interface LandingHowItWorksProps {
  isAuthenticated: boolean;
}

export function LandingHowItWorks({ isAuthenticated }: LandingHowItWorksProps) {
  const { t } = useTranslation();

  const howItWorks = [
    { step: '1', title: t('landing.howItWorks.step1Title'), description: t('landing.howItWorks.step1Desc') },
    { step: '2', title: t('landing.howItWorks.step2Title'), description: t('landing.howItWorks.step2Desc') },
    { step: '3', title: t('landing.howItWorks.step3Title'), description: t('landing.howItWorks.step3Desc') },
  ];

  return (
    <section className="py-12 sm:py-20 lg:py-32 bg-background relative overflow-hidden">
      {/* Dark mode glow — center-right */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 -end-1/4 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(79,116,178,0.10),transparent_70%)]" />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 gap-4 sm:gap-8 lg:gap-16 items-center">
          {/* Steps */}
          <div className="space-y-4 sm:space-y-8 col-span-1">
            <h2 className="text-xl sm:text-4xl lg:text-5xl font-display font-extrabold text-foreground mb-4 sm:mb-8 leading-relaxed text-start">
              {t('landing.howItWorks.title1')}
              <span className="block text-brand-600 mt-2">{t('landing.howItWorks.title2')}</span>
            </h2>
            <div className="space-y-3 sm:space-y-6 lg:space-y-10">
              {howItWorks.map((item, i) => (
                <div key={i} className="flex flex-row gap-3 sm:gap-6 items-start">
                  <div className="flex-shrink-0 w-8 h-8 sm:w-12 sm:h-12 rounded-lg sm:rounded-2xl bg-brand-600 text-white flex items-center justify-center text-sm sm:text-2xl font-bold shadow-lg shadow-brand-200">
                    {item.step}
                  </div>
                  <div className="text-start">
                    <h3 className="text-sm sm:text-xl font-bold text-foreground mb-1 sm:mb-2">{item.title}</h3>
                    <p className="text-[10px] sm:text-base text-muted-foreground font-medium leading-relaxed">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-start">
              <Link href={isAuthenticated ? "/dashboard" : "/login?redirect=%2Fdashboard"} className="inline-block mt-4 sm:mt-12">
                <Button size="lg" className="rounded-xl sm:rounded-2xl px-4 sm:px-10 py-3 sm:py-7 text-sm sm:text-lg font-bold shadow-xl shadow-brand-500/20 transition-all hover:px-12">
                  <span className="flex items-center gap-2">
                    {isAuthenticated ? (t('nav.dashboard') || 'Dashboard') : t('landing.howItWorks.cta')}
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </span>
                </Button>
              </Link>
            </div>
          </div>

          {/* Dashboard Preview */}
          <div className="relative col-span-1 pt-8 sm:pt-0">
            <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-xl sm:shadow-2xl border-2 sm:border-8 border-surface-900/5 rotate-2 group hover:rotate-0 transition-transform duration-700 bg-surface-50">
              <Image
                src="/images/social-icons-3d.png"
                alt={t('landing.images.dashboardPreview' as TranslationKey) as string}
                width={1200}
                height={675}
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-900/20 to-transparent"></div>
            </div>
            <div className="absolute -top-5 sm:-top-10 -end-5 sm:-end-10 w-16 sm:w-32 h-16 sm:h-32 bg-accent-100 rounded-full -z-10 blur-xl sm:blur-2xl"></div>
            <div className="absolute -bottom-5 sm:-bottom-10 -start-5 sm:-start-10 w-20 sm:w-40 h-20 sm:h-40 bg-brand-100 rounded-full -z-10 blur-xl sm:blur-3xl"></div>
          </div>
        </div>
      </div>
    </section>
  );
}
