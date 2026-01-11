import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  Zap,
  ShieldCheck,
  Sparkles,
  MessageSquare,

  Star
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button, PremiumSpinner, FacebookIcon } from '@/components/ui';
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
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // Import dynamically to avoid SSR issues
  // import { FacebookLogin, FacebookLoginResponse } from '@capacitor-community/facebook-login';

  const handleFacebookLogin = async () => {
    try {
      // Check for Facebook App ID
      const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
      if (!fbAppId) {
        toast.error(t('auth.loginError'));
        return;
      }

      // Check if running in Native Mobile App
      const cap = (window as any).Capacitor;
      const isMobile = cap?.isNativePlatform?.();

      if (isMobile) {
        // --- NATIVE MOBILE LOGIN FLOW ---
        // DO NOT set isLoading(true) here yet, as it triggers our button spinner 
        // while the native system dialog is already visible ("Double Spinner" issue).
        const { FacebookLogin } = await import('@capacitor-community/facebook-login');
        
        // 1. Request Native Login
        const permissions = ['email', 'public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_messaging'];
        let result;
        try {
            result = await FacebookLogin.login({ permissions });
        } catch (fbError: any) {
            console.error('FB Native Login Error:', fbError);
            throw fbError;
        }

        if (result.accessToken) {
          // 2. NOW set loading state - The native dialog has closed, and we're starting our backend sync.
          setIsLoading(true);
          const fbAccessToken = result.accessToken.token;
          
          try {
              // 3. Call backend to swap fbAccessToken for Session Token
              const response = await authApi.nativeFacebookLogin(fbAccessToken);
              const { user, token, settings } = response.data;
              
              // 4. Set Auth State (Client Side)
              setAuth(user, token, fbAccessToken);
              
              const finalLocale = settings?.dashboardLanguage || language || 'ar';
              useUIStore.getState().setLanguage(finalLocale);

              // 5. Handle Redirect
              const returnUrl = router.query.redirect as string || '/dashboard';
              await router.push(returnUrl, returnUrl, { locale: finalLocale });

          } catch (error: any) {
              console.error('Backend Login Error:', error);
              toast.error(t('auth.loginError'));
              setIsLoading(false);
          }

        } else {
          // User cancelled or no token
          setIsLoading(false);
        }

      } else {
        // --- WEB BROWSER LOGIN FLOW ---
        setIsLoading(true); // Web redirect is fine to spin immediately
        
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';
        const normalizedOrigin = siteUrl.replace(/\/$/, '');
        const localePath = language === 'ar' ? '' : `/${language}`;

        const origin = window.location.hostname === 'localhost' ? window.location.origin : normalizedOrigin;
        const redirectUriClean = `${origin}${localePath}${FB_CALLBACK_PATH}`;
        const redirectUri = encodeURIComponent(redirectUriClean);

        const scope = encodeURIComponent('email,pages_show_list,pages_read_engagement,pages_messaging');
        
        const urlParams = new URLSearchParams(window.location.search);
        const returnUrl = urlParams.get('redirect') || router.query.redirect as string || '/dashboard';
        
        const stateData = `${returnUrl}|web|${language}`;
        const state = encodeURIComponent(stateData);

        const isMobileWeb = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const displayMode = isMobileWeb ? 'touch' : 'page';

        const facebookAuthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}&display=${displayMode}`;

        window.location.href = facebookAuthUrl;
      }
    } catch (error: any) {
        console.error('Facebook login error:', error);
        
        const errorMsg = error.response?.data?.message || error.message || t('auth.loginError');
        toast.error(errorMsg);
        setIsLoading(false); // Only stop loading on error
      }
    }
    // Removed finally block to prevent flash on success redirect

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

      <div className="min-h-screen bg-white flex flex-col lg:flex-row" dir={isRTL ? 'rtl' : 'ltr'}>
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

        {/* Right Side: Login Form (Redesigned) */}
        <div className="flex-1 flex flex-col bg-white overflow-y-auto">
          {/* Mobile Header: Minimal - Just Language Toggle */}
          <div className="w-full flex justify-end p-6 pt-safe">
             <button
              onClick={toggleLanguage}
              className="text-xs font-bold text-surface-400 hover:text-brand-600 transition-colors uppercase tracking-widest"
            >
              {language === 'ar' ? 'EN | AR' : 'EN | AR'}
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center px-6 pt-8 pb-12 sm:justify-center sm:pt-0">
            <div className="w-full max-w-md">
              
              {/* Hero Brand Section */}
              <div className="text-center mb-10">
                 <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-6 bg-gradient-to-br from-brand-500 to-brand-600 rounded-[28px] shadow-2xl shadow-brand-500/20 flex items-center justify-center transform hover:scale-105 transition-transform duration-500">
                    <span className="text-white text-4xl sm:text-5xl font-bold">ج</span>
                 </div>
                 <h1 className="text-2xl sm:text-3xl font-display font-bold text-surface-900 tracking-tight mb-2">
                   Jawab24
                 </h1>
                 <p className="text-surface-400 font-medium text-sm sm:text-base">
                   {t('auth.welcomeBackDesc')}
                 </p>
              </div>

               <div className="text-center mb-10">
                <h2 className="text-xl font-display font-bold text-surface-900">
                  {t('auth.welcomeBack')}
                </h2>
                <p className="text-sm text-surface-500 font-medium mt-1">
                   Log in to continue your journey with us.
                </p>
              </div>


              <div className="space-y-6">
                <Button
                  onClick={handleFacebookLogin}
                  size="lg"
                  className={`w-full bg-[#1877F2] hover:bg-[#166fe5] text-white rounded-2xl shadow-xl shadow-blue-500/20 font-bold text-lg group transition-all active:scale-95 ${isLoading ? 'py-4 opacity-90 cursor-wait' : 'py-5'}`}
                  disabled={isLoading}
                >
                  <div className="flex items-center justify-center gap-3">
                    {isLoading ? (
                      <>
                        <PremiumSpinner size="sm" color="white" />
                        <span className="text-base font-medium animate-pulse">{t('auth.redirecting')}</span>
                      </>
                    ) : (
                      <>
                        <FacebookIcon className="w-6 h-6" />
                        <span>{t('auth.loginWithFacebook')}</span>
                      </>
                    )}
                  </div>
                </Button>

                {/* Trust Badge / Did you know */}
                <div className="flex flex-col items-center gap-3 mt-8">
                   <ShieldCheck className="w-6 h-6 text-emerald-500" />
                   <div className="text-center">
                      <h4 className="font-bold text-surface-900 text-sm mb-1">{t('auth.didYouKnow')}</h4>
                      <p className="text-surface-500 text-xs font-medium max-w-xs mx-auto leading-relaxed">
                        {t('auth.didYouKnowDesc')}
                      </p>
                   </div>
                </div>
              </div>

              <div className="mt-12 text-center">
                <p className="text-xs text-surface-400 font-medium">
                  {t('auth.termsAgreement')}
                  <br className="sm:hidden" />
                  <Link href="/terms" className="text-surface-600 font-bold hover:underline mx-1">{t('auth.termsOfService')}</Link>
                  {t('auth.and')}
                  <Link href="/privacy" className="text-surface-600 font-bold hover:underline mx-1">{t('auth.privacyPolicy')}</Link>
                </p>
              </div>
            </div>
          </div>

          {/* Footer Info */}
          <div className="p-4 pb-safe border-t border-transparent flex flex-col items-center justify-center gap-1 opacity-50">
            <div className="text-[10px] font-medium text-surface-300 tracking-wider">
              © {new Date().getFullYear()} Jawab24
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
