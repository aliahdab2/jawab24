import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function LandingFAQ() {
  const t = useTranslations('landing');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const faqs = [
    { question: t('faq.q1'), answer: t('faq.a1') },
    { question: t('faq.q2'), answer: t('faq.a2') },
    { question: t('faq.q3'), answer: t('faq.a3') },
    { question: t('faq.q4'), answer: t('faq.a4') },
    { question: t('faq.q5'), answer: t('faq.a5') },
  ];

  return (
    <section className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative overflow-hidden">
      {/* Dark mode glow — top-right */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-1/4 -end-1/4 w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(79,116,178,0.08),transparent_70%)]" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-8 sm:mb-20">
          <h2 className="text-2xl sm:text-4xl font-display font-extrabold text-foreground mb-2 sm:mb-4">
            {t('faq.title')}
          </h2>
        </div>

        <div className="space-y-3 sm:space-y-4">
          {faqs.map((faq, i) => (
            <div
              key={i}
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
                <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ms-2 ${openFaq === i ? 'bg-brand-600 text-white rotate-180' : 'bg-surface-100 text-surface-400 group-hover:bg-brand-100 group-hover:text-brand-600'}`}>
                  <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
              </button>
              {openFaq === i && (
                <div className="px-4 sm:px-8 pb-4 sm:pb-8 text-sm sm:text-base text-muted-foreground font-medium leading-relaxed animate-slide-up">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
