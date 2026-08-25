import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
// Direct import, NOT the '@/components/ui' barrel — see LandingPageContent.
import { Button } from '@/components/ui/Button';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { isRTLLocale } from '@/utils/locale';
import { EASE_OUT, DUR, STAGGER } from '@/constants/motion';

interface LandingHowItWorksProps {
  isAuthenticated: boolean;
}

function makeStepVariants(rtl: boolean) {
  return {
    hidden: { opacity: 1, x: rtl ? 30 : -30 },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: {
        delay: i * STAGGER,
        duration: DUR.section,
        ease: EASE_OUT,
      },
    }),
  };
}

const imageVariants = {
  hidden: { opacity: 1, scale: 0.9, rotate: 4 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 2,
    transition: { duration: DUR.section, ease: EASE_OUT, delay: 0.3 },
  },
};

const headingVariants = {
  hidden: { opacity: 1, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.section, ease: EASE_OUT },
  },
};

export function LandingHowItWorks({ isAuthenticated }: LandingHowItWorksProps) {
  const t = useTranslations('landing');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  const stepVariants = makeStepVariants(isRTL);

  const howItWorks = [
    { step: '1', title: t('howItWorks.step1Title'), description: t('howItWorks.step1Desc') },
    { step: '2', title: t('howItWorks.step2Title'), description: t('howItWorks.step2Desc') },
    { step: '3', title: t('howItWorks.step3Title'), description: t('howItWorks.step3Desc') },
  ];

  return (
    <section className="py-12 sm:py-20 lg:py-32 bg-background relative overflow-hidden" ref={ref}>
      {/* Subtle background depth */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/3 end-0 w-[400px] h-[400px] rounded-full opacity-30 landing-glow-emerald" />
      </div>

      {/* Dark mode glow — center-right */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 -end-1/4 w-[600px] h-[600px] landing-dark-glow" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Steps */}
          <div className="space-y-4 sm:space-y-8">
            <motion.h2
              className="text-xl sm:text-4xl lg:text-5xl font-display font-extrabold text-foreground mb-4 sm:mb-8 leading-relaxed text-start"
              variants={headingVariants}
              initial="hidden"
              animate={isInView ? 'visible' : 'hidden'}
            >
              {t('howItWorks.title1')}
              <span className="block text-brand-600 mt-2">{t('howItWorks.title2')}</span>
            </motion.h2>

            <div className="space-y-3 sm:space-y-6 lg:space-y-10 relative">
              {/* Connecting line */}
              <div
                className="absolute start-4 sm:start-6 top-10 sm:top-14 bottom-4 w-px hidden sm:block"
                style={{ background: 'linear-gradient(to bottom, rgba(16,185,129,0.3), rgba(16,185,129,0.05))' }}
                aria-hidden="true"
              />

              {howItWorks.map((item, i) => (
                <motion.div
                  key={i}
                  className="flex flex-row gap-3 sm:gap-6 items-start relative"
                  variants={stepVariants}
                  custom={i}
                  initial="hidden"
                  animate={isInView ? 'visible' : 'hidden'}
                >
                  <div className="flex-shrink-0 w-8 h-8 sm:w-12 sm:h-12 rounded-lg sm:rounded-2xl bg-brand-600 text-white flex items-center justify-center text-sm sm:text-2xl font-bold shadow-lg shadow-brand-200 relative z-10">
                    {item.step}
                  </div>
                  <div className="text-start">
                    <h3 className="text-sm sm:text-xl font-bold text-foreground mb-1 sm:mb-2">{item.title}</h3>
                    <p className="text-[10px] sm:text-base text-muted-foreground font-medium leading-relaxed">{item.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div
              className="text-start"
              variants={stepVariants}
              custom={3}
              initial="hidden"
              animate={isInView ? 'visible' : 'hidden'}
            >
              <Link href={isAuthenticated ? "/dashboard" : "/login?redirect=%2Fdashboard"} className="inline-block mt-4 sm:mt-12">
                {/* Grows on a transform, not on `px`. `hover:px-12` animated
                    horizontal padding, which runs layout + paint + composite
                    every frame and reflowed the button's whole row; it also
                    disagreed with the hero CTA, which already scales. */}
                <Button size="lg" className="rounded-xl sm:rounded-2xl px-4 sm:px-10 py-3 sm:py-7 text-sm sm:text-lg font-bold shadow-xl shadow-brand-500/20 transition-transform duration-200 hoverable:scale-[1.03]">
                  <span className="flex items-center gap-2">
                    {isAuthenticated ? (tNav('dashboard') || 'Dashboard') : t('howItWorks.cta')}
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 rtl:rotate-180" />
                  </span>
                </Button>
              </Link>
            </motion.div>
          </div>

          {/* Dashboard Preview */}
          <motion.div
            className="relative hidden sm:block"
            variants={imageVariants}
            initial="hidden"
            animate={isInView ? 'visible' : 'hidden'}
          >
            <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-xl sm:shadow-2xl border-2 sm:border-8 border-surface-900/5 rotate-2 group hoverable:rotate-0 transition-transform duration-300 bg-surface-50">
              <Image
                src="/images/social-icons-3d.png"
                alt={t('images.dashboardPreview')}
                width={1200}
                height={675}
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-900/20 to-transparent"></div>
            </div>
            <div className="absolute -top-5 sm:-top-10 -end-5 sm:-end-10 w-16 sm:w-32 h-16 sm:h-32 bg-accent-100 rounded-full -z-10 blur-xl sm:blur-2xl"></div>
            <div className="absolute -bottom-5 sm:-bottom-10 -start-5 sm:-start-10 w-20 sm:w-40 h-20 sm:h-40 bg-brand-100 rounded-full -z-10 blur-xl sm:blur-3xl"></div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
