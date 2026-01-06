
import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  Facebook,
  Zap,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Bot,
  Star
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button, BrandLogo } from '@/components/ui';
import { useVersion } from '@/lib/useVersion';
import Link from 'next/link';
import { BRAND_ASSETS } from '@/constants/brand';

export default function LoginPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();

  const isRTL = language === 'ar';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleFacebookLogin = () => {
    try {
      // Build Facebook OAuth URL
      const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;

      if (!fbAppId) {
        console.error('FB_APP_ID is not configured');
        alert('Login is not configured. Please contact support.');
        return;
      }

      // Use locale-specific callback URL (standard best practice)
      // Arabic (default): /auth/callback
      // English: /en/auth/callback
      const localePath = language === 'ar' ? '' : `/${language}`;
      const redirectUri = encodeURIComponent(`${window.location.origin}${localePath}/auth/callback`);
      // Using minimal scopes that work in Development mode
      // - email: Get user's email address (required for account notifications)
      // - pages_*: Manage Facebook pages
      // Advanced scopes (pages_manage_posts, instagram_*) require App Review
      const scope = encodeURIComponent('email,pages_show_list,pages_read_engagement,pages_messaging');

      // Get the redirect URL from query params (e.g., /checkout?planId=xxx)
      const returnUrl = router.query.redirect as string || '/dashboard';
      // Encode the return URL in the state parameter so we can use it after OAuth
      const state = encodeURIComponent(returnUrl);

      const facebookAuthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;

      window.location.href = facebookAuthUrl;
    } catch (error) {
      console.error('Error initiating Facebook login:', error);
      alert('Failed to start login. Please try again.');
    }
  };

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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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

        {/* Right Side: Login Form */}
        <div className="flex-1 flex flex-col bg-white overflow-y-auto">
          {/* Mobile Nav */}
          <div className="flex items-center justify-between p-6 lg:p-12">
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

          <div className="flex-1 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-md">
              <div className="text-center lg:text-start mb-12">
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
                  <Facebook className="w-6 h-6 ltr:mr-2 rtl:ml-2" />
                  {t('auth.loginWithFacebook')}
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

              <div className="mt-12 text-center">
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

          {/* Footer Info */}
          <div className="p-4 border-t border-surface-100 flex items-center justify-center">
            <div className="text-[10px] font-medium text-surface-300 tracking-wider">
              © {new Date().getFullYear()} Jawab24
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
