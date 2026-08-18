import { useState, useEffect, useCallback, useMemo } from 'react';
// Direct import, not the '@/hooks' barrel — public page (see DashboardLayout.tsx).
import { useCountdown } from '@/hooks/useCountdown';
import { toast } from 'sonner';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Capacitor } from '@capacitor/core';
import { buildFacebookOAuthUrl } from '@/lib/facebookOAuth';
import clsx from 'clsx';
import {
  Zap,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Bot,
  Star,
  ShoppingBag,
  Loader2,
  ArrowLeft,
  Phone,
} from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
// Direct imports, NOT the '@/components/ui' barrel (43 re-exports) — public
// page. The barrel reaches '@jawab24/shared', which is CommonJS and cannot
// be tree-shaken, so one named import pulls zod + libphonenumber-js.
import { Button } from '@/components/ui/Button';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { FacebookIcon } from '@/components/ui/BrandIcons';
import { ThemeToggleButton } from '@/components/ui/ThemeToggleButton';
import Link from 'next/link';
import { BRAND_ASSETS } from '@/constants/brand';
import { FB_CALLBACK_PATH } from '@/constants/auth';

import { useAuthStore, useUIStore, type Language, type WorkspaceSummary } from '@/lib/store';
import { otpApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { handleOtpVerifyError } from '@/lib/otpErrors';
import { getNextLocale, getLocalePath } from '@/utils/locale';
import { DemoLoginButton } from '@/features/demo';
import { PhoneInput } from '@/components/auth/PhoneInput';
import { OtpInput, OTP_LENGTH } from '@/components/auth/OtpInput';

// E.164 prefixes that Twilio cannot deliver SMS to (errorCode 15).
// Extend here if Twilio's blocklist changes.
import { useOtpRequest } from '@/hooks/useOtpRequest';
import { PHONE_AUTH_ENABLED } from '@/lib/featureFlags';
import { isSmsBlockedPhone } from '@jawab24/shared';

type AuthTab = 'facebook' | 'phone';
type OtpStep = 'phone' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const tShopify = useTranslations('shopify');
  const tSalla = useTranslations('salla');
  const tZid = useTranslations('zid');
  const locale = useLocale();
  const { setLanguage } = useLanguage();
  const { isAuthenticated, _hasHydrated } = useAuthStore();

  // Prevent double-tap while system browser opens
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Read query params from URL directly — router.query is empty on first render
  // for statically exported pages (autoExport: true)
  const [urlParams, setUrlParams] = useState<URLSearchParams | null>(null);

  // ── Auth tab + Phone OTP state ────────────────────────────────────────────
  const [authTab, setAuthTab] = useState<AuthTab>('facebook');
  const [otpStep, setOtpStep] = useState<OtpStep>('phone');
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');
  const { count: otpExpiry, start: startExpiryTimer } = useCountdown();

  const isOtpStep = authTab === 'phone' && otpStep === 'code';

  const {
    phoneE164, setPhoneE164,
    phoneValid, setPhoneValid,
    phoneTouched,
    loading: otpRequestLoading,
    error: otpRequestError, setError: setOtpRequestError,
    resendCountdown,
    requestOtp: handleRequestOtp,
  } = useOtpRequest({
    page: 'login',
    onSuccess: () => { setOtpStep('code'); setOtpCode(''); startExpiryTimer(5 * 60); },
  });

  // TEMP: remove when WhatsApp OTP ships. Vonage rejects SMS to Syria with
  // errorCode 15 (non-whitelisted destination), so block submit and direct the
  // user to Facebook login instead of a silent failure.
  // Twilio errorCode 15 (non-whitelisted destination) blocks SMS to certain
  // countries. Direct affected users to Facebook login instead of a silent
  // failure. PhoneInput already emits E.164, so a prefix check is exact.
  const smsBlocked = useMemo(() => isSmsBlockedPhone(phoneE164), [phoneE164]);

  const handleVerifyOtp = useCallback(async (completedCode?: string) => {
    // onComplete passes the code directly; button click falls back to state
    const code = completedCode ?? otpCode;
    if (code.length !== OTP_LENGTH) return;
    setOtpLoading(true);
    setOtpError('');
    try {
      const { data } = await otpApi.verifyOtp(phoneE164, code);
      // Hydrate auth store — fbToken is empty for phone-only users
      useAuthStore.getState().setAuth(
        { ...data.user, name: data.user.name ?? data.user.phone ?? '' },
        data.token,
        '',
      );
      if (data.workspaces?.length) {
        useAuthStore.getState().setWorkspaces(
          data.workspaces as WorkspaceSummary[],
          { defaultWorkspaceId: (data as { defaultWorkspaceId?: string | null }).defaultWorkspaceId ?? null },
        );
      }
      // Apply default language
      useUIStore.getState().setLanguage(locale as Language);
      // Redirect
      const returnUrl = urlParams?.get('redirect') || (router.query.redirect as string) || '/dashboard';
      const safeUrl = returnUrl.startsWith('/') ? returnUrl : '/dashboard';
      router.replace(safeUrl);
    } catch (err: unknown) {
      handleOtpVerifyError(err, t, setOtpError, 'OTP verify failed', { page: 'login' });
    } finally {
      setOtpLoading(false);
    }
  }, [otpCode, phoneE164, router, urlParams, locale, t]);

  useEffect(() => {
    setUrlParams(new URLSearchParams(window.location.search));
    // Reset redirecting state when user returns to the page (e.g. presses back from browser)
    const resetRedirecting = () => setIsRedirecting(false);
    window.addEventListener('focus', resetRedirecting);
    return () => window.removeEventListener('focus', resetRedirecting);
  }, []);

  // Redirect authenticated users away from login page.
  //
  // MUST wait for router.isReady: on a statically-exported page router.query is
  // {} on first render and only fills in after hydration. The auth store hydrates
  // from localStorage and can win that race, so without the guard this effect
  // read `redirect === undefined` and forwarded to /dashboard — silently
  // destroying the ?redirect intent. That is exactly how the WhatsApp connect
  // browser handoff (?redirect=/pages?connectWhatsApp=true) dropped merchants on
  // the dashboard with no dialog (Android, 2026-07-30, confirmed in nginx logs).
  // Flaky by nature — whether the query was parsed in time depended on cache
  // state and device speed, which is why earlier attempts bounced to /pages and
  // this one to /dashboard.
  useEffect(() => {
    if (!router.isReady) return;
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

        // Server-side callback: backend exchanges the code and HTTP 302 redirects
        // to com.jawab24.app:// directly — no client-side code exchange needed.
        const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api').replace(/\/$/, '');
        const redirectUri = `${apiUrl}/auth/facebook/mobile-callback`;

        const returnUrl = router.query.redirect as string || '/dashboard';
        // Resume reconnect flow if /auth/callback bounced here after a 401 mid-link
        // (session expired between reconnect-OAuth start and callback). Preserves
        // intent so the user lands linking to their existing account, not creating
        // a second FB-only one.
        const reconnectSuffix = router.query.reconnect === 'facebook' ? '|reconnect' : '';
        const state = `${returnUrl}|mobile|${locale}${reconnectSuffix}`;

        const oauthUrl = buildFacebookOAuthUrl({ appId: fbAppId, redirectUri, state, display: 'page' });

        // Reset button when user closes Chrome Custom Tab without completing login
        const browserFinishedListener = await Browser.addListener('browserFinished', () => {
          setIsRedirecting(false);
          browserFinishedListener.remove();
        });

        await Browser.open({ url: oauthUrl });
      } catch (error: unknown) {
        setIsRedirecting(false);
        captureError(error, 'Mobile login error', { tags: { page: 'login', platform } });
        toast.error(t('loginError'));
      }

    } else {
      // --- WEB BROWSER LOGIN FLOW ---
      const normalizedOrigin = BRAND_ASSETS.urls.base;
      const localePath = getLocalePath(locale);
      const origin = window.location.hostname === 'localhost' ? window.location.origin : normalizedOrigin;
      const redirectUri = `${origin}${localePath}${FB_CALLBACK_PATH}`;

      const webParams = new URLSearchParams(window.location.search);
      const returnUrl = webParams.get('redirect') || router.query.redirect as string || '/dashboard';
      const reconnectSuffix = (webParams.get('reconnect') || router.query.reconnect) === 'facebook' ? '|reconnect' : '';
      const state = `${returnUrl}|web|${locale}${reconnectSuffix}`;

      const isMobileWeb = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const displayMode = isMobileWeb ? 'touch' : 'page';

      window.location.href = buildFacebookOAuthUrl({ appId: fbAppId, redirectUri, state, display: displayMode });
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
      color: 'text-amber-500 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-400/10'
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
        <title>{`${BRAND_ASSETS.meta.appTitle} - ${t('login')}`}</title>
        <meta name="description" content={t('seoDescription')} />
        <meta key="og:title" property="og:title" content={t('ogTitle')} />
        <meta key="og:description" property="og:description" content={t('ogDescription')} />
      </Head>

      <div className="flex-1 overflow-y-auto bg-card dark:bg-background flex flex-col lg:flex-row min-h-[100dvh] max-lg:landscape:min-h-0 max-lg:landscape:max-h-[100dvh] relative">
        {/* Dark mode decorative overlays — span both panels seamlessly */}
        <div className="hidden dark:block absolute inset-0 pointer-events-none z-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(93,174,164,0.15),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_90%,rgba(93,174,164,0.10),transparent_60%)]" />
          <div className="absolute inset-0 bg-[url('/images/cubes.png')] opacity-[0.06]" />
        </div>

        {/* Left Side: Visual/Marketing (Hidden on mobile) */}
        <div className="hidden lg:flex lg:w-[55%] relative bg-zinc-900 dark:bg-transparent overflow-hidden items-center justify-center p-10 xl:p-16">
          {/* Animated Background (light mode only — dark mode uses parent overlays) */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.15),transparent)] dark:hidden"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(139,92,246,0.15),transparent)] dark:hidden"></div>
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
                  <div className="text-white font-bold text-xs">{t('testimonialAuthorName')}</div>
                  <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest">{t('testimonialAuthor')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Login Form */}
        <div className="flex-1 flex flex-col bg-gradient-to-br from-card via-card to-brand-50/30 dark:bg-none dark:from-transparent dark:via-transparent dark:to-transparent min-h-0 overflow-hidden max-lg:landscape:overflow-visible relative z-[1]">
          {/* Subtle background pattern for visual interest (light mode only) */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(13,148,136,0.03),transparent_50%)] pointer-events-none dark:hidden" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(13,148,136,0.02),transparent_50%)] pointer-events-none dark:hidden" />

          {/* Header - Sticky so it stays visible when content scrolls (safe area handled by app-shell) */}
          <div className="sticky top-0 z-10 flex-shrink-0 bg-card/80 backdrop-blur-sm dark:bg-transparent dark:backdrop-blur-none flex items-center justify-between px-6 lg:px-12 h-16 sm:h-20 border-b border-theme-border/50 dark:border-transparent">
            <Link href="/" className="flex items-center gap-2 sm:gap-3 group">
              <BrandLogo
                variant="main"
                className="w-10 h-10 sm:w-12 sm:h-12 group-hover:rotate-6 transition-transform flex-shrink-0"
              />
              <span className="font-display font-bold text-xl sm:text-2xl text-foreground tracking-tight">{BRAND_ASSETS.meta.appName}</span>
            </Link>
            <div className="flex items-center">
              <button
                onClick={toggleLanguage}
                className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-400/10 transition-all"
              >
                {tc('switchLanguage')}
              </button>
              <ThemeToggleButton />
              <div className="native-landscape-spacer" aria-hidden="true" />
            </div>
          </div>

          {/* Content:
              - Mobile: Content at top, terms at bottom
              - Desktop: Content near top, terms below content */}
          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-none px-6 px-safe-landscape lg:px-12 flex flex-col justify-start pb-safe-content">
            {/* Main content wrapper */}
            <div className="w-full max-w-lg mx-auto pt-[2vh] sm:pt-[8vh] lg:pt-[6vh] max-lg:landscape:pt-2">
              <div className="text-center lg:text-start mb-2 sm:mb-4 max-lg:landscape:mb-1">
                <h2 className="text-2xl sm:text-4xl lg:text-5xl max-lg:landscape:text-xl font-display font-extrabold text-foreground mb-1 sm:mb-3 max-lg:landscape:mb-0.5 tracking-tight">
                  {t('welcome')}
                </h2>
                <p className="text-base sm:text-lg lg:text-xl max-lg:landscape:text-sm text-muted-foreground font-medium">
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

              {/* Mobile feature highlights — compact row (hidden during OTP entry and in landscape) */}
              <div className={clsx('flex gap-2 lg:hidden max-lg:landscape:hidden mb-2', isOtpStep && 'hidden')}>
                {features.map((f, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'flex-1 flex flex-col items-center gap-1 p-2 rounded-xl bg-background border border-theme-border',
                      'animate-slide-up',
                      i === 0 && 'animation-delay-100',
                      i === 1 && 'animation-delay-200',
                      i === 2 && 'animation-delay-300',
                    )}
                  >
                    <div className={`w-7 h-7 rounded-lg ${f.bg} flex items-center justify-center`}>
                      <f.icon className={`w-3.5 h-3.5 ${f.color}`} />
                    </div>
                    <span className="text-[11px] font-bold text-foreground/70 text-center leading-tight">{f.title}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
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

                {/* Zid-first install banner */}
                {urlParams?.get('zid_pending') === 'true' && (
                  <div className="p-4 rounded-2xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700">
                    <div className="flex gap-3 items-start">
                      <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-800/40 flex items-center justify-center flex-shrink-0">
                        <ShoppingBag className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                      </div>
                      <div>
                        <p className="font-bold text-teal-900 dark:text-teal-300 text-sm">
                          {tZid('installDetected')}
                        </p>
                        <p className="text-teal-700 dark:text-teal-400 text-sm mt-1">
                          {tZid('loginToConnect')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {urlParams?.get('zid_error') === 'already_connected' && (
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
                    <p className="font-bold text-red-900 dark:text-red-300 text-sm">
                      {tZid('errorAlreadyConnected')}
                    </p>
                  </div>
                )}

                {urlParams?.get('zid_error') === 'auth_failed' && (
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
                    <p className="font-bold text-red-900 dark:text-red-300 text-sm">
                      {tZid('errorAuthFailed')}
                    </p>
                  </div>
                )}

                {/* Social proof card — motivates before the CTA (hidden during OTP entry and on short screens) */}
                <div className={clsx('hidden sm:flex max-lg:landscape:!hidden p-3 rounded-2xl bg-brand-50 dark:bg-brand-400/10 border border-brand-100 dark:border-brand-400/20', isOtpStep && 'sm:hidden')}>
                  <div className="flex gap-3 items-center">
                    <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-400/15 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
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
                <div className="rounded-2xl bg-gradient-to-b from-blue-50/50 dark:from-transparent to-transparent p-3 sm:p-4 -mx-1 lg:bg-none lg:p-0 lg:mx-0">
                  <div className="space-y-3 sm:space-y-4">

                    {PHONE_AUTH_ENABLED ? (
                      <>
                        {/* Tab selector — hidden once user enters OTP step */}
                        {otpStep === 'phone' && (
                          <div className="flex rounded-2xl bg-surface-100 dark:bg-surface-200 p-1 gap-1" role="tablist">
                            <button
                              type="button"
                              role="tab"
                              aria-selected={authTab === 'facebook'}
                              onClick={() => { setAuthTab('facebook'); setOtpError(''); setOtpCode(''); }}
                              className={clsx(
                                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all',
                                authTab === 'facebook'
                                  ? 'bg-card text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground'
                              )}
                            >
                              <FacebookIcon className="w-4 h-4" aria-hidden="true" />
                              {t('tabFacebook')}
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={authTab === 'phone'}
                              onClick={() => { setAuthTab('phone'); setOtpError(''); }}
                              className={clsx(
                                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all',
                                authTab === 'phone'
                                  ? 'bg-card text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground'
                              )}
                            >
                              <Phone className="w-4 h-4" aria-hidden="true" />
                              {t('tabPhone')}
                            </button>
                          </div>
                        )}

                        {/* Tab content */}
                        {authTab === 'facebook' ? (
                          /* ── Facebook tab ── */
                          <Button
                            onClick={handleFacebookLogin}
                            disabled={isRedirecting}
                            size="lg"
                            className="w-full bg-[#166FE5] hover:bg-[#1258B8] text-white py-3 sm:py-8 max-lg:landscape:py-2.5 rounded-2xl shadow-xl shadow-blue-500/25 hover:shadow-2xl hover:shadow-blue-500/40 ring-4 ring-blue-400/15 font-bold text-lg lg:text-xl max-lg:landscape:text-base transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-70 disabled:cursor-default disabled:scale-100"
                          >
                            <div className="flex items-center justify-center gap-3 text-white">
                              <FacebookIcon className="w-6 h-6 lg:w-7 lg:h-7" aria-hidden="true" />
                              <span className="text-white">{t('loginWithFacebook')}</span>
                            </div>
                          </Button>
                        ) : otpStep === 'phone' ? (
                          /* ── Phone tab — Step 1: enter number ── */
                          <div className="space-y-3">
                            <PhoneInput
                              onChange={(e164, valid) => {
                                setPhoneE164(e164);
                                setPhoneValid(valid);
                                setOtpRequestError('');
                              }}
                              disabled={otpRequestLoading}
                              aria-label={t('phoneNumber')}
                              aria-describedby={phoneTouched && !phoneValid ? 'phone-error' : undefined}
                            />
                            {phoneTouched && !phoneValid && (
                              <p id="phone-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
                                {t('invalidPhone')}
                              </p>
                            )}
                            {otpRequestError && (
                              <p className="text-sm text-red-600 dark:text-red-400 text-center" role="alert">
                                {otpRequestError}
                              </p>
                            )}
                            {smsBlocked && !otpRequestError && (
                              <p className="text-sm text-amber-600 dark:text-amber-400 text-center" role="alert">
                                {t('smsUnsupportedCountry')}
                              </p>
                            )}
                            <Button
                              onClick={handleRequestOtp}
                              disabled={otpRequestLoading || smsBlocked}
                              size="lg"
                              className="w-full py-3 sm:py-8 max-lg:landscape:py-2.5 rounded-2xl font-bold text-lg lg:text-xl max-lg:landscape:text-base transition-all hover:scale-[1.02] active:scale-95"
                            >
                              {otpRequestLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                                  {t('sendingCode')}
                                </span>
                              ) : (
                                <span className="flex items-center justify-center gap-2">
                                  <Phone className="w-5 h-5" aria-hidden="true" />
                                  {t('sendCode')}
                                </span>
                              )}
                            </Button>
                          </div>
                        ) : (
                          /* ── Phone tab — Step 2: OTP (auto-submits on 6th digit) ── */
                          <div className="space-y-4">
                            <OtpInput
                              value={otpCode}
                              onChange={code => { setOtpCode(code); setOtpError(''); }}
                              onComplete={handleVerifyOtp}
                              disabled={otpLoading}
                              autoFocus
                            />
                            {/* Expiry timer */}
                            {otpExpiry > 0 && !otpLoading && (
                              <p className={clsx(
                                'text-xs text-center',
                                otpExpiry <= 60 ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'
                              )}>
                                {t('codeExpiresIn', {
                                  minutes: String(Math.floor(otpExpiry / 60)).padStart(2, '0'),
                                  seconds: String(otpExpiry % 60).padStart(2, '0'),
                                })}
                              </p>
                            )}
                            {otpError && (
                              <p className="text-sm text-red-600 dark:text-red-400 text-center" role="alert">
                                {otpError}
                              </p>
                            )}
                            <Button
                              onClick={() => handleVerifyOtp()}
                              disabled={otpLoading || otpCode.length !== OTP_LENGTH}
                              size="lg"
                              className="w-full transition-all hover:shadow-lg"
                            >
                              {otpLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                                  {t('verifyingCode')}
                                </span>
                              ) : t('verifyCode')}
                            </Button>
                            <div className="flex items-center justify-between text-sm">
                              <button
                                type="button"
                                onClick={() => { setOtpStep('phone'); setOtpError(''); setOtpCode(''); }}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
                                <span dir="ltr">{phoneE164}</span>
                              </button>
                              {resendCountdown > 0 ? (
                                <span className="text-muted-foreground">
                                  {t('resendIn', { seconds: resendCountdown })}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={handleRequestOtp}
                                  disabled={otpLoading}
                                  className="text-brand-600 dark:text-brand-400 font-medium hover:underline disabled:opacity-50"
                                >
                                  {t('resendCode')}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      /* ── Phone auth disabled: Facebook only ── */
                      <Button
                        onClick={handleFacebookLogin}
                        disabled={isRedirecting}
                        size="lg"
                        className="w-full bg-[#166FE5] hover:bg-[#1258B8] text-white py-4 sm:py-8 max-lg:landscape:py-2.5 rounded-2xl shadow-xl shadow-blue-500/25 hover:shadow-2xl hover:shadow-blue-500/40 ring-4 ring-blue-400/15 font-bold text-lg lg:text-xl max-lg:landscape:text-base transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-70 disabled:cursor-default disabled:scale-100"
                      >
                        <div className="flex items-center justify-center gap-3 text-white">
                          <FacebookIcon className="w-6 h-6 lg:w-7 lg:h-7" aria-hidden="true" />
                          <span className="text-white">{t('loginWithFacebook')}</span>
                        </div>
                      </Button>
                    )}

                    {/* Demo Mode — hidden during OTP entry */}
                    {!isOtpStep && <DemoLoginButton />}

                    {/* Terms — inline so it stays visible when keyboard is open */}
                    <p className="text-xs text-muted-foreground text-center pt-1 pb-8">
                      {t('termsAgreement')}
                      <Link href="/terms" className="text-brand-600 font-bold hover:underline mx-1">{t('termsOfService')}</Link>
                      {t('and')}
                      <Link href="/privacy" className="text-brand-600 font-bold hover:underline mx-1">{t('privacyPolicy')}</Link>
                    </p>
                  </div>
                </div>
              </div>
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
