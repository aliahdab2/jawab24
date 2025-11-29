import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { MessageCircle, Facebook, ArrowRight, ArrowLeft, MessageSquare, Zap, Globe, Shield, Clock, Star } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const { setAuth, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
  if (isAuthenticated) {
    router.push('/dashboard');
    return null;
  }

  const handleFacebookLogin = () => {
    setLoading(true);
    
    // Demo mode - simulate successful login
    // In production, this would redirect to Facebook OAuth
    setTimeout(() => {
      setAuth(
        { id: 'demo-user', name: 'مستخدم تجريبي', email: 'demo@jawab24.com', facebookId: 'demo123' },
        'demo-token-123'
      );
      router.push('/dashboard');
    }, 1500);
  };

  const features = [
    { icon: MessageSquare, title: 'جواب تلقائي', description: 'ردود فورية على التعليقات' },
    { icon: Zap, title: 'ذكاء اصطناعي', description: 'ردود ذكية ومناسبة للسياق' },
    { icon: Globe, title: 'متعدد اللغات', description: 'عربي، إنجليزي والمزيد' },
  ];

  const stats = [
    { value: '24/7', label: 'متاح دائماً' },
    { value: '<1s', label: 'سرعة الرد' },
    { value: '99%', label: 'دقة الردود' },
  ];

  return (
    <>
      <Head>
        <title>{t('auth.login')} | Jawab24</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>
      
      <div className="min-h-screen bg-gradient-to-br from-surface-50 via-white to-brand-50" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Desktop Layout */}
        <div className="hidden lg:flex min-h-screen">
          {/* Left Panel - Branding */}
          <div className="w-1/2 bg-gradient-to-br from-surface-900 via-surface-800 to-surface-900 relative overflow-hidden flex items-center">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 left-0 w-96 h-96 bg-brand-500 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
              <div className="absolute bottom-0 right-0 w-96 h-96 bg-accent-500 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
            </div>
            
            <div className="relative z-10 px-12 xl:px-16 w-full">
              {/* Logo */}
              <div className="flex items-center gap-3 mb-12">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center shadow-2xl shadow-brand-500/30">
                  <MessageCircle className="w-7 h-7 text-white" />
                </div>
                <span className="font-display font-bold text-3xl text-white">Jawab24</span>
              </div>
              
              {/* Tagline */}
              <h1 className="text-4xl xl:text-5xl font-display font-bold text-white mb-6 leading-tight">
                ردود ذكية
                <span className="block gradient-text">على مدار الساعة</span>
              </h1>
              <p className="text-lg text-surface-300 mb-12 max-w-md">
                وفّر ساعات يومياً مع الردود التلقائية الذكية على تعليقات صفحتك على فيسبوك
              </p>
              
              {/* Features */}
              <div className="space-y-6">
                {features.map((feature, i) => (
                  <div 
                    key={feature.title}
                    className="flex items-center gap-4 animate-slide-up"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  >
                    <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                      <feature.icon className="w-6 h-6 text-brand-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{feature.title}</h3>
                      <p className="text-sm text-surface-400">{feature.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Right Panel - Login Form */}
          <div className="w-1/2 flex items-center justify-center p-16">
            <div className="w-full max-w-md">
              <div className="text-center mb-10">
                <h2 className="text-3xl font-display font-bold text-surface-900 mb-3">
                  {t('auth.welcome')}
                </h2>
                <p className="text-surface-500">
                  {t('auth.loginDescription')}
                </p>
              </div>
              
              {/* Login Button */}
              <Button
                onClick={handleFacebookLogin}
                loading={loading}
                className="w-full bg-[#1877F2] hover:bg-[#166FE5] shadow-lg shadow-[#1877F2]/25"
                size="lg"
              >
                <Facebook className="w-5 h-5" />
                {t('auth.loginWithFacebook')}
                {isRTL ? <ArrowLeft className="w-4 h-4 ms-auto" /> : <ArrowRight className="w-4 h-4 ms-auto" />}
              </Button>
              
              <p className="mt-8 text-center text-sm text-surface-500">
                {t('auth.termsAgreement')}{' '}
                <a href="#" className="text-brand-600 hover:underline">{t('auth.termsOfService')}</a>
                {' '}{t('auth.and')}{' '}
                <a href="#" className="text-brand-600 hover:underline">{t('auth.privacyPolicy')}</a>
              </p>
              
              {/* Demo Notice */}
              <div className="mt-8 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-sm text-amber-800 text-center">
                  <strong>{t('auth.demoMode')}</strong> {t('auth.demoDescription')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="lg:hidden min-h-screen flex flex-col">
          {/* Header with gradient background */}
          <div className="bg-gradient-to-br from-surface-900 via-surface-800 to-surface-900 px-6 pt-12 pb-16 relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500 rounded-full blur-3xl translate-x-1/2 -translate-y-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent-500 rounded-full blur-3xl -translate-x-1/2 translate-y-1/2" />
            </div>
            
            <div className="relative z-10">
              {/* Logo */}
              <div className="flex items-center justify-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center shadow-xl">
                  <MessageCircle className="w-6 h-6 text-white" />
                </div>
                <span className="font-display font-bold text-2xl text-white">Jawab24</span>
              </div>
              
              {/* Tagline */}
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-3 leading-tight">
                ردود ذكية على مدار الساعة
              </h1>
              <p className="text-surface-300 text-center text-sm sm:text-base max-w-xs mx-auto">
                وفّر وقتك مع الردود التلقائية الذكية
              </p>
              
              {/* Stats Row */}
              <div className="flex justify-center gap-6 mt-8">
                {stats.map((stat) => (
                  <div key={stat.label} className="text-center">
                    <div className="text-xl font-bold text-brand-400">{stat.value}</div>
                    <div className="text-xs text-surface-400">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Login Card - overlapping the header */}
          <div className="flex-1 px-6 -mt-8 pb-8">
            <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 max-w-sm mx-auto">
              <div className="text-center mb-6">
                <h2 className="text-xl font-display font-bold text-surface-900 mb-2">
                  {t('auth.welcome')}
                </h2>
                <p className="text-surface-500 text-sm">
                  {t('auth.loginDescription')}
                </p>
              </div>
              
              {/* Login Button */}
              <Button
                onClick={handleFacebookLogin}
                loading={loading}
                className="w-full bg-[#1877F2] hover:bg-[#166FE5] shadow-lg shadow-[#1877F2]/25"
                size="lg"
              >
                <Facebook className="w-5 h-5" />
                {t('auth.loginWithFacebook')}
              </Button>
              
              {/* Features - compact mobile version */}
              <div className="mt-6 pt-6 border-t border-surface-100">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {features.map((feature) => (
                    <div key={feature.title} className="p-2">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center mx-auto mb-2">
                        <feature.icon className="w-5 h-5 text-brand-600" />
                      </div>
                      <p className="text-xs text-surface-600 font-medium">{feature.title}</p>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Demo Notice */}
              <div className="mt-6 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-800 text-center">
                  <strong>{t('auth.demoMode')}</strong> {t('auth.demoDescription')}
                </p>
              </div>
              
              {/* Terms */}
              <p className="mt-4 text-center text-xs text-surface-400">
                {t('auth.termsAgreement')}{' '}
                <a href="#" className="text-brand-600">{t('auth.termsOfService')}</a>
                {' '}{t('auth.and')}{' '}
                <a href="#" className="text-brand-600">{t('auth.privacyPolicy')}</a>
              </p>
            </div>
          </div>

          {/* Bottom safe area */}
          <div className="h-safe-area-inset-bottom" />
        </div>
      </div>
    </>
  );
}
