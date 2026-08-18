import { useRef } from 'react';
import Link from 'next/link';
import { Zap, Sparkles, Crown, Check, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
// Direct import, NOT the '@/components/ui' barrel — see LandingPageContent.
import { Button } from '@/components/ui/Button';
import { motion, useInView } from 'framer-motion';

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15 },
  },
};

const cardVariants = {
  hidden: { opacity: 1, y: 30, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

const headingVariants = {
  hidden: { opacity: 1, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function LandingPricing() {
  const tPricing = useTranslations('pricing');
  const t = useTranslations('landing');
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="pricing" className="py-12 sm:py-20 lg:py-32 bg-background relative overflow-hidden" ref={ref}>
      {/* Dark mode glow — bottom-left */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -bottom-1/4 -start-1/4 w-[600px] h-[600px] landing-dark-glow" />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          className="text-center mb-8 sm:mb-16"
          variants={headingVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full status-brand border mb-4 sm:mb-6 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
            {tPricing('description')}
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-foreground mb-3 sm:mb-6 tracking-tight">
            {tPricing('startTrial')}
          </h2>
          <p className="text-sm sm:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-4 sm:mb-10">
            {tPricing('noCreditCard')}
          </p>
        </motion.div>

        {/* Plan Features Preview */}
        <motion.div
          className="grid grid-cols-3 gap-2 sm:gap-8 mb-8 sm:mb-16 max-w-4xl mx-auto"
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          {/* Starter */}
          <motion.div variants={cardVariants} className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 dark:hover:bg-surface-100 transition-colors">
            <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl icon-bg-blue flex items-center justify-center">
              <Zap className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <h3 className="text-sm sm:text-lg font-bold text-foreground mb-1 sm:mb-2">{tPricing('starter')}</h3>
            <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
              {tPricing('starterDesc')}
            </p>
            <ul className="text-[10px] sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
              <li><Check className="w-3 h-3 inline-block" /> {tPricing('starterFeature1')}</li>
              <li className="hidden sm:block"><Check className="w-3 h-3 inline-block" /> {tPricing('starterFeature2')}</li>
              <li><Check className="w-3 h-3 inline-block" /> {tPricing('starterFeature3')}</li>
            </ul>
          </motion.div>

          {/* Business */}
          <motion.div variants={cardVariants} className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl status-brand border sm:border-2 relative">
            <div className="absolute -top-2 sm:-top-3 left-1/2 -translate-x-1/2 px-2 sm:px-3 py-0.5 sm:py-1 bg-brand-700 text-white text-[10px] sm:text-xs font-bold rounded-full whitespace-nowrap">
              {tPricing('popular')}
            </div>
            <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center mt-2 sm:mt-0">
              <Sparkles className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <h3 className="text-sm sm:text-lg font-bold text-foreground mb-1 sm:mb-2">{tPricing('business')}</h3>
            <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
              {tPricing('businessDesc')}
            </p>
            <ul className="text-[10px] sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
              <li><Check className="w-3 h-3 inline-block" /> {tPricing('businessFeature1')}</li>
              <li className="hidden sm:block"><Check className="w-3 h-3 inline-block" /> {tPricing('businessFeature2')}</li>
              <li><Check className="w-3 h-3 inline-block" /> {tPricing('businessFeature3')}</li>
            </ul>
          </motion.div>

          {/* Pro */}
          <motion.div variants={cardVariants} className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 dark:hover:bg-surface-100 transition-colors">
            <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl icon-bg-violet flex items-center justify-center">
              <Crown className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <h3 className="text-sm sm:text-lg font-bold text-foreground mb-1 sm:mb-2">{tPricing('pro')}</h3>
            <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
              {tPricing('proDesc')}
            </p>
            <ul className="text-[10px] sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
              <li><Check className="w-3 h-3 inline-block" /> {tPricing('proFeature1')}</li>
              <li className="hidden sm:block"><Check className="w-3 h-3 inline-block" /> {tPricing('proFeature2')}</li>
              <li><Check className="w-3 h-3 inline-block" /> {tPricing('proFeature3')}</li>
            </ul>
          </motion.div>
        </motion.div>

        {/* Post Replies — included in every plan, spans the whole grid */}
        <motion.div
          className="text-center mb-8 sm:mb-12"
          initial={{ opacity: 1, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 1, y: 20 }}
          transition={{ duration: 0.5, delay: 0.45 }}
        >
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full status-brand border text-xs sm:text-sm font-semibold">
            <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {tPricing('postRepliesIncludedNote')}
          </span>
        </motion.div>

        {/* CTA */}
        <motion.div
          className="text-center"
          initial={{ opacity: 1, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 1, y: 20 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <Link href="/pricing">
            <Button size="lg" className="px-6 sm:px-12 py-4 sm:py-6 text-sm sm:text-lg font-bold rounded-xl sm:rounded-2xl shadow-xl shadow-brand-200 dark:shadow-brand-900/40">
              <span className="flex items-center gap-2">
                {tPricing('viewPricingDetails')}
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 rtl:rotate-180" />
              </span>
            </Button>
          </Link>
          <p className="text-xs sm:text-sm text-muted-foreground mt-3 sm:mt-4">
            {t('cta.note')}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
