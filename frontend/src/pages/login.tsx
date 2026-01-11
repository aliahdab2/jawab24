import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Capacitor } from '@capacitor/core';
import {
  Zap,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Bot,
  Star
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button, BrandLogo, FacebookIcon, AppSkeleton } from '@/components/ui';
import Link from 'next/link';
import { BRAND_ASSETS } from '@/constants/brand';
import { FB_CALLBACK_PATH } from '@/constants/auth';

import { authApi } from '@/lib/api';
import { useAuthStore, useUIStore } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();
  const setAuth = useAuthStore((state) => state.setAuth);

  const isRTL = language === 'ar';
  const [mounted, setMounted] = useState(false);
  // isProcessing: true after Facebook returns, while we authenticate with backend
  // This shows a blank screen instead of the login page to avoid flashing
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Pre-loaded Facebook SDK reference to avoid delay on button tap
  const fbSdkRef = useRef<any>(null);

  useEffect(() => {
    setMounted(true);
    
    // Pre-initialize Facebook SDK on native platforms
    // This eliminates the delay when user taps the login button
    const preInitFacebookSDK = async () => {
      if (!Capacitor.isNativePlatform()) return;
      
      const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
      if (!fbAppId) return;
      
      try {
        const { FacebookLogin } = await import('@capacitor-community/facebook-login');
        fbSdkRef.current = FacebookLogin;
        await FacebookLogin.initialize({ appId: fbAppId });
      } catch {
        // Initialization failed or already initialized - that's OK
      }
    };
    
    preInitFacebookSDK();
  }, []);

  if (!mounted) return null;

  // Show dashboard skeleton while processing auth (after Facebook returns)
  // This gives a preview of the dashboard they're about to see
  if (isProcessing) {
    return <AppSkeleton variant="dashboard" />;
  }

  // Import dynamically to avoid SSR issues
  // import { FacebookLogin, FacebookLoginResponse } from '@capacitor-community/facebook-login';

  const handleFacebookLogin = async () => {
    // Check for Facebook App ID
    const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
    if (!fbAppId) {
      toast.error(t('auth.loginError'));
      return;
    }

    // Check if running in Native Mobile App
    const isMobile = Capacitor.isNativePlatform();

    if (isMobile) {
      // --- NATIVE MOBILE LOGIN FLOW ---
      try {
        // Use pre-loaded SDK if available, otherwise load now
        let FacebookLogin = fbSdkRef.current;
        if (!FacebookLogin) {
          const fbModule = await import('@capacitor-community/facebook-login');
          FacebookLogin = fbModule.FacebookLogin;
          try {
            await FacebookLogin.initialize({ appId: fbAppId });
          } catch {
            // May already be initialized - that's OK
          }
        }
        
        // Open native Facebook login dialog immediately - no loading spinner
        const permissions = ['email', 'public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_messaging'];
        const result = await FacebookLogin.login({ permissions });

        if (!result.accessToken) {
          // User cancelled - stay on login page
          return;
        }

        // Facebook returned! Show dashboard skeleton while we authenticate with backend
        setIsProcessing(true);

        // Exchange FB token for our session token
        const response = await authApi.nativeFacebookLogin(result.accessToken.token);
        const { user, token, settings } = response.data;
        
        // Set auth state
        setAuth(user, token, result.accessToken.token);
        
        const finalLocale = settings?.dashboardLanguage || language || 'ar';
        useUIStore.getState().setLanguage(finalLocale);

        // Navigate to dashboard
        const returnUrl = router.query.redirect as string || '/dashboard';
        await router.push(returnUrl, returnUrl, { locale: finalLocale });

      } catch (error: any) {
        console.error('Native login error:', error);
        toast.error(error.response?.data?.message || t('auth.loginError'));
        setIsProcessing(false);
      }

    } else {
      // --- WEB BROWSER LOGIN FLOW ---
      // Redirect immediately to Facebook - no loading spinner
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';
      const normalizedOrigin = siteUrl.replace(/\/$/, '');
      const localePath = language === 'ar' ? '' : `/${language}`;
      const origin = window.location.hostname === 'localhost' ? window.location.origin : normalizedOrigin;
      const redirectUri = encodeURIComponent(`${origin}${localePath}${FB_CALLBACK_PATH}`);
      const scope = encodeURIComponent('email,pages_show_list,pages_read_engagement,pages_messaging');
      
      const urlParams = new URLSearchParams(window.location.search);
      const returnUrl = urlParams.get('redirect') || router.query.redirect as string || '/dashboard';
      const state = encodeURIComponent(`${returnUrl}|web|${language}`);

      const isMobileWeb = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const displayMode = isMobileWeb ? 'touch' : 'page';

      window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}&display=${displayMode}`;
      // Note: isLoggingIn stays true as page navigates away
    }
  }

  const toggleLanguage = () => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  };

  const features = [
    {
      icon: Zap,
      title: t('auth.instantSetup'),
      desc: t('auth.instantSetupDesc'),
      color: 'text-amber-500',
      bg: 'bg-amber-50'
    },
    {
      icon: ShieldCheck,
      title: t('auth.secureOfficial'),
      desc: t('auth.secureOfficialDesc'),
      color: 'text-brand-600',
      bg: 'bg-brand-50'
    },
    {
      icon: MessageSquare,
      title: t('auth.amazingAccuracy'),
      desc: t('auth.amazingAccuracyDesc'),
      color: 'text-violet-600',
      bg: 'bg-violet-50'
    }
  ];

  return (
    <>
      <Head>
        <title>{BRAND_ASSETS.meta.appTitle} - {t('auth.login')}</title>
        <meta name="description" content={t('auth.seoDescription')} />
        <meta name="keywords" content={t('auth.seoKeywords')} />
        <link rel="canonical" href="https://jawab24.com/login" />
        <meta property="og:title" content={t('auth.ogTitle')} />
        <meta property="og:description" content={t('auth.ogDescription')} />
        <meta property="og:url" content="https://jawab24.com/login" />
      </Head>

      <div className="h-[100svh] bg-white flex flex-col lg:flex-row overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Left Side: Visual/Marketing (Hidden on mobile) */}
        <div className="hidden lg:flex lg:w-[55%] relative bg-surface-900 overflow-hidden items-center justify-center p-10 xl:p-16">
          {/* Animated Background */}
          <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.15),transparent)]"></div>
          <div className="absolute bottom-0 left-0 w-full h-full bg-[radial-gradient(circle_at_bottom_left,rgba(139,92,246,0.15),transparent)]"></div>
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>

          <div className="relative z-10 w-full max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/10 mb-6 animate-slide-up">
              <Sparkles className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-bold text-brand-400 uppercase tracking-widest">
                {t('auth.nextGenAutoReplies')}
              </span>
            </div>

            <h1 className="text-3xl xl:text-4xl font-display font-extrabold text-white mb-4 leading-tight tracking-tight animate-slide-up animation-delay-100">
              {t('auth.startYourJourney')}
              <span className="block text-brand-500">{t('auth.smartGrowthJourney')}</span>
            </h1>

            <p className="text-base text-surface-400 mb-8 leading-relaxed font-medium animate-slide-up animation-delay-200">
              {t('auth.journeyDesc')}
            </p>

            <div className="grid grid-cols-1 gap-4 animate-slide-up animation-delay-300">
              {features.map((f, i) => (
                <div key={i} className="flex gap-4 items-start group">
                  <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 shadow-lg`}>
                    <f.icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">{f.title}</h3>
                    <p className="text-sm text-surface-400 font-medium">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Testimonial Snippet */}
            <div className="mt-8 p-5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm animate-slide-up animation-delay-500">
              <div className="flex gap-1 mb-2">
                {[1, 2, 3, 4, 5].map(s => <Star key={s} className="w-3 h-3 text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-sm text-white font-medium italic mb-3">
                "{t('auth.testimonialQuote')}"
              </p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white font-bold text-xs">MA</div>
                <div>
                  <div className="text-white font-bold text-xs">Mohammed A.</div>
                  <div className="text-surface-500 text-[10px] font-bold uppercase tracking-widest">{t('auth.testimonialAuthor')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Login Form */}
        <div className="flex-1 flex flex-col bg-white min-h-0 overflow-hidden">
          {/* Header - Sticky so it stays visible when content scrolls + pt-safe for safe area */}
          <div className="sticky top-0 z-10 flex-shrink-0 bg-white flex items-center justify-between px-6 lg:px-12 h-16 sm:h-20 pt-safe box-content">
            <Link href="/landing" className="flex items-center gap-2 sm:gap-3 group">
              <BrandLogo
                variant="main"
                className="w-9 h-9 sm:w-12 sm:h-12 group-hover:rotate-6 transition-transform"
              />
              <span className="font-display font-bold text-lg sm:text-2xl text-surface-900 tracking-tight">{BRAND_ASSETS.meta.appName}</span>
            </Link>
            <button
              onClick={toggleLanguage}
              className="px-4 py-2 text-sm font-bold text-surface-600 hover:text-brand-600 rounded-xl hover:bg-brand-50 transition-all"
            >
              {language === 'ar' ? 'English' : 'العربية'}
            </button>
          </div>

          {/* Content:
              - Fixed height layout - NO scrolling on the login page
              - Uses flex to center content vertically
              - Only scrolls internally if content truly doesn't fit (very small screens) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-none px-6">
            <div className="h-full flex items-center justify-center py-4">
              <div className="w-full max-w-md">
                <div className="text-center lg:text-start mb-8">
                  <h2 className="text-4xl font-display font-extrabold text-surface-900 mb-4 tracking-tight">
                    {t('auth.welcomeBack')}
                  </h2>
                  <p className="text-lg text-surface-500 font-medium">
                    {t('auth.welcomeBackDesc')}
                  </p>
                </div>

                <div className="space-y-6">
                  <Button
                    onClick={handleFacebookLogin}
                    size="lg"
                    className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-8 rounded-2xl shadow-xl shadow-blue-500/20 font-bold text-lg group transition-all active:scale-95"
                  >
                    <div className="flex items-center justify-center gap-3">
                      <FacebookIcon className="w-6 h-6" />
                      <span>{t('auth.loginWithFacebook')}</span>
                    </div>
                  </Button>

                  <div className="p-6 rounded-3xl bg-brand-50/50 border border-brand-100 mt-8">
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-5 h-5 text-brand-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-brand-900 text-sm mb-1">{t('auth.didYouKnow')}</h4>
                        <p className="text-brand-700/80 text-sm font-medium leading-relaxed">
                          {t('auth.didYouKnowDesc')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 text-center">
                  <p className="text-sm text-surface-400 font-medium">
                    {t('auth.termsAgreement')}
                    <br className="sm:hidden" />
                    <Link href="/terms" className="text-brand-600 font-bold hover:underline mx-1">{t('auth.termsOfService')}</Link>
                    {t('auth.and')}
                    <Link href="/privacy" className="text-brand-600 font-bold hover:underline mx-1">{t('auth.privacyPolicy')}</Link>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Info - pb-safe for system navigation */}
          <div className="flex-shrink-0 p-4 border-t border-surface-100 flex flex-col items-center justify-center gap-1 pb-safe">
            <div className="text-[10px] font-medium text-surface-300 tracking-wider">
              © {new Date().getFullYear()} Jawab24
            </div>
            <div className="text-[10px] font-mono text-surface-200">
              v{process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString() : 'Dev'}
            </div>
          </div>
        </div>

        {/* Fixed top safe area background - prevents content from showing through status bar when scrolling */}
        <div
          className="lg:hidden fixed-safe-bg top-safe-bg bg-white"
          aria-hidden="true"
        />

        {/* Fixed bottom safe area background */}
        <div
          className="lg:hidden fixed-safe-bg bottom-safe-bg bg-surface-100"
          aria-hidden="true"
        />
      </div>
    </>
  );
}
