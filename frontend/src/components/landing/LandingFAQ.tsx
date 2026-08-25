import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { EASE_OUT, DUR } from '@/constants/motion';

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 1, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
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

export function LandingFAQ() {
  const t = useTranslations('landing');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });

  const faqs = [
    { question: t('faq.q1'), answer: t('faq.a1') },
    { question: t('faq.q2'), answer: t('faq.a2') },
    { question: t('faq.q3'), answer: t('faq.a3') },
    { question: t('faq.q4'), answer: t('faq.a4') },
    { question: t('faq.q5'), answer: t('faq.a5') },
  ];

  return (
    <section className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative overflow-hidden" ref={ref}>
      {/* Subtle background depth */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 start-0 w-[400px] h-[400px] rounded-full opacity-30 landing-glow-violet" />
      </div>

      {/* Dark mode glow — top-right */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-1/4 -end-1/4 w-[500px] h-[500px] landing-dark-glow-soft" />
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          className="text-center mb-8 sm:mb-20"
          variants={headingVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          <h2 className="text-2xl sm:text-4xl font-display font-extrabold text-foreground mb-2 sm:mb-4">
            {t('faq.title')}
          </h2>
        </motion.div>

        <motion.div
          className="space-y-3 sm:space-y-4"
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              variants={itemVariants}
              className={`bg-card rounded-2xl sm:rounded-3xl border-2 transition-all duration-300 overflow-hidden ${openFaq === i ? 'border-brand-500 shadow-xl shadow-brand-100' : 'border-transparent shadow-sm hover:border-theme-border'
                }`}
            >
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full px-4 sm:px-8 py-4 sm:py-6 text-start flex items-center justify-between group"
              >
                <span className={`font-bold text-sm sm:text-lg transition-colors rtl:text-start ${openFaq === i ? 'text-brand-600' : 'text-foreground group-hover:text-brand-600'}`}>
                  {faq.question}
                </span>
                <motion.div
                  className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ms-2 ${openFaq === i ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-400 group-hover:bg-brand-100 group-hover:text-brand-600'}`}
                  animate={{ rotate: openFaq === i ? 180 : 0 }}
                  transition={{ duration: DUR.dropdown, ease: EASE_OUT }}
                >
                  <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {openFaq === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: DUR.dropdown, ease: EASE_OUT }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 sm:px-8 pb-4 sm:pb-8 text-sm sm:text-base text-muted-foreground font-medium leading-relaxed">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
