import Link from 'next/link';
import { Zap, Sparkles, Crown, Check, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';

export function LandingPricing() {
  const tPricing = useTranslations('pricing');
  const t = useTranslations('landing');

  return (
    <section id="pricing" className="py-12 sm:py-20 lg:py-32 bg-background relative overflow-hidden">
      {/* Dark mode glow — bottom-left */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -bottom-1/4 -start-1/4 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(79,116,178,0.10),transparent_70%)]" />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-8 sm:mb-16">
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full status-brand border mb-4 sm:mb-6 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
            {tPricing('description')}
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-foreground mb-3 sm:mb-6 tracking-tight">
            {tPricing('startTrial')}
          </h2>
          <p className="text-sm sm:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-4 sm:mb-10">
            {tPricing('noCreditCard')}
          </p>
        </div>

        {/* Plan Features Preview */}
        <div className="grid grid-cols-3 gap-2 sm:gap-8 mb-8 sm:mb-16 max-w-4xl mx-auto">
          {/* Starter */}
          <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 dark:hover:bg-surface-100 transition-colors">
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
          </div>

          {/* Business */}
          <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl status-brand border sm:border-2 relative">
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
          </div>

          {/* Pro */}
          <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 dark:hover:bg-surface-100 transition-colors">
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
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <Link href="/pricing">
            <Button size="lg" className="px-6 sm:px-12 py-4 sm:py-6 text-sm sm:text-lg font-bold rounded-xl sm:rounded-2xl shadow-xl shadow-brand-200 dark:shadow-brand-900/40">
              <span className="flex items-center gap-2">
                {tPricing('viewPricingDetails')}
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </span>
            </Button>
          </Link>
          <p className="text-xs sm:text-sm text-muted-foreground mt-3 sm:mt-4">
            {t('cta.note')}
          </p>
        </div>
      </div>
    </section>
  );
}
