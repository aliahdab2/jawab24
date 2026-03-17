import { useRef } from 'react';
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { motion, useInView } from 'framer-motion';

export function LandingSocialProof() {
  const t = useTranslations('landing');
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <section className="py-10 sm:py-16 lg:py-24 bg-brand-600 relative overflow-hidden" ref={ref}>
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <motion.div
          className="inline-flex items-center gap-1 sm:gap-2 mb-4 sm:mb-8 bg-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border border-white/20"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {[...Array(5)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, rotate: -30 }}
              animate={isInView ? { opacity: 1, rotate: 0 } : { opacity: 0, rotate: -30 }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
            >
              <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
            </motion.div>
          ))}
        </motion.div>

        <motion.h2
          className="text-lg sm:text-2xl lg:text-4xl font-display font-bold text-white mb-4 sm:mb-8 leading-relaxed italic italic-arabic px-2"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          &ldquo;{t('testimonials.quote1')}&rdquo;
        </motion.h2>

        <motion.div
          className="flex flex-col items-center"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border-2 sm:border-4 border-white/30 mb-2 sm:mb-4 shadow-xl bg-white flex items-center justify-center">
            <span className="text-brand-700 font-bold text-sm sm:text-xl select-none">AS</span>
          </div>
          <div className="text-white font-bold text-base sm:text-xl">{t('testimonials.author1')}</div>
        </motion.div>

      </div>
    </section>
  );
}
