import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
// Direct imports, NOT the '@/components/ui' barrel (43 re-exports) — public
// page. The barrel reaches '@jawab24/shared', which is CommonJS and cannot
// be tree-shaken, so one named import pulls zod + libphonenumber-js.
import { BrandLogo } from '@/components/ui/BrandLogo';
import { BRAND_ASSETS } from '@/constants/brand';
import { Home, MessageCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

export default function Custom500() {
  const t = useTranslations('errors');
  const router = useRouter();

  const supportHref = buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, 'Hi, I hit a server error on Jawab24 and need help.');

  return (
    <>
      <Head>
        <title>500 - {BRAND_ASSETS.meta.appName}</title>
      </Head>

      <div className="min-h-dvh bg-background flex flex-col items-center justify-center px-4">
        {/* Brand header */}
        <Link href="/" className="flex items-center gap-3 mb-10 group">
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
          <div className="w-24 h-24 rounded-3xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-12 h-12 text-red-400 dark:text-red-300" />
          </div>
          <div className="absolute -top-1 -end-1 w-6 h-6 rounded-full bg-accent-100 flex items-center justify-center">
            <span className="text-accent-500 text-xs font-bold">!</span>
          </div>
        </div>

        {/* Content */}
        <div className="text-center max-w-md">
          <p className="text-7xl font-display font-extrabold text-red-400 mb-4">500</p>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t('serverErrorTitle')}
          </h1>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            {t('serverErrorDesc')}
          </p>

          {/* Recovery actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => router.reload()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 text-white font-bold rounded-xl hover:bg-brand-600 transition-colors shadow-lg shadow-brand-500/20"
            >
              <RefreshCw className="w-5 h-5" />
              {t('refreshPage')}
            </button>

            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 border border-theme-border text-foreground/70 font-bold rounded-xl hover:bg-muted transition-colors"
            >
              <Home className="w-5 h-5" />
              {t('goHome')}
            </Link>

            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              {t('contactSupport')}
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.error500]);
