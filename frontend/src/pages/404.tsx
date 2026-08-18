import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
// Direct imports, NOT the '@/components/ui' barrel (43 re-exports) — public
// page. The barrel reaches '@jawab24/shared', which is CommonJS and cannot
// be tree-shaken, so one named import pulls zod + libphonenumber-js.
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Button } from '@/components/ui/Button';
import { BRAND_ASSETS } from '@/constants/brand';
import { Home, ArrowLeft, ArrowRight, MessageCircle, Search, HelpCircle } from 'lucide-react';
import { isRTLLocale } from '@/utils/locale';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

export default function Custom404() {
  const t = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const isRTL = isRTLLocale(locale);
  const attemptedPath = router.asPath;
  const supportHref = buildWhatsAppUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, 'Hi, I need help — I reached a broken page on Jawab24.');
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  return (
    <>
      <Head>
        <title>{`404 - ${BRAND_ASSETS.meta.appName}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="min-h-dvh bg-background flex flex-col items-center justify-center px-4">
        {/* Brand header */}
        <Link href="/" className="flex items-center gap-3 mb-12 group">
          <BrandLogo
            variant="main"
            className="w-10 h-10 group-hover:rotate-6 transition-transform"
          />
          <span className="font-display font-bold text-xl text-foreground tracking-tight">
            {BRAND_ASSETS.meta.appName}
          </span>
        </Link>

        {/* Illustration — larger with floating satellite elements */}
        <div className="relative mb-8">
          <div className="w-36 h-36 rounded-full bg-brand-50 flex items-center justify-center animate-float">
            <Search className="w-16 h-16 text-brand-300" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="absolute -top-2 -end-2 w-10 h-10 rounded-full bg-accent-100 flex items-center justify-center animate-float-delayed">
            <HelpCircle className="w-5 h-5 text-accent-500" aria-hidden="true" />
          </div>
          <div className="absolute -bottom-1 -start-3 w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center animate-float-slow">
            <span className="text-brand-400 text-xs font-bold" aria-hidden="true">?</span>
          </div>
        </div>

        {/* Content */}
        <div className="text-center max-w-md">
          <p
            className="text-8xl font-display font-extrabold text-brand-500/20 mb-1 select-none"
            aria-hidden="true"
          >
            404
          </p>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t('notFoundTitle')}
          </h1>
          <p className="text-muted-foreground mb-4 leading-relaxed">
            {t('notFoundDesc')}
          </p>

          {/* Broken path — gives the user context on what URL failed */}
          {attemptedPath && attemptedPath !== '/404' && (
            <p className="text-xs text-muted-foreground font-mono bg-muted rounded-lg px-3 py-2 mb-4 break-all inline-block">
              {attemptedPath}
            </p>
          )}

          {/* Recovery actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
            <Button
              variant="primary"
              size="lg"
              icon={<Home className="w-5 h-5" aria-hidden="true" />}
              onClick={() => router.push('/dashboard')}
            >
              {t('goHome')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={<BackArrow className="w-5 h-5" aria-hidden="true" />}
              onClick={() => router.back()}
            >
              {t('goBack')}
            </Button>
          </div>

          {/* Contact support — visible but doesn't compete with main actions */}
          <div className="mt-8 pt-6 border-t border-theme-border">
            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-600 transition-colors"
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
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
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.error404]);
