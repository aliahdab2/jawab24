import {
  Bot,
  Instagram,
  Languages,
  Zap,
  BookOpen,
  ShoppingBag,
} from 'lucide-react';
import { PostReplyIcon } from '@/utils/postReply';
import { useTranslations } from 'next-intl';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { EASE_OUT, DUR, STAGGER } from '@/constants/motion';

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: STAGGER },
  },
};

const cardVariants = {
  hidden: { opacity: 1, y: 40, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: DUR.section, ease: EASE_OUT },
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

export function LandingFeatures() {
  const t = useTranslations('landing');
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });

  const features = [
    { icon: Bot, title: t('features.aiTitle'), description: t('features.aiDesc') },
    { icon: Instagram, title: t('features.platformsTitle'), description: t('features.platformsDesc') },
    { icon: Languages, title: t('features.languageTitle'), description: t('features.languageDesc') },
    { icon: Zap, title: t('features.instantTitle'), description: t('features.instantDesc') },
    { icon: BookOpen, title: t('features.knowledgeTitle'), description: t('features.knowledgeDesc') },
    { icon: ShoppingBag, title: t('features.ecommerceTitle'), description: t('features.ecommerceDesc') },
    { icon: PostReplyIcon, title: t('features.postReplyTitle'), description: t('features.postReplyDesc') },
  ];

  // Accent colors per card for icon backgrounds
  const accents = [
    'bg-brand-50 text-brand-600 group-hover:bg-brand-600',
    'bg-pink-50 text-pink-600 group-hover:bg-pink-600',
    'bg-violet-50 text-violet-600 group-hover:bg-violet-600',
    'bg-amber-50 text-amber-600 group-hover:bg-amber-600',
    'bg-sky-50 text-sky-600 group-hover:bg-sky-600',
    'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600',
    'bg-rose-50 text-rose-600 group-hover:bg-rose-600',
  ];

  return (
    <section id="features" className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative overflow-hidden" ref={ref}>
      {/* Layered background — subtle mesh gradient */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 start-1/4 w-[600px] h-[600px] rounded-full opacity-40 landing-glow-cyan" />
        <div className="absolute bottom-0 end-1/4 w-[500px] h-[500px] rounded-full opacity-40 landing-glow-violet" />
      </div>

      {/* Dark mode glow — top-left */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-1/4 -start-1/4 w-[600px] h-[600px] landing-dark-glow-strong" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          className="text-center mb-8 sm:mb-16 lg:mb-24"
          variants={headingVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-foreground mb-3 sm:mb-6 tracking-tight">
            {t('features.sectionTitle')}
          </h2>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-10"
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          {features.map((feature, i) => (
            <motion.div
              key={i}
              variants={cardVariants}
              className="group bg-card rounded-2xl sm:rounded-3xl p-5 sm:p-8 lg:p-10 shadow-lg sm:shadow-xl shadow-surface-200/50 hoverable:shadow-2xl hoverable:-translate-y-2 transition-[transform,box-shadow] duration-200 border border-theme-border flex flex-col items-center text-center"
            >
              <div className={`w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-xl sm:rounded-2xl ${accents[i]} group-hover:text-white flex items-center justify-center mb-4 sm:mb-6 lg:mb-8 transition-colors duration-500 shadow-inner`}>
                <feature.icon className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground mb-2 sm:mb-4">{feature.title}</h3>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed font-medium">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
