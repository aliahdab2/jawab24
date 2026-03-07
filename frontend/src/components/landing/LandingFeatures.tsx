import {
  Bot,
  Instagram,
  Languages,
  Zap,
  BookOpen,
  ShoppingBag,
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
    { icon: ShoppingBag, title: t('landing.features.ecommerceTitle'), description: t('landing.features.ecommerceDesc') },
  ];

  return (
    <section id="features" className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative overflow-hidden">
      {/* Dark mode glow — top-left */}
      <div className="hidden dark:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-1/4 -start-1/4 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(79,116,178,0.12),transparent_70%)]" />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-8 sm:mb-16 lg:mb-24">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-foreground mb-3 sm:mb-6 tracking-tight">
            {t('landing.features.sectionTitle')}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-10">
          {features.map((feature, i) => (
            <div
              key={i}
              className="group bg-card rounded-2xl sm:rounded-3xl p-5 sm:p-8 lg:p-10 shadow-lg sm:shadow-xl shadow-surface-200/50 hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 border border-theme-border flex flex-col items-center text-center"
            >
              <div className="w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-xl sm:rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4 sm:mb-6 lg:mb-8 group-hover:bg-brand-600 group-hover:text-white transition-colors duration-500 shadow-inner">
                <feature.icon className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground mb-2 sm:mb-4">{feature.title}</h3>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed font-medium">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
