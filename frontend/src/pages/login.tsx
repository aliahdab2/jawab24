import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Capacitor } from '@capacitor/core';
import clsx from 'clsx';
import {
  Zap,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Bot,
  Star,
  ShoppingBag
} from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { Button, BrandLogo, FacebookIcon } from '@/components/ui';
import Link from 'next/link';
import { BRAND_ASSETS } from '@/constants/brand';
import { FB_CALLBACK_PATH } from '@/constants/auth';

import { useAuthStore } from '@/lib/store';
import { captureError } from '@/lib/sentryHelpers';
import { getNextLocale, getLocalePath } from '@/utils/locale';
import { DemoLoginButton } from '@/features/demo';

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const tShopify = useTranslations('shopify');
  const tSalla = useTranslations('salla');
  const locale = useLocale();
  const { setLanguage } = useLanguage();
  const { isAuthenticated, _hasHydrated } = useAuthStore();

  // Prevent double-tap while system browser opens
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Read query params from URL directly — router.query is empty on first render
  // for statically exported pages (autoExport: true)
  const [urlParams, setUrlParams] = useState<URLSearchParams | null>(null);

  useEffect(() => {
    setUrlParams(new URLSearchParams(window.location.search));
    // Reset redirecting state when user returns to the page (e.g. presses back from browser)
    const resetRedirecting = () => setIsRedirecting(false);
    window.addEventListener('focus', resetRedirecting);
    return () => window.removeEventListener('focus', resetRedirecting);
  }, []);

  // Redirect authenticated users away from login page
  useEffect(() => {
    if (_hasHydrated && isAuthenticated) {
      const redirect = router.query.redirect as string;
      const target = redirect && redirect.startsWith('/') ? redirect : '/dashboard';
      router.replace(target);
    }
  }, [_hasHydrated, isAuthenticated, router]);

  const handleFacebookLogin = async () => {
    if (isRedirecting) return;

    // Check for Facebook App ID
    const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
    if (!fbAppId) {
      toast.error(t('loginError'));
      return;
    }

    setIsRedirecting(true);

    const isMobile = Capacitor.isNativePlatform();
    const platform = Capacitor.getPlatform();

    if (isMobile) {
      // --- MOBILE LOGIN FLOW (Android + iOS) ---
      // Uses system browser (Chrome Custom Tab / SFSafariViewController) via @capacitor/browser.
      // This follows RFC 8252 (OAuth 2.0 for Native Apps) which recommends system browsers
      // over native SDKs or embedded WebViews for reliability and security.
      // The callback on jawab24.com exchanges the code, then deep-links back to the app
      // via com.jawab24.app:// custom URL scheme (handled by appUrlOpen in _app.tsx).
      try {
        const { Browser } = await import('@capacitor/browser');

        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';
        const normalizedOrigin = siteUrl.replace(/\/$/, '');
        const localePath = getLocalePath(locale);
        const redirectUri = encodeURIComponent(`${normalizedOrigin}${localePath}${FB_CALLBACK_PATH}`);
        const scope = encodeURIComponent('email,pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages,instagram_manage_comments');

        const returnUrl = router.query.redirect as string || '/dashboard';
        const state = encodeURIComponent(`${returnUrl}|mobile|${locale}`);

        const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}&display=page`;

        await Browser.open({ url: oauthUrl });
      } catch (error: unknown) {
        setIsRedirecting(false);
        captureError(error, 'Mobile login error', { tags: { page: 'login', platform } });
        toast.error(t('loginError'));
      }

    } else {
      // --- WEB BROWSER LOGIN FLOW ---
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';
      const normalizedOrigin = siteUrl.replace(/\/$/, '');
      const localePath = getLocalePath(locale);
      const origin = window.location.hostname === 'localhost' ? window.location.origin : normalizedOrigin;
      const redirectUri = encodeURIComponent(`${origin}${localePath}${FB_CALLBACK_PATH}`);
      const scope = encodeURIComponent('email,pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages,instagram_manage_comments');

      const urlParams = new URLSearchParams(window.location.search);
      const returnUrl = urlParams.get('redirect') || router.query.redirect as string || '/dashboard';
      const state = encodeURIComponent(`${returnUrl}|web|${locale}`);

      const isMobileWeb = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const displayMode = isMobileWeb ? 'touch' : 'page';

      window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}&display=${displayMode}`;
    }
  }

  const toggleLanguage = () => {
    setLanguage(getNextLocale(locale));
  };

  const features = [
    {
      icon: Zap,
      title: t('instantSetup'),
      desc: t('instantSetupDesc'),
      color: 'text-amber-500 dark:text-brand-400',
      bg: 'bg-amber-50 dark:bg-brand-400/10'
    },
    {
      icon: ShieldCheck,
      title: t('secureOfficial'),
      desc: t('secureOfficialDesc'),
      color: 'text-brand-600 dark:text-brand-400',
      bg: 'bg-brand-50 dark:bg-brand-400/10'
    },
    {
      icon: MessageSquare,
      title: t('amazingAccuracy'),
      desc: t('amazingAccuracyDesc'),
      color: 'text-violet-600 dark:text-[#bfe1d4]',
      bg: 'bg-violet-50 dark:bg-[rgba(191,225,212,0.08)]'
    }
  ];

  return (
    <>
      <Head>
        <title>{BRAND_ASSETS.meta.appTitle} - {t('login')}</title>
        <meta name="description" content={t('seoDescription')} />
        <meta name="keywords" content={t('seoKeywords')} />
        <meta property="og:title" content={t('ogTitle')} />
        <meta property="og:description" content={t('ogDescription')} />
      </Head>

      <div className="flex-1 overflow-y-auto bg-card dark:bg-background flex flex-col lg:flex-row min-h-[100dvh] relative">
        {/* Dark mode decorative overlays — span both panels seamlessly */}
        <div className="hidden dark:block absolute inset-0 pointer-events-none z-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(93,174,164,0.15),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_90%,rgba(93,174,164,0.10),transparent_60%)]" />
          <div className="absolute inset-0 bg-[url('/images/cubes.png')] opacity-[0.06]" />
        </div>

        {/* Left Side: Visual/Marketing (Hidden on mobile) */}
        <div className="hidden lg:flex lg:w-[55%] relative bg-zinc-900 dark:bg-transparent overflow-hidden items-center justify-center p-10 xl:p-16">
          {/* Animated Background (light mode only — dark mode uses parent overlays) */}
          <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.15),transparent)] dark:hidden"></div>
          <div className="absolute bottom-0 left-0 w-full h-full bg-[radial-gradient(circle_at_bottom_left,rgba(139,92,246,0.15),transparent)] dark:hidden"></div>
          <div className="absolute inset-0 bg-[url('/images/cubes.png')] opacity-10 dark:hidden"></div>

          <div className="relative z-10 w-full max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/10 mb-6 animate-slide-up">
              <Sparkles className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-bold text-brand-400 uppercase tracking-widest">
                {t('nextGenAutoReplies')}
              </span>
            </div>

            <h1 className="text-3xl xl:text-4xl font-display font-extrabold text-white mb-4 leading-tight tracking-tight animate-slide-up animation-delay-100">
              {t('startYourJourney')}
              <span className="block text-brand-500">{t('smartGrowthJourney')}</span>
            </h1>

            <p className="text-base text-white/60 mb-8 leading-relaxed font-medium animate-slide-up animation-delay-200">
              {t('journeyDesc')}
            </p>

            <div className="grid grid-cols-1 gap-4 animate-slide-up animation-delay-300">
              {features.map((f, i) => (
                <div key={i} className="flex gap-4 items-start group">
                  <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 shadow-lg`}>
                    <f.icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">{f.title}</h3>
                    <p className="text-sm text-white/60 font-medium">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Testimonial Snippet */}
            <div className="mt-8 p-5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm animate-slide-up animation-delay-500">
              <div className="flex gap-1 mb-2">
                {[1, 2, 3, 4, 5].map(s => <Star key={s} className="w-3 h-3 text-amber-400 fill-amber-400 dark:text-[#bfe1d4] dark:fill-[#bfe1d4]" />)}
              </div>
              <p className="text-sm text-white font-medium italic mb-3">
                "{t('testimonialQuote')}"
              </p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-brand-500 dark:bg-brand-400 flex items-center justify-center text-white font-bold text-xs">MA</div>
                <div>
                  <div className="text-white font-bold text-xs">Mohammed A.</div>
                  <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest">{t('testimonialAuthor')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Login Form */}
        <div className="flex-1 flex flex-col bg-gradient-to-br from-card via-card to-brand-50/30 dark:bg-none dark:from-transparent dark:via-transparent dark:to-transparent min-h-0 overflow-hidden relative z-[1]">
          {/* Subtle background pattern for visual interest (light mode only) */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(13,148,136,0.03),transparent_50%)] pointer-events-none dark:hidden" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(13,148,136,0.02),transparent_50%)] pointer-events-none dark:hidden" />

          {/* Header - Sticky so it stays visible when content scrolls (safe area handled by app-shell) */}
          <div className="sticky top-0 z-10 flex-shrink-0 bg-card/80 backdrop-blur-sm dark:bg-transparent dark:backdrop-blur-none flex items-center justify-between px-6 lg:px-12 h-16 sm:h-20 border-b border-theme-border/50 dark:border-transparent">
            <Link href="/landing" className="flex items-center gap-2 sm:gap-3 group">
              <BrandLogo
                variant="main"
                className="w-9 h-9 sm:w-12 sm:h-12 group-hover:rotate-6 transition-transform"
              />
              <span className="font-display font-bold text-lg sm:text-2xl text-foreground tracking-tight">{BRAND_ASSETS.meta.appName}</span>
            </Link>
            <button
              onClick={toggleLanguage}
              className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-400/10 transition-all"
            >
              {tc('switchLanguage')}
            </button>
          </div>

          {/* Content:
              - Mobile: Content at top, terms at bottom
              - Desktop: Content near top, terms below content */}
          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-none px-6 px-safe-landscape lg:px-12 flex flex-col justify-center pb-safe">
            {/* Main content wrapper */}
            <div className="w-full max-w-lg mx-auto pt-6 lg:pt-8">
              <div className="text-center lg:text-start mb-6">
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold text-foreground mb-3 tracking-tight">
                  {t('welcome')}
                </h2>
                <p className="text-base sm:text-lg lg:text-xl text-muted-foreground font-medium">
                  {t('welcomeBackDesc')}
                </p>

                {/* Trust signals */}
                <div className="hidden lg:flex items-center gap-6 mt-5">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                    <span className="text-sm font-bold text-muted-foreground">{t('stat1Label')}</span>
                  </div>
                  <div className="w-px h-4 bg-theme-border" aria-hidden="true" />
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                    <span className="text-sm font-bold text-muted-foreground">{t('stat2Label')}</span>
                  </div>
                  <div className="w-px h-4 bg-theme-border" aria-hidden="true" />
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-brand-500" aria-hidden="true" />
                    <span className="text-sm font-bold text-muted-foreground">{t('stat3Label')}</span>
                  </div>
                </div>
              </div>

              {/* Mobile feature highlights — compact row */}
              <div className="flex gap-3 lg:hidden mb-3">
                {features.map((f, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl bg-background border border-theme-border',
                      'animate-slide-up',
                      i === 0 && 'animation-delay-100',
                      i === 1 && 'animation-delay-200',
                      i === 2 && 'animation-delay-300',
                    )}
                  >
                    <div className={`w-8 h-8 rounded-lg ${f.bg} flex items-center justify-center`}>
                      <f.icon className={`w-4 h-4 ${f.color}`} />
                    </div>
                    <span className="text-[11px] font-bold text-foreground/70 text-center leading-tight">{f.title}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-5">
                {/* Shopify-first install banner */}
                {urlParams?.get('shopify_pending') === 'true' && (
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700">
                    <div className="flex gap-3 items-start">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-800/40 flex items-center justify-center flex-shrink-0">
                        <ShoppingBag className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="font-bold text-emerald-900 dark:text-emerald-300 text-sm">
                          {tShopify('installDetected')}
                        </p>
                        <p className="text-emerald-700 dark:text-emerald-400 text-sm mt-1">
                          {tShopify('loginToConnect')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {urlParams?.get('shopify_error') === 'already_connected' && (
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
                    <p className="font-bold text-red-900 dark:text-red-300 text-sm">
                      {tShopify('errorAlreadyConnected')}
                    </p>
                  </div>
                )}

                {urlParams?.get('shopify_error') === 'auth_failed' && (
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
                    <p className="font-bold text-red-900 dark:text-red-300 text-sm">
                      {tShopify('errorAuthFailed')}
                    </p>
                  </div>
                )}

                {/* Salla-first install banner */}
                {urlParams?.get('salla_pending') === 'true' && (
                  <div className="p-4 rounded-2xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700">
                    <div className="flex gap-3 items-start">
                      <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-800/40 flex items-center justify-center flex-shrink-0">
                        <ShoppingBag className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                      </div>
                      <div>
                        <p className="font-bold text-teal-900 dark:text-teal-300 text-sm">
                          {tSalla('installDetected')}
                        </p>
                        <p className="text-teal-700 dark:text-teal-400 text-sm mt-1">
                          {tSalla('loginToConnect')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {urlParams?.get('salla_error') === 'already_connected' && (
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
                    <p className="font-bold text-red-900 dark:text-red-300 text-sm">
                      {tSalla('errorAlreadyConnected')}
                    </p>
                  </div>
                )}

                {urlParams?.get('salla_error') === 'auth_failed' && (
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
                    <p className="font-bold text-red-900 dark:text-red-300 text-sm">
                      {tSalla('errorAuthFailed')}
                    </p>
                  </div>
                )}

                {/* Social proof card — motivates before the CTA */}
                <div className="p-4 rounded-2xl bg-brand-50 dark:bg-brand-400/10 border border-brand-100 dark:border-brand-400/20">
                  <div className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-400/15 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-bold text-brand-900 dark:text-brand-300 text-sm mb-0.5">{t('didYouKnow')}</h3>
                      <p className="text-brand-700 dark:text-brand-400/80 text-sm font-medium leading-relaxed">
                        {t('didYouKnowDesc')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* CTA zone */}
                <div className="rounded-2xl bg-gradient-to-b from-blue-50/50 dark:from-transparent to-transparent p-4 -mx-1 lg:bg-none lg:p-0 lg:mx-0">
                  <Button
                    onClick={handleFacebookLogin}
                    disabled={isRedirecting}
                    size="lg"
                    className="w-full bg-[#166FE5] hover:bg-[#1258B8] dark:bg-brand-600 dark:hover:bg-brand-700 text-white py-6 sm:py-8 rounded-2xl shadow-xl shadow-blue-500/25 hover:shadow-2xl hover:shadow-blue-500/40 dark:shadow-brand-400/40 dark:hover:shadow-brand-400/50 ring-4 ring-blue-400/15 dark:ring-brand-400/30 font-bold text-lg lg:text-xl group transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-70 disabled:cursor-default disabled:scale-100"
                  >
                    <div className="flex items-center justify-center gap-3 text-white">
                      <FacebookIcon className="w-6 h-6 lg:w-7 lg:h-7" aria-hidden="true" />
                      <span className="text-white">{t('loginWithFacebook')}</span>
                    </div>
                  </Button>

                  {/* Demo Mode - Self-contained component (only renders when enabled) */}
                  <DemoLoginButton />
                </div>
              </div>
            </div>

            {/* Terms */}
            <div className="w-full max-w-lg mx-auto mt-6 py-4 lg:py-8 lg:mt-8 text-center lg:text-start">
              <p className="text-sm text-muted-foreground font-medium">
                {t('termsAgreement')}
                <br className="sm:hidden" />
                <Link href="/terms" className="text-brand-600 font-bold hover:underline mx-1">{t('termsOfService')}</Link>
                {t('and')}
                <Link href="/privacy" className="text-brand-600 font-bold hover:underline mx-1">{t('privacyPolicy')}</Link>
              </p>
            </div>
          </div>

        </div>

        {/* Fixed top safe area background - prevents content from showing through status bar when scrolling */}
        <div
          className="lg:hidden fixed-safe-bg top-safe-bg bg-card dark:bg-background"
          aria-hidden="true"
        />

        {/* Fixed bottom safe area background */}
        <div
          className="lg:hidden fixed-safe-bg bottom-safe-bg bg-card dark:bg-background"
          aria-hidden="true"
        />
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.login]);
