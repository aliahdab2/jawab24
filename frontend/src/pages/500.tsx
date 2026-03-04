import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from '@/i18n';
import { BrandLogo } from '@/components/ui';
import { BRAND_ASSETS } from '@/constants/brand';
import { Home, MessageCircle, RefreshCw, AlertTriangle } from 'lucide-react';

const WHATSAPP_NUMBER = '46700224720';

export default function Custom500() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const isRTL = language === 'ar';

  const supportMessage = encodeURIComponent('Hi, I hit a server error on Jawab24 and need help.');

  return (
    <>
      <Head>
        <title>500 - {BRAND_ASSETS.meta.appName}</title>
      </Head>

      <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-dvh bg-background flex flex-col items-center justify-center px-4">
        {/* Brand header */}
        <Link href="/landing" className="flex items-center gap-3 mb-10 group">
          <BrandLogo
            variant="main"
            className="w-12 h-12 group-hover:rotate-6 transition-transform"
          />
          <span className="font-display font-bold text-2xl text-foreground tracking-tight">
            {BRAND_ASSETS.meta.appName}
          </span>
        </Link>

        {/* Illustration */}
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-3xl bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-12 h-12 text-red-300" />
          </div>
          <div className="absolute -top-1 -end-1 w-6 h-6 rounded-full bg-accent-100 flex items-center justify-center">
            <span className="text-accent-500 text-xs font-bold">!</span>
          </div>
        </div>

        {/* Content */}
        <div className="text-center max-w-md">
          <p className="text-7xl font-display font-extrabold text-red-400 mb-4">500</p>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t('errors.serverErrorTitle')}
          </h1>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            {t('errors.serverErrorDesc')}
          </p>

          {/* Recovery actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => router.reload()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 text-white font-bold rounded-xl hover:bg-brand-600 transition-colors shadow-lg shadow-brand-500/20"
            >
              <RefreshCw className="w-5 h-5" />
              {t('errors.refreshPage')}
            </button>

            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 border border-theme-border text-foreground/70 font-bold rounded-xl hover:bg-muted transition-colors"
            >
              <Home className="w-5 h-5" />
              {t('errors.goHome')}
            </Link>

            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${supportMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              {t('errors.contactSupport')}
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
