import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { 
  Facebook, 
  MessageCircle, 
  CheckCircle2, 
  Zap, 
  ShieldCheck, 
  ArrowLeft, 
  ArrowRight, 
  Sparkles,
  Lock,
  MessageSquare,
  Bot,
  Globe,
  Star,
  Smartphone,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();
  const isRTL = language === 'ar';
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleFacebookLogin = () => {
    setLoading(true);
    
    // Build Facebook OAuth URL
    const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const scope = encodeURIComponent('pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement,pages_messaging,instagram_basic,instagram_manage_comments,instagram_manage_messages');
    
    const facebookAuthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;
    
    window.location.href = facebookAuthUrl;
  };

  const toggleLanguage = () => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  };

  const features = [
    {
      icon: Zap,
      title: isRTL ? 'تفعيل فوري' : 'Instant Setup',
      desc: isRTL ? 'اربط صفحتك وابدأ الردود في دقيقة واحدة' : 'Connect your page and start replying in 1 minute',
      color: 'text-amber-500',
      bg: 'bg-amber-50'
    },
    {
      icon: ShieldCheck,
      title: isRTL ? 'آمن ومعتمد' : 'Secure & Official',
      desc: isRTL ? 'نستخدم واجهة Meta الرسمية لحماية بياناتك' : 'We use official Meta APIs to protect your data',
      color: 'text-brand-600',
      bg: 'bg-brand-50'
    },
    {
      icon: MessageSquare,
      title: isRTL ? 'دقة مذهلة' : 'Amazing Accuracy',
      desc: isRTL ? 'ردود ذكية تفهم لهجات عملائك بدقة' : 'Smart replies that understand your customers\' dialects',
      color: 'text-violet-600',
      bg: 'bg-violet-50'
    }
  ];

  return (
    <>
      <Head>
        <title>{isRTL ? 'تسجيل الدخول - Jawab24' : 'Login - Jawab24'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      </Head>

      <div className="min-h-screen bg-white flex flex-col lg:flex-row" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Left Side: Visual/Marketing (Hidden on mobile) */}
        <div className="hidden lg:flex lg:w-[55%] relative bg-surface-900 overflow-hidden items-center justify-center p-20">
          {/* Animated Background */}
          <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.15),transparent)]"></div>
          <div className="absolute bottom-0 left-0 w-full h-full bg-[radial-gradient(circle_at_bottom_left,rgba(139,92,246,0.15),transparent)]"></div>
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>

          <div className="relative z-10 w-full max-w-2xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 mb-12 animate-slide-up">
              <Sparkles className="w-4 h-4 text-brand-400" />
              <span className="text-sm font-bold text-brand-400 uppercase tracking-widest">
                {isRTL ? 'الجيل القادم من الردود التلقائية' : 'Next-Gen Auto Replies'}
              </span>
            </div>

            <h1 className="text-5xl lg:text-6xl font-display font-extrabold text-white mb-8 leading-tight tracking-tight animate-slide-up animation-delay-100">
              {isRTL ? 'ابدأ رحلة' : 'Start Your'}
              <span className="block text-brand-500">{isRTL ? 'النمو الذكي لعملك' : 'Smart Growth Journey'}</span>
            </h1>

            <p className="text-xl text-surface-400 mb-16 leading-relaxed font-medium animate-slide-up animation-delay-200">
              {isRTL 
                ? 'انضم إلى آلاف أصحاب الصفحات الذين يثقون بـ Jawab24 لإدارة تفاعلاتهم وزيادة مبيعاتهم باستخدام الذكاء الاصطناعي.'
                : 'Join thousands of page owners who trust Jawab24 to manage their engagements and boost sales using AI.'}
            </p>

            <div className="grid grid-cols-1 gap-8 animate-slide-up animation-delay-300">
              {features.map((f, i) => (
                <div key={i} className="flex gap-6 items-start group">
                  <div className={`w-14 h-14 rounded-2xl ${f.bg} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 shadow-lg`}>
                    <f.icon className={`w-7 h-7 ${f.color}`} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white mb-2">{f.title}</h3>
                    <p className="text-surface-400 font-medium">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Testimonial Snippet */}
            <div className="mt-20 p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-sm animate-slide-up animation-delay-500">
              <div className="flex gap-1 mb-4">
                {[1,2,3,4,5].map(s => <Star key={s} className="w-4 h-4 text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-white font-medium italic mb-4">
                {isRTL 
                  ? '"وفر لي ساعات من العمل يومياً، والعملاء منبهرون بسرعة الرد ودقته!"' 
                  : '"Saved me hours of work daily, and customers are impressed with the speed and accuracy!"'}
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-500 flex items-center justify-center text-white font-bold text-xs">MA</div>
                <div>
                  <div className="text-white font-bold text-sm">Mohammed A.</div>
                  <div className="text-surface-500 text-xs font-bold uppercase tracking-widest">{isRTL ? 'مدير تسويق' : 'Marketing Manager'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Login Form */}
        <div className="flex-1 flex flex-col bg-white overflow-y-auto">
          {/* Mobile Nav */}
          <div className="flex items-center justify-between p-6 lg:p-12">
            <div className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-lg group-hover:rotate-6 transition-transform">
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <span className="font-display font-bold text-xl text-surface-900 tracking-tight">Jawab24</span>
            </div>
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
                  {isRTL ? 'مرحباً بك مجدداً' : 'Welcome Back'}
                </h2>
                <p className="text-lg text-surface-500 font-medium">
                  {isRTL ? 'سجل دخولك لتبدأ إدارة مبيعاتك بذكاء' : 'Sign in to start managing your sales smartly'}
                </p>
              </div>

              <div className="space-y-6">
                <Button
                  onClick={handleFacebookLogin}
                  disabled={loading}
                  size="lg"
                  className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-8 rounded-2xl shadow-xl shadow-blue-500/20 font-bold text-lg group transition-all active:scale-95"
                >
                  {loading ? (
                    <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Facebook className="w-6 h-6 mr-2" />
                      {isRTL ? 'تسجيل الدخول باستخدام فيسبوك' : 'Login with Facebook'}
                    </>
                  )}
                </Button>

                <div className="flex items-center gap-4 py-4">
                  <div className="flex-1 h-px bg-surface-100"></div>
                  <span className="text-surface-400 font-bold text-xs uppercase tracking-widest">{isRTL ? 'أو' : 'OR'}</span>
                  <div className="flex-1 h-px bg-surface-100"></div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-surface-50 border border-surface-100 flex flex-col items-center justify-center text-center group hover:bg-white hover:border-brand-200 transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <HelpCircle className="w-5 h-5 text-surface-400 group-hover:text-brand-600" />
                    </div>
                    <span className="text-xs font-bold text-surface-600 uppercase tracking-tight">{isRTL ? 'مركز المساعدة' : 'Help Center'}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-surface-50 border border-surface-100 flex flex-col items-center justify-center text-center group hover:bg-white hover:border-brand-200 transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <Globe className="w-5 h-5 text-surface-400 group-hover:text-brand-600" />
                    </div>
                    <span className="text-xs font-bold text-surface-600 uppercase tracking-tight">{isRTL ? 'المدونة' : 'Our Blog'}</span>
                  </div>
                </div>

                <div className="p-6 rounded-3xl bg-brand-50/50 border border-brand-100 mt-12">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-brand-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-brand-900 text-sm mb-1">{isRTL ? 'هل تعلم؟' : 'Did you know?'}</h4>
                      <p className="text-brand-700/80 text-sm font-medium leading-relaxed">
                        {isRTL 
                          ? 'الردود الفورية تزيد من فرصة إتمام البيع بنسبة تزيد عن 60%.' 
                          : 'Instant replies increase the chance of closing a sale by more than 60%.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-12 text-center">
                <p className="text-sm text-surface-400 font-medium">
                  {isRTL ? 'بتسجيل دخولك، أنت توافق على' : 'By signing in, you agree to our'}
                  <br className="sm:hidden" />
                  <Link href="/terms" className="text-brand-600 font-bold hover:underline mx-1">{isRTL ? 'شروط الخدمة' : 'Terms of Service'}</Link>
                  {isRTL ? 'و' : '&'}
                  <Link href="/privacy" className="text-brand-600 font-bold hover:underline mx-1">{isRTL ? 'سياسة الخصوصية' : 'Privacy Policy'}</Link>
                </p>
              </div>
            </div>
          </div>

          {/* Footer Info */}
          <div className="p-8 border-t border-surface-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs font-bold text-surface-400 uppercase tracking-widest">
              © {new Date().getFullYear()} Jawab24
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-xs font-bold text-surface-500 uppercase tracking-widest">{isRTL ? 'الأنظمة تعمل' : 'Systems Active'}</span>
              </div>
              <div className="w-px h-4 bg-surface-100"></div>
              <span className="text-xs font-bold text-surface-500 uppercase tracking-widest">v2.4.0</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
