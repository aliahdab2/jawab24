import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { MessageCircle, Facebook, ArrowRight, ArrowLeft, MessageSquare, Zap, Globe } from 'lucide-react';
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
    { icon: MessageSquare, titleKey: 'auth.features.autoReply', descKey: 'auth.features.autoReplyDesc' },
    { icon: Zap, titleKey: 'auth.features.ai', descKey: 'auth.features.aiDesc' },
    { icon: Globe, titleKey: 'auth.features.multiLang', descKey: 'auth.features.multiLangDesc' },
  ];

  // Fallback for features (in case translations are missing)
  const featuresFallback = [
    { icon: MessageSquare, title: 'جواب تلقائي', description: 'ردود فورية على التعليقات' },
    { icon: Zap, title: 'ذكاء اصطناعي', description: 'ردود ذكية ومناسبة للسياق' },
    { icon: Globe, title: 'متعدد اللغات', description: 'عربي، إنجليزي والمزيد' },
  ];

  return (
    <>
      <Head>
        <title>{t('auth.login')} | Jawab24</title>
      </Head>
      <div className="min-h-screen flex" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Left Panel - Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-surface-900 via-surface-800 to-surface-900 relative overflow-hidden">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-96 h-96 bg-brand-500 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-accent-500 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
          </div>
          
          <div className="relative z-10 flex flex-col justify-center px-12 lg:px-16">
            {/* Logo */}
            <div className="flex items-center gap-3 mb-12">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center shadow-2xl shadow-brand-500/30">
                <MessageCircle className="w-7 h-7 text-white" />
              </div>
              <span className="font-display font-bold text-3xl text-white">Jawab24</span>
            </div>
            
            {/* Tagline */}
            <h1 className="text-4xl lg:text-5xl font-display font-bold text-white mb-6 leading-tight">
              ردود ذكية
              <span className="block gradient-text">على مدار الساعة</span>
            </h1>
            <p className="text-lg text-surface-300 mb-12 max-w-md">
              وفّر ساعات يومياً مع الردود التلقائية الذكية على تعليقات صفحتك على فيسبوك
            </p>
            
            {/* Features */}
            <div className="space-y-6">
              {featuresFallback.map((feature, i) => (
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
        <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden flex items-center justify-center gap-3 mb-12">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <span className="font-display font-bold text-2xl">Jawab24</span>
            </div>
            
            <div className="text-center mb-10">
              <h2 className="text-2xl lg:text-3xl font-display font-bold text-surface-900 mb-3">
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
    </>
  );
}
