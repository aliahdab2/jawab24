import Image from 'next/image';
import Link from 'next/link';
import { MessageCircle, Facebook, Mail, Zap, Clock, Phone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
// Direct import, NOT the '@/components/ui' barrel — see LandingPageContent.
import { BrandLogo } from '@/components/ui/BrandLogo';
import { BRAND_ASSETS } from '@/constants/brand';
import { isRTLLocale } from '@/utils/locale';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

export function LandingFooter() {
  const t = useTranslations('landing');
  const tDataDeletion = useTranslations('dataDeletion');
  const locale = useLocale();
  const playBadgeSrc = isRTLLocale(locale)
    ? '/badges/google-play-ar.png'
    : '/badges/google-play-en.png';

  return (
    <footer className="landing-section-dark dark:bg-surface-50 pt-10 sm:pt-16 lg:pt-24 pb-8 sm:pb-12 relative overflow-hidden">
      <div className="absolute bottom-0 end-0 w-[400px] sm:w-[700px] h-[400px] sm:h-[700px] bg-brand-500/5 rounded-full blur-[40px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-16 mb-10 sm:mb-20">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-8 group">
              <BrandLogo
                variant="main"
                className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0"
              />
              <span className="font-display font-bold text-xl sm:text-2xl tracking-tight">{BRAND_ASSETS.meta.appName}</span>
            </Link>
            <p className="text-surface-400 text-sm sm:text-lg max-w-sm mb-6 sm:mb-10 leading-relaxed font-medium">
              {t('footer.description')}
            </p>
            <div className="flex items-center gap-3 sm:gap-4">
              <a
                href={buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, t('footer.whatsappMessage'))}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('footer.whatsappAriaLabel')}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-[#25D366]/10 flex items-center justify-center hover:bg-[#25D366] transition-colors border border-[#25D366]/20 group"
              >
                <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#25D366] group-hover:text-white group-hoverable:scale-110 transition-[transform,color] duration-200" aria-hidden="true" />
              </a>
              <a
                href="https://facebook.com/jawab24app"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('footer.facebookAriaLabel')}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-[#1877F2]/10 flex items-center justify-center hover:bg-[#1877F2] transition-colors border border-[#1877F2]/20 group"
              >
                <Facebook className="w-4 h-4 sm:w-5 sm:h-5 text-[#1877F2] group-hover:text-white group-hoverable:scale-110 transition-[transform,color] duration-200" aria-hidden="true" />
              </a>
              <a
                href="mailto:support@jawab24.com"
                aria-label={t('footer.emailAriaLabel')}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center hover:bg-brand-600 transition-colors border border-white/10 group"
              >
                <Mail className="w-4 h-4 sm:w-5 sm:h-5 group-hoverable:scale-110 transition-transform duration-200" aria-hidden="true" />
              </a>
            </div>

            <a
              href={BRAND_ASSETS.stores.googlePlay}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('footer.googlePlayAlt')}
              className="inline-block mt-6 sm:mt-8 transition-opacity hover:opacity-90 focus-visible:opacity-90"
            >
              <Image
                src={playBadgeSrc}
                alt=""
                width={124}
                height={48}
                unoptimized
                className="h-12 w-auto"
              />
            </a>
          </div>

          <div>
            <h3 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{t('footer.quickLinks')}</h3>
            <ul className="space-y-2 sm:space-y-4 font-medium text-sm sm:text-base">
              <li><Link href="/what-is-jawab24" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.whatIsJawab24')}</Link></li>
              <li><Link href="/instagram" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.instagramPage')}</Link></li>
              <li><Link href="/blog" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.blog')}</Link></li>
              <li><Link href="/compare" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.compareAll')}</Link></li>
              <li><Link href="/compare/manychat" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.compareManyChat')}</Link></li>
              <li><Link href="/compare/tidio" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.compareTidio')}</Link></li>
              <li><Link href="/compare/chatfuel" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.compareChatfuel')}</Link></li>
              <li><Link href="/compare/botpress" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.compareBotpress')}</Link></li>
              <li><Link href="/compare/speedly" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.compareSpeedly')}</Link></li>
              <li><Link href="/contact" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.contactUs')}</Link></li>
              <li><Link href="/help" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.helpCenter')}</Link></li>
              <li><Link href="/trust" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.trust')}</Link></li>
              <li><Link href="/terms" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.termsOfService')}</Link></li>
              <li><Link href="/privacy" className="text-surface-400 hover:text-brand-400 transition-colors">{t('footer.privacyPolicy')}</Link></li>
              <li><Link href="/data-deletion" className="text-surface-400 hover:text-brand-400 transition-colors">{tDataDeletion('footerLink')}</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{t('footer.support')}</h3>
            <ul className="space-y-2 sm:space-y-4 font-medium text-sm sm:text-base">
              <li className="text-surface-400 flex items-center gap-2 sm:gap-3">
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-white/5 flex items-center justify-center text-brand-400 flex-shrink-0">
                  <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                </div>
                <a href="mailto:support@jawab24.com" className="text-xs sm:text-sm whitespace-nowrap hover:text-brand-400 transition-colors">support@jawab24.com</a>
              </li>
              <li className="text-surface-400 flex items-center gap-2 sm:gap-3">
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-white/5 flex items-center justify-center text-brand-400 flex-shrink-0">
                  <Phone className="w-3 h-3 sm:w-4 sm:h-4" />
                </div>
                <a href="tel:+46700224720" className="text-xs sm:text-sm whitespace-nowrap hover:text-brand-400 transition-colors" dir="ltr">{t('footer.phoneNumber')}</a>
              </li>
              <li className="text-surface-400 flex items-center gap-2 sm:gap-3">
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-white/5 flex items-center justify-center text-brand-400">
                  <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                </div>
                <span className="text-xs sm:text-base whitespace-nowrap">{t('footer.responseTime')}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-4 sm:pt-6 border-t border-white/10 pb-safe">
          <p className="text-center text-[10px] sm:text-xs leading-relaxed text-surface-400 mb-2" dir="auto">
            {t('footer.seoTagline')}
          </p>
          <p className="text-center text-[10px] sm:text-xs leading-relaxed text-surface-500" dir="ltr">
            {t('footer.operatedBy')}{' '}
            <span className="text-surface-400 font-medium">{t('footer.operatorName')}</span>
            {' · '}{t('footer.country')}
            {' · '}© {new Date().getFullYear()} Jawab24. {t('footer.copyright')}
          </p>
        </div>
      </div>
    </footer>
  );
}
