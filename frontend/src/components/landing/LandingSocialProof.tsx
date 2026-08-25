import { useRef } from 'react';
import Image from 'next/image';
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { motion, useInView } from 'framer-motion';
import { EASE_OUT, DUR } from '@/constants/motion';

export function LandingSocialProof() {
  const t = useTranslations('landing');
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-60px' });

  // Fleet-wide figures, NOT the quoted author's. They sit under their own scope
  // caption for that reason — presenting an aggregate directly beneath a named
  // testimonial reads as that one customer's result, which is the very thing the
  // aggregate exists to replace.
  const stats = [
    { value: t('testimonials.stat1Value'), label: t('testimonials.stat1Label') },
    { value: t('testimonials.stat2Value'), label: t('testimonials.stat2Label') },
    { value: t('testimonials.stat3Value'), label: t('testimonials.stat3Label') },
  ];

  return (
    <section className="py-8 sm:py-12 bg-brand-600 relative overflow-hidden" ref={ref}>
      <div className="absolute inset-0 bg-[url('/images/cubes-texture.png')] opacity-10"></div>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center relative z-10">
        <motion.div
          className="inline-flex items-center gap-1 mb-3 bg-white/10 px-3 py-1 rounded-full border border-white/20"
          initial={{ opacity: 1, scale: 0.97 }}
          animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 0.97 }}
          transition={{ duration: DUR.section, ease: EASE_OUT }}
        >
          {[...Array(5)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 1, rotate: -30 }}
              animate={isInView ? { opacity: 1, rotate: 0 } : { opacity: 1, rotate: -30 }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
            >
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          className="text-base sm:text-lg lg:text-xl font-display text-white mb-3 leading-relaxed italic italic-arabic px-2"
          initial={{ opacity: 1, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 1, y: 20 }}
          transition={{ duration: DUR.section, delay: 0.2, ease: EASE_OUT }}
        >
          &ldquo;{t('testimonials.quote1')}&rdquo;
        </motion.p>

        <motion.div
          className="flex items-center justify-center gap-2 sm:gap-3 text-white/90 text-xs sm:text-sm mb-5"
          initial={{ opacity: 1, y: 10 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 1, y: 10 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <a
            href={t('testimonials.authorUrl1')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 group"
          >
            <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden bg-white/10 border border-white/20 shrink-0">
              <Image
                src="/images/testimonials/damascene-team.png"
                alt={t('testimonials.author1')}
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            </span>
            <span className="font-bold underline decoration-white/30 underline-offset-4 group-hover:decoration-white transition">
              {t('testimonials.author1')}
            </span>
          </a>
        </motion.div>

        <p className="text-white/70 text-[10px] sm:text-xs mb-2">
          {t('testimonials.statsScope')}
        </p>

        <motion.div
          className="grid grid-cols-3 gap-2 sm:gap-3 max-w-lg mx-auto"
          initial={{ opacity: 1, y: 10 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 1, y: 10 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          {stats.map((stat, i) => (
            <div
              key={i}
              className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg px-2 py-2 sm:py-3"
            >
              <div className="text-base sm:text-xl font-display font-bold text-white">
                {stat.value}
              </div>
              <div className="text-white/75 text-[10px] sm:text-xs leading-tight mt-0.5">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        <p className="text-white/50 text-[10px] sm:text-xs mt-3">
          {t('testimonials.disclaimer')}
        </p>
      </div>
    </section>
  );
}
