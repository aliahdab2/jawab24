import Link from 'next/link';
import { MessageCircle, Facebook, Mail, Zap, Clock } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { BrandLogo } from '@/components/ui';
import { BRAND_ASSETS } from '@/constants/brand';

interface LandingFooterProps {
  isAuthenticated: boolean;
}

export function LandingFooter({ isAuthenticated }: LandingFooterProps) {
  const { t } = useTranslation();

  return (
    <footer className="bg-surface-900 text-white pt-10 sm:pt-16 lg:pt-24 pb-8 sm:pb-12 relative overflow-hidden">
      <div className="absolute bottom-0 end-0 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-brand-500/5 rounded-full blur-[80px] sm:blur-[120px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-16 mb-10 sm:mb-20">
          <div className="col-span-2">
            <Link href="/landing" className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-8 group">
              <BrandLogo
                variant="main"
                className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0"
              />
              <span className="font-display font-bold text-xl sm:text-2xl tracking-tight">{BRAND_ASSETS.meta.appName}</span>
            </Link>
            <p className="text-surface-400 text-sm sm:text-lg max-w-sm mb-6 sm:mb-10 leading-relaxed font-medium">
              {t('landing.footer.description')}
            </p>
            <div className="flex items-center gap-3 sm:gap-4">
              <a
                href={`https://wa.me/46700224720?text=${encodeURIComponent(t('landing.footer.whatsappMessage' as TranslationKey))}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('landing.footer.whatsappAriaLabel' as TranslationKey)}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-[#25D366]/10 flex items-center justify-center hover:bg-[#25D366] transition-colors border border-[#25D366]/20 group"
              >
                <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#25D366] group-hover:text-white group-hover:scale-110 transition-all" aria-hidden="true" />
              </a>
              <a
                href="https://facebook.com/jawab24app"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('landing.footer.facebookAriaLabel' as TranslationKey)}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-[#1877F2]/10 flex items-center justify-center hover:bg-[#1877F2] transition-colors border border-[#1877F2]/20 group"
              >
                <Facebook className="w-4 h-4 sm:w-5 sm:h-5 text-[#1877F2] group-hover:text-white group-hover:scale-110 transition-all" aria-hidden="true" />
              </a>
              <a
                href="mailto:support@jawab24.com"
                aria-label={t('landing.footer.emailAriaLabel' as TranslationKey)}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center hover:bg-brand-600 transition-colors border border-white/10 group"
              >
                <Mail className="w-4 h-4 sm:w-5 sm:h-5 group-hover:scale-110 transition-transform" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{t('landing.footer.quickLinks')}</h3>
            <ul className="space-y-2 sm:space-y-4 font-medium text-sm sm:text-base">
              <li><Link href="/pricing" className="text-surface-400 hover:text-brand-400 transition-colors">{t('landing.footer.pricingPlans')}</Link></li>
              <li><Link href={isAuthenticated ? "/dashboard" : "/login?redirect=%2Fdashboard"} className="text-surface-400 hover:text-brand-400 transition-colors">{isAuthenticated ? (t('nav.dashboard') || 'Dashboard') : t('landing.footer.startTrial')}</Link></li>
              <li><Link href="/terms" className="text-surface-400 hover:text-brand-400 transition-colors">{t('landing.footer.termsOfService')}</Link></li>
              <li><Link href="/privacy" className="text-surface-400 hover:text-brand-400 transition-colors">{t('landing.footer.privacyPolicy')}</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{t('landing.footer.support')}</h3>
            <ul className="space-y-2 sm:space-y-4 font-medium text-sm sm:text-base">
              <li className="text-surface-400 flex items-center gap-2 sm:gap-3">
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-white/5 flex items-center justify-center text-brand-400 flex-shrink-0">
                  <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                </div>
                <span className="text-[11px] sm:text-base whitespace-nowrap">support@jawab24.com</span>
              </li>
              <li className="text-surface-400 flex items-center gap-2 sm:gap-3">
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-white/5 flex items-center justify-center text-brand-400">
                  <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                </div>
                <span className="text-xs sm:text-base">{t('landing.footer.responseTime')}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 sm:pt-12 border-t border-white/10 flex items-center justify-start pb-safe">
          <div className="text-surface-500 font-bold text-xs sm:text-sm tracking-widest uppercase text-start" dir="ltr">
            © {new Date().getFullYear()} Jawab24. {t('landing.footer.copyright')}
          </div>
        </div>
      </div>
    </footer>
  );
}
