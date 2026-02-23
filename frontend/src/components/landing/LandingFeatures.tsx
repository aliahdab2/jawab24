import {
  Bot,
  Instagram,
  Languages,
  Zap,
  BookOpen,
  Smartphone,
} from 'lucide-react';
import { useTranslation } from '@/i18n';

export function LandingFeatures() {
  const { t } = useTranslation();

  const features = [
    { icon: Bot, title: t('landing.features.aiTitle'), description: t('landing.features.aiDesc') },
    { icon: Instagram, title: t('landing.features.platformsTitle'), description: t('landing.features.platformsDesc') },
    { icon: Languages, title: t('landing.features.languageTitle'), description: t('landing.features.languageDesc') },
    { icon: Zap, title: t('landing.features.instantTitle'), description: t('landing.features.instantDesc') },
    { icon: BookOpen, title: t('landing.features.knowledgeTitle'), description: t('landing.features.knowledgeDesc') },
    { icon: Smartphone, title: t('landing.features.mobileTitle'), description: t('landing.features.mobileDesc') },
  ];

  return (
    <section id="features" className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8 sm:mb-16 lg:mb-24">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-3 sm:mb-6 tracking-tight">
            {t('landing.features.sectionTitle')}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-10">
          {features.map((feature, i) => (
            <div
              key={i}
              className="group bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 lg:p-10 shadow-lg sm:shadow-xl shadow-surface-200/50 hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 border border-surface-100 flex flex-col items-center text-center"
            >
              <div className="w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-xl sm:rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4 sm:mb-6 lg:mb-8 group-hover:bg-brand-600 group-hover:text-white transition-colors duration-500 shadow-inner">
                <feature.icon className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-surface-900 mb-2 sm:mb-4">{feature.title}</h3>
              <p className="text-sm sm:text-base text-surface-600 leading-relaxed font-medium">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
