import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function LandingSocialProof() {
  const t = useTranslations('landing');

  return (
    <section className="py-10 sm:py-16 lg:py-24 bg-brand-600 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <div className="inline-flex items-center gap-1 sm:gap-2 mb-4 sm:mb-8 bg-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border border-white/20">
          <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
          <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
          <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
          <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
          <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
        </div>
        <h2 className="text-lg sm:text-2xl lg:text-4xl font-display font-bold text-white mb-4 sm:mb-8 leading-relaxed italic italic-arabic px-2">
          &ldquo;{t('testimonials.quote1')}&rdquo;
        </h2>
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border-2 sm:border-4 border-white/30 mb-2 sm:mb-4 shadow-xl bg-white flex items-center justify-center">
            <span className="text-brand-700 font-bold text-sm sm:text-xl select-none">AS</span>
          </div>
          <div className="text-white font-bold text-base sm:text-xl">{t('testimonials.author1')}</div>
        </div>
      </div>
    </section>
  );
}
