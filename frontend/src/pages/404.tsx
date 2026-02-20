import Head from 'next/head';
import Link from 'next/link';
import { useTranslation, type TranslationKey } from '@/i18n';
import { BrandLogo } from '@/components/ui';
import { BRAND_ASSETS } from '@/constants/brand';
import { Home } from 'lucide-react';

export default function Custom404() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  return (
    <>
      <Head>
        <title>404 - {BRAND_ASSETS.meta.appName}</title>
      </Head>

      <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-surface-50 flex flex-col items-center justify-center px-4">
        <Link href="/landing" className="flex items-center gap-3 mb-8 group">
          <BrandLogo
            variant="main"
            className="w-12 h-12 group-hover:rotate-6 transition-transform"
          />
          <span className="font-display font-bold text-2xl text-surface-900 tracking-tight">
            {BRAND_ASSETS.meta.appName}
          </span>
        </Link>

        <div className="text-center max-w-md">
          <p className="text-7xl font-display font-extrabold text-brand-500 mb-4">404</p>
          <h1 className="text-2xl font-bold text-surface-900 mb-2">
            {t('errors.notFoundTitle' as TranslationKey)}
          </h1>
          <p className="text-surface-500 mb-8">
            {t('errors.notFoundDesc' as TranslationKey)}
          </p>

          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 text-white font-bold rounded-xl hover:bg-brand-600 transition-colors shadow-lg shadow-brand-500/20"
          >
            <Home className="w-5 h-5" />
            {t('errors.goHome')}
          </Link>
        </div>
      </div>
    </>
  );
}
