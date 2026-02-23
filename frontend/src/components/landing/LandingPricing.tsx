import Link from 'next/link';
import { Zap, Sparkles, Crown, Check, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';

export function LandingPricing() {
  const { t } = useTranslation();

  return (
    <section id="pricing" className="py-12 sm:py-20 lg:py-32 bg-white relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8 sm:mb-16">
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-brand-50 text-brand-600 border border-brand-100 mb-4 sm:mb-6 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
            {t('pricing.description')}
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-3 sm:mb-6 tracking-tight">
            {t('pricing.startTrial')}
          </h2>
          <p className="text-sm sm:text-lg lg:text-xl text-surface-600 max-w-2xl mx-auto leading-relaxed mb-4 sm:mb-10">
            {t('pricing.noCreditCard')}
          </p>
        </div>

        {/* Plan Features Preview */}
        <div className="grid grid-cols-3 gap-2 sm:gap-8 mb-8 sm:mb-16 max-w-4xl mx-auto">
          {/* Starter */}
          <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 transition-colors">
            <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <Zap className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{t('pricing.starter')}</h3>
            <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
              {t('pricing.starterDesc')}
            </p>
            <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
              <li><Check className="w-3 h-3 inline-block" /> {t('pricing.starterFeature1')}</li>
              <li className="hidden sm:block"><Check className="w-3 h-3 inline-block" /> {t('pricing.starterFeature2')}</li>
              <li><Check className="w-3 h-3 inline-block" /> {t('pricing.starterFeature3')}</li>
            </ul>
          </div>

          {/* Business */}
          <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl bg-brand-50 border sm:border-2 border-brand-200 relative">
            <div className="absolute -top-2 sm:-top-3 left-1/2 -translate-x-1/2 px-2 sm:px-3 py-0.5 sm:py-1 bg-brand-700 text-white text-[10px] sm:text-xs font-bold rounded-full whitespace-nowrap">
              {t('pricing.popular')}
            </div>
            <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center mt-2 sm:mt-0">
              <Sparkles className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{t('pricing.business')}</h3>
            <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
              {t('pricing.businessDesc')}
            </p>
            <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
              <li><Check className="w-3 h-3 inline-block" /> {t('pricing.businessFeature1')}</li>
              <li className="hidden sm:block"><Check className="w-3 h-3 inline-block" /> {t('pricing.businessFeature2')}</li>
              <li><Check className="w-3 h-3 inline-block" /> {t('pricing.businessFeature3')}</li>
            </ul>
          </div>

          {/* Pro */}
          <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 transition-colors">
            <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center">
              <Crown className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{t('pricing.pro')}</h3>
            <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
              {t('pricing.proDesc')}
            </p>
            <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
              <li><Check className="w-3 h-3 inline-block" /> {t('pricing.proFeature1')}</li>
              <li className="hidden sm:block"><Check className="w-3 h-3 inline-block" /> {t('pricing.proFeature2')}</li>
              <li><Check className="w-3 h-3 inline-block" /> {t('pricing.proFeature3')}</li>
            </ul>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <Link href="/pricing">
            <Button size="lg" className="px-6 sm:px-12 py-4 sm:py-6 text-sm sm:text-lg font-bold rounded-xl sm:rounded-2xl shadow-xl shadow-brand-200">
              <span className="flex items-center gap-2">
                {t('pricing.viewPricingDetails')}
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </span>
            </Button>
          </Link>
          <p className="text-xs sm:text-sm text-surface-600 mt-3 sm:mt-4">
            {t('landing.cta.note')}
          </p>
        </div>
      </div>
    </section>
  );
}
