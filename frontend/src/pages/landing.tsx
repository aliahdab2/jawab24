import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { 
  MessageCircle, 
  Facebook, 
  ArrowRight, 
  ArrowLeft,
  MessageSquare, 
  Zap, 
  Globe, 
  Shield, 
  Clock, 
  Star,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Bot,
  Languages,
  BarChart3,
  BookOpen,
  Users,
  Instagram,
  Crown,
  Smartphone,
  CheckCircle2
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';

export default function LandingPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();
  const isRTL = language === 'ar';
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleLanguage = () => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  };

  const features = [
    {
      icon: Bot,
      title: isRTL ? 'ردود ذكية بالذكاء الاصطناعي' : 'AI-Powered Smart Replies',
      description: isRTL 
        ? 'ردود مخصصة وذكية تفهم سياق المحادثة وتوفر إجابات دقيقة لعملائك'
        : 'Custom, intelligent responses that understand context and provide accurate answers to your customers',
    },
    {
      icon: Instagram,
      title: isRTL ? 'دعم فيسبوك وإنستغرام' : 'Facebook & Instagram Support',
      description: isRTL 
        ? 'ردود تلقائية على التعليقات والرسائل في كلا المنصتين من مكان واحد'
        : 'Auto-reply to comments and messages on both platforms from one single place',
    },
    {
      icon: Languages,
      title: isRTL ? 'دعم العربية والإنجليزية' : 'Arabic & English Support',
      description: isRTL 
        ? 'ردود تلقائية بلغة العميل - سواء كان يكتب بالعربية أو الإنجليزية'
        : 'Auto-replies in your customer\'s language - whether they write in Arabic or English',
    },
    {
      icon: Zap,
      title: isRTL ? 'رد فوري 24/7' : 'Instant 24/7 Response',
      description: isRTL 
        ? 'لا تجعل عملائك ينتظرون أبداً، نرد في أقل من ثانية حتى وأنت نائم'
        : 'Never keep customers waiting, we respond in less than a second even while you sleep',
    },
    {
      icon: BookOpen,
      title: isRTL ? 'قاعدة معرفة مخصصة' : 'Custom Knowledge Base',
      description: isRTL 
        ? 'أضف معلومات عملك ومنتجاتك وأسعارك لتدريب الذكاء الاصطناعي الخاص بك'
        : 'Add your business info, products, and prices to train your own AI assistant',
    },
    {
      icon: Smartphone,
      title: isRTL ? 'متوافق مع الجوال' : 'Mobile Optimized',
      description: isRTL 
        ? 'أدِر عملك من أي مكان من خلال واجهة سهلة الاستخدام على جميع الأجهزة'
        : 'Manage your business from anywhere with an easy-to-use interface on all devices',
    },
  ];

  const howItWorks = [
    {
      step: '1',
      title: isRTL ? 'اربط صفحتك' : 'Connect Your Page',
      description: isRTL 
        ? 'سجل دخولك بفيسبوك واختر الصفحات التي تريد تفعيل الردود عليها'
        : 'Sign in with Facebook and select the pages you want to enable replies on',
    },
    {
      step: '2',
      title: isRTL ? 'أضف معلوماتك' : 'Add Your Info',
      description: isRTL 
        ? 'اكتب نبذة عن منتجاتك وأسعارك ليعرف الذكاء الاصطناعي كيف يجيب'
        : 'Write a brief about your products and prices so the AI knows how to answer',
    },
    {
      step: '3',
      title: isRTL ? 'ارتح وراقب' : 'Relax & Monitor',
      description: isRTL 
        ? 'اترك الردود لنا وتابع التفاعلات والنتائج من لوحة التحكم'
        : 'Leave the replies to us and monitor engagement and results from the dashboard',
    },
  ];

  const faqs = [
    {
      question: isRTL ? 'هل Jawab24 يدعم إنستغرام؟' : 'Does Jawab24 support Instagram?',
      answer: isRTL 
        ? 'نعم، Jawab24 يدعم كلاً من صفحات فيسبوك وحسابات إنستغرام التجارية المرتبطة بها في جميع الباقات.'
        : 'Yes, Jawab24 supports both Facebook Pages and linked Instagram Business accounts on all plans.',
    },
    {
      question: isRTL ? 'كم تكلفة الخدمة؟' : 'How much does it cost?',
      answer: isRTL 
        ? 'نوفر تجربة مجانية لمدة 30 يوم، ثم تبدأ الباقات من $5 شهرياً. باقة الأعمال بـ$19 تناسب معظم المستخدمين مع 9,000 رد ذكي شهرياً.'
        : 'We offer a 30-day free trial, then plans start at $5/month. The Business plan at $19/month fits most users with 9,000 AI replies monthly.',
    },
    {
      question: isRTL ? 'كيف يضمن النظام دقة الردود؟' : 'How does the system ensure accuracy?',
      answer: isRTL 
        ? 'من خلال "قاعدة المعرفة" التي تضيفها، يلتزم الذكاء الاصطناعي بالمعلومات التي توفرها فقط لضمان عدم تقديم إجابات خاطئة.'
        : 'Through the "Knowledge Base" you add, the AI sticks to the information you provide to ensure no wrong answers are given.',
    },
    {
      question: isRTL ? 'هل يمكنني الترقية أو تغيير الباقة لاحقاً؟' : 'Can I upgrade or change my plan later?',
      answer: isRTL 
        ? 'بالتأكيد! يمكنك الترقية أو تغيير باقتك في أي وقت من لوحة التحكم. التغيير يطبق فوراً.'
        : 'Absolutely! You can upgrade or change your plan anytime from the dashboard. Changes apply immediately.',
    },
  ];

  const statsList = [
    { value: '24/7', label: isRTL ? 'متاح دائماً' : 'Always Available' },
    { value: '<1s', label: isRTL ? 'سرعة الرد' : 'Response Time' },
    { value: '99%', label: isRTL ? 'دقة الردود' : 'Accuracy Rate' },
  ];

  if (!mounted) {
    return null;
  }

  return (
    <>
      <Head>
        <title>Jawab24 - AI Auto-Replies for Facebook & Instagram | ردود ذكية تلقائية</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={isRTL 
          ? "وفّر وقتك مع الردود الذكية التلقائية لصفحات فيسبوك وإنستغرام. ردود دقيقة بالذكاء الاصطناعي على مدار الساعة."
          : "Save time with AI auto-replies for Facebook & Instagram. Smart, accurate responses 24/7."
        } />
        <link rel="canonical" href="https://jawab24.com" />
      </Head>

      <div className="min-h-screen bg-white" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Navigation - Mobile optimized */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-surface-100">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14 sm:h-20">
              {/* Logo */}
              <Link href="/" className="flex items-center gap-2 sm:gap-3 group">
                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-100 transition-transform group-hover:rotate-6">
                  <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
                <span className="font-display font-bold text-lg sm:text-2xl text-surface-900 tracking-tight">Jawab24</span>
              </Link>

              {/* Actions */}
              <div className="flex items-center gap-1 sm:gap-4">
                <Link href="#pricing" className="hidden md:block px-4 py-2 text-sm font-bold text-surface-600 hover:text-brand-600 rounded-xl hover:bg-brand-50 transition-all">
                  {isRTL ? 'الأسعار' : 'Pricing'}
                </Link>
                <button
                  onClick={toggleLanguage}
                  className="px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-surface-600 hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 transition-all"
                >
                  {language === 'ar' ? 'En' : 'ع'}
                </button>
                <Link href="/login" className="hidden sm:block">
                  <Button variant="secondary" size="sm" className="font-bold border-none bg-surface-100">
                    {isRTL ? 'تسجيل الدخول' : 'Login'}
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="sm" className="font-bold shadow-xl shadow-brand-500/20 px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5">
                    {isRTL ? 'ابدأ' : 'Start'}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </nav>

        {/* Hero Section - Optimized for Mobile */}
        <section className="relative pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24 overflow-hidden">
          {/* Animated Background Elements - Smaller on mobile */}
          <div className="absolute top-0 left-1/4 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-brand-200/30 rounded-full blur-[80px] sm:blur-[120px] animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-violet-200/30 rounded-full blur-[80px] sm:blur-[120px] animate-pulse delay-1000" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-16">
              <div className="text-center lg:text-start max-w-4xl mx-auto">
                {/* Badge - Smaller on mobile */}
                <div className="inline-flex items-center gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-full bg-brand-50 border border-brand-100 mb-6 sm:mb-10 animate-slide-up">
                  <div className="w-2 h-2 rounded-full bg-brand-500 animate-pulse"></div>
                  <span className="text-xs sm:text-sm font-bold text-brand-700 uppercase tracking-widest">
                    {isRTL ? 'ذكاء اصطناعي فائق الدقة' : 'Advanced AI Auto-Response'}
                  </span>
                </div>

                {/* Heading - Responsive sizes */}
                <h1 className="text-3xl sm:text-5xl lg:text-7xl font-display font-extrabold text-surface-900 mb-4 sm:mb-8 leading-[1.15] tracking-tight animate-slide-up">
                  {isRTL ? 'حوّل صفحتك إلى' : 'Turn Your Page Into a'}
                  <span className="block bg-gradient-to-r from-brand-600 to-violet-600 bg-clip-text text-transparent pb-1 sm:pb-2 mt-1 sm:mt-2">
                    {isRTL ? 'آلة رد ذكية 24/7' : 'Smart 24/7 Sales Machine'}
                  </span>
                </h1>

                {/* Description - Compact on mobile */}
                <p className="text-base sm:text-lg lg:text-xl text-surface-600 mb-6 sm:mb-12 max-w-2xl mx-auto lg:mx-0 leading-relaxed animate-slide-up animation-delay-100">
                  {isRTL 
                    ? 'أول نظام عربي متخصص في الرد الذكي على تعليقات ورسائل فيسبوك وإنستغرام. وفّر وقتك وزد مبيعاتك بردود فورية دقيقة.'
                    : 'The first Arabic-specialized AI system for Facebook & Instagram smart replies. Save time and boost sales with instant, accurate responses.'}
                </p>

                {/* CTA Buttons - Compact on mobile */}
                <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 sm:gap-6 mb-6 sm:mb-12 animate-slide-up animation-delay-200">
                  <Link href="/login" className="w-full sm:w-auto">
                    <Button size="lg" className="w-full sm:w-auto shadow-2xl shadow-brand-500/40 px-6 sm:px-10 py-4 sm:py-8 text-base sm:text-lg font-bold rounded-xl sm:rounded-2xl transition-transform hover:scale-105 active:scale-95">
                      <Facebook className="w-5 h-5 sm:w-6 sm:h-6" />
                      {isRTL ? 'ابدأ تجربتك المجانية' : 'Start Your Free Trial'}
                      {isRTL ? <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" /> : <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </Button>
                  </Link>
                  <Link href="/pricing" className="w-full sm:w-auto">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto px-6 sm:px-10 py-4 sm:py-8 text-base sm:text-lg font-bold rounded-xl sm:rounded-2xl border-2 border-surface-200 hover:border-brand-500 hover:bg-white transition-all">
                      {isRTL ? 'عرض الخطط والأسعار' : 'View Plans & Pricing'}
                    </Button>
                  </Link>
                </div>

                {/* Trusted By / Platform Icons - Smaller on mobile */}
                <div className="flex items-center justify-center lg:justify-start gap-4 sm:gap-8 text-surface-400 opacity-60 grayscale hover:grayscale-0 transition-all animate-slide-up animation-delay-300">
                  <div className="flex items-center gap-2 font-bold text-sm sm:text-lg">
                    <Facebook className="w-5 h-5 sm:w-6 sm:h-6" />
                    <span>Facebook</span>
                  </div>
                  <div className="w-px h-4 sm:h-6 bg-surface-200"></div>
                  <div className="flex items-center gap-2 font-bold text-sm sm:text-lg">
                    <Instagram className="w-5 h-5 sm:w-6 sm:h-6" />
                    <span>Instagram</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Stats Section - Compact on mobile */}
        <section className="py-8 sm:py-16 bg-surface-900 overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand-500 to-transparent"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid grid-cols-3 gap-4 sm:gap-12">
              {statsList.map((stat, i) => (
                <div key={i} className="text-center group">
                  <div className="text-2xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-1 sm:mb-2 group-hover:scale-110 transition-transform duration-500">{stat.value}</div>
                  <div className="text-brand-400 font-bold uppercase tracking-widest text-[10px] sm:text-sm">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section - Optimized for mobile */}
        <section id="features" className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8 sm:mb-16 lg:mb-24">
              <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-3 sm:mb-6 tracking-tight">
                {isRTL ? 'كل ما تحتاجه للسيطرة على صفحاتك' : 'Everything You Need to Dominate'}
              </h2>
              <p className="text-sm sm:text-lg lg:text-xl text-surface-600 max-w-2xl mx-auto leading-relaxed">
                {isRTL 
                  ? 'ميزات احترافية صممت خصيصاً لمساعدتك على النمو وتحسين تجربة عملائك'
                  : 'Professional features designed specifically to help you grow and improve customer experience'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-10">
              {features.map((feature, i) => (
                <div
                  key={i}
                  className="group bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 lg:p-10 shadow-lg sm:shadow-xl shadow-surface-200/50 hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 border border-surface-100 flex flex-col items-center text-center"
                >
                  <div className="w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-xl sm:rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4 sm:mb-6 lg:mb-8 group-hover:bg-brand-600 group-hover:text-white transition-colors duration-500 shadow-inner">
                    <feature.icon className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />
                  </div>
                  <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-surface-900 mb-2 sm:mb-4">{feature.title}</h3>
                  <p className="text-sm sm:text-base text-surface-600 leading-relaxed font-medium">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works - Optimized for mobile */}
        <section className="py-12 sm:py-20 lg:py-32 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row items-center gap-8 sm:gap-12 lg:gap-20">
              <div className="lg:w-1/2">
                <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-4 sm:mb-8 leading-tight text-center lg:text-start">
                  {isRTL ? 'ابدأ في أقل من' : 'Get Started in Under'}
                  <span className="block text-brand-600">{isRTL ? 'دقيقتين فقط' : '2 Minutes'}</span>
                </h2>
                <div className="space-y-4 sm:space-y-6 lg:space-y-10">
                  {howItWorks.map((item, i) => (
                    <div key={i} className="flex gap-3 sm:gap-6">
                      <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-brand-600 text-white flex items-center justify-center text-lg sm:text-2xl font-bold shadow-lg shadow-brand-200">
                        {item.step}
                      </div>
                      <div className="text-start">
                        <h3 className="text-base sm:text-xl font-bold text-surface-900 mb-1 sm:mb-2">{item.title}</h3>
                        <p className="text-sm sm:text-base text-surface-600 font-medium leading-relaxed">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-center lg:text-start">
                  <Link href="/login" className="inline-block mt-6 sm:mt-12">
                    <Button size="lg" className="rounded-xl sm:rounded-2xl px-6 sm:px-10 py-4 sm:py-7 text-base sm:text-lg font-bold shadow-xl shadow-brand-500/20 transition-all hover:px-12">
                      {isRTL ? 'اربط صفحتك الآن' : 'Connect Your Page Now'}
                      {isRTL ? <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" /> : <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </Button>
                  </Link>
                </div>
              </div>
              {/* Dashboard Preview - Hidden on mobile for cleaner layout */}
              <div className="lg:w-1/2 relative hidden lg:block">
                <div className="relative rounded-3xl overflow-hidden shadow-2xl border-8 border-surface-900/5 rotate-2 group hover:rotate-0 transition-transform duration-700">
                  <img src="https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&q=80&w=1000" alt="Dashboard Preview" className="w-full" />
                  <div className="absolute inset-0 bg-gradient-to-t from-brand-900/20 to-transparent"></div>
                </div>
                {/* Decorative Elements */}
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-accent-100 rounded-full -z-10 blur-2xl"></div>
                <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-brand-100 rounded-full -z-10 blur-3xl"></div>
              </div>
            </div>
          </div>
        </section>

        {/* Social Proof Section - Compact on mobile */}
        <section className="py-10 sm:py-16 lg:py-24 bg-brand-600 relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
            <div className="inline-flex items-center gap-1 sm:gap-2 mb-4 sm:mb-8 bg-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border border-white/20">
              <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
              <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
              <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
              <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
              <Star className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400 fill-amber-400" />
            </div>
            <h2 className="text-lg sm:text-2xl lg:text-4xl font-display font-bold text-white mb-4 sm:mb-8 leading-relaxed italic italic-arabic px-2">
              {isRTL 
                ? '"أفضل قرار اتخذته لعملي. وفّر عليّ توظيف 3 موظفين لخدمة العملاء، والردود أصبحت أسرع وأكثر دقة."'
                : '"Best decision for my business. Saved me from hiring 3 customer service agents, and replies are now faster and more accurate."'}
            </h2>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border-2 sm:border-4 border-white/30 overflow-hidden mb-2 sm:mb-4 shadow-xl">
                <img src="https://ui-avatars.com/api/?name=Ahmed+S&background=white&color=0EA5E9" alt="User" />
              </div>
              <div className="text-white font-bold text-base sm:text-xl">{isRTL ? 'أحمد سليمان' : 'Ahmed S.'}</div>
              <div className="text-brand-200 font-medium uppercase tracking-widest text-[10px] sm:text-xs mt-1">{isRTL ? 'صاحب متجر إلكتروني' : 'E-commerce Owner'}</div>
            </div>
          </div>
        </section>

        {/* Pricing Section - Compact on mobile */}
        <section id="pricing" className="py-12 sm:py-20 lg:py-32 bg-white relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8 sm:mb-16">
              <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-brand-50 text-brand-600 border border-brand-100 mb-4 sm:mb-6 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
                {isRTL ? 'خطط مرنة للجميع' : 'Flexible Plans'}
              </div>
              <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-3 sm:mb-6 tracking-tight">
                {isRTL ? 'ابدأ مجاناً لمدة 30 يوم' : 'Start Free for 30 Days'}
              </h2>
              <p className="text-sm sm:text-lg lg:text-xl text-surface-600 max-w-2xl mx-auto leading-relaxed mb-4 sm:mb-10">
                {isRTL 
                  ? 'جرّب الخدمة بالكامل مجاناً، ثم اختر الباقة التي تناسب حجم عملك'
                  : 'Try the full service free, then choose the plan that fits your business'}
              </p>
            </div>

            {/* Plan Features Preview - Horizontal scroll on mobile */}
            <div className="grid grid-cols-3 gap-2 sm:gap-8 mb-8 sm:mb-16 max-w-4xl mx-auto">
              {/* Starter */}
              <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 transition-colors">
                <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Zap className="w-5 h-5 sm:w-7 sm:h-7" />
                </div>
                <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{isRTL ? 'المبتدئ' : 'Starter'}</h3>
                <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
                  {isRTL ? 'للمشاريع الصغيرة' : 'For small projects'}
                </p>
                <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
                  <li>{isRTL ? '✓ صفحة واحدة' : '✓ 1 page'}</li>
                  <li className="hidden sm:block">{isRTL ? '✓ ردود ذكية' : '✓ AI replies'}</li>
                  <li>{isRTL ? '✓ 30 يوم مجاناً' : '✓ 30 days free'}</li>
                </ul>
              </div>

              {/* Business */}
              <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl bg-brand-50 border sm:border-2 border-brand-200 relative">
                <div className="absolute -top-2 sm:-top-3 left-1/2 -translate-x-1/2 px-2 sm:px-3 py-0.5 sm:py-1 bg-brand-600 text-white text-[8px] sm:text-xs font-bold rounded-full whitespace-nowrap">
                  {isRTL ? 'الأكثر طلباً' : 'Popular'}
                </div>
                <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center mt-2 sm:mt-0">
                  <Sparkles className="w-5 h-5 sm:w-7 sm:h-7" />
                </div>
                <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{isRTL ? 'الأعمال' : 'Business'}</h3>
                <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
                  {isRTL ? 'للمتاجر النشطة' : 'For active stores'}
                </p>
                <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
                  <li>{isRTL ? '✓ عدة صفحات' : '✓ Multi pages'}</li>
                  <li className="hidden sm:block">{isRTL ? '✓ ردود أكثر' : '✓ More AI'}</li>
                  <li>{isRTL ? '✓ بدون علامة' : '✓ No brand'}</li>
                </ul>
              </div>

              {/* Pro */}
              <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 transition-colors">
                <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center">
                  <Crown className="w-5 h-5 sm:w-7 sm:h-7" />
                </div>
                <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{isRTL ? 'الاحترافي' : 'Pro'}</h3>
                <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
                  {isRTL ? 'للوكالات والمتاجر الكبيرة' : 'For agencies'}
                </p>
                <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
                  <li>{isRTL ? '✓ صفحات أكثر' : '✓ More pages'}</li>
                  <li className="hidden sm:block">{isRTL ? '✓ ردود غير محدودة' : '✓ Unlimited'}</li>
                  <li>{isRTL ? '✓ دعم أولوية' : '✓ Priority'}</li>
                </ul>
              </div>
            </div>

            {/* CTA - Compact on mobile */}
            <div className="text-center">
              <Link href="/pricing">
                <Button size="lg" className="px-6 sm:px-12 py-4 sm:py-6 text-sm sm:text-lg font-bold rounded-xl sm:rounded-2xl shadow-xl shadow-brand-200">
                  {isRTL ? 'عرض الأسعار والتفاصيل' : 'View Pricing & Details'}
                  {isRTL ? <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" /> : <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                </Button>
              </Link>
              <p className="text-xs sm:text-sm text-surface-400 mt-3 sm:mt-4">
                {isRTL ? 'لا حاجة لبطاقة ائتمان للبدء' : 'No credit card required to start'}
              </p>
            </div>
          </div>
        </section>

        {/* FAQ Section - Compact on mobile */}
        <section className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative overflow-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-8 sm:mb-20">
              <h2 className="text-2xl sm:text-4xl font-display font-extrabold text-surface-900 mb-2 sm:mb-4">
                {isRTL ? 'لديك استفسار؟' : 'Have Questions?'}
              </h2>
              <p className="text-surface-500 font-bold uppercase tracking-widest text-xs sm:text-sm">{isRTL ? 'إليك بعض الإجابات' : 'Find your answers here'}</p>
            </div>

            <div className="space-y-3 sm:space-y-4">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className={`bg-white rounded-2xl sm:rounded-3xl border-2 transition-all duration-300 overflow-hidden ${
                    openFaq === i ? 'border-brand-500 shadow-xl shadow-brand-100' : 'border-transparent shadow-sm hover:border-surface-200'
                  }`}
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full px-4 sm:px-8 py-4 sm:py-6 text-start flex items-center justify-between group"
                  >
                    <span className={`font-bold text-sm sm:text-lg transition-colors ${isRTL ? 'text-start' : ''} ${openFaq === i ? 'text-brand-600' : 'text-surface-900 group-hover:text-brand-600'}`}>
                      {faq.question}
                    </span>
                    <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ms-2 ${openFaq === i ? 'bg-brand-600 text-white rotate-180' : 'bg-surface-100 text-surface-400 group-hover:bg-brand-100 group-hover:text-brand-600'}`}>
                      <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                  </button>
                  {openFaq === i && (
                    <div className="px-4 sm:px-8 pb-4 sm:pb-8 text-sm sm:text-base text-surface-600 font-medium leading-relaxed animate-slide-up">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer - Compact on mobile */}
        <footer className="bg-surface-900 text-white pt-10 sm:pt-16 lg:pt-24 pb-8 sm:pb-12 relative overflow-hidden">
          <div className="absolute bottom-0 right-0 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-brand-500/5 rounded-full blur-[80px] sm:blur-[120px] pointer-events-none"></div>
          
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-16 mb-10 sm:mb-20">
              <div className="col-span-2">
                <Link href="/" className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-8 group">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg">
                    <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <span className="font-display font-bold text-2xl sm:text-3xl tracking-tight">Jawab24</span>
                </Link>
                <p className="text-surface-400 text-sm sm:text-lg max-w-sm mb-6 sm:mb-10 leading-relaxed font-medium">
                  {isRTL 
                    ? 'أول نظام عربي ذكي للرد التلقائي مدعوم بأحدث تقنيات الذكاء الاصطناعي لخدمة أصحاب الأعمال والشركات.'
                    : 'The first specialized Arabic smart auto-reply system powered by advanced AI for businesses and entrepreneurs.'}
                </p>
                <div className="flex items-center gap-3 sm:gap-4">
                  <a href="#" className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center hover:bg-brand-600 transition-colors border border-white/10 group">
                    <Facebook className="w-4 h-4 sm:w-5 sm:h-5 group-hover:scale-110 transition-transform" />
                  </a>
                  <a href="#" className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center hover:bg-brand-600 transition-colors border border-white/10 group">
                    <Instagram className="w-4 h-4 sm:w-5 sm:h-5 group-hover:scale-110 transition-transform" />
                  </a>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{isRTL ? 'روابط هامة' : 'Quick Links'}</h4>
                <ul className="space-y-2 sm:space-y-4 font-medium text-sm sm:text-base">
                  <li><Link href="/pricing" className="text-surface-400 hover:text-brand-400 transition-colors">{isRTL ? 'الباقات والأسعار' : 'Pricing Plans'}</Link></li>
                  <li><Link href="/login" className="text-surface-400 hover:text-brand-400 transition-colors">{isRTL ? 'ابدأ تجربتك المجانية' : 'Start Free Trial'}</Link></li>
                  <li><Link href="/terms" className="text-surface-400 hover:text-brand-400 transition-colors">{isRTL ? 'شروط الخدمة' : 'Terms of Service'}</Link></li>
                  <li><Link href="/privacy" className="text-surface-400 hover:text-brand-400 transition-colors">{isRTL ? 'سياسة الخصوصية' : 'Privacy Policy'}</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{isRTL ? 'تواصل معنا' : 'Support'}</h4>
                <ul className="space-y-2 sm:space-y-4 font-medium text-sm sm:text-base">
                  <li className="text-surface-400 flex items-center gap-2 sm:gap-3">
                    <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-white/5 flex items-center justify-center text-brand-400">
                      <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                    </div>
                    <span className="text-xs sm:text-base break-all">support@jawab24.com</span>
                  </li>
                  <li className="text-surface-400 flex items-center gap-2 sm:gap-3">
                    <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-white/5 flex items-center justify-center text-brand-400">
                      <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                    </div>
                    <span className="text-xs sm:text-base">{isRTL ? 'رد خلال 24 ساعة' : 'Response within 24h'}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="pt-6 sm:pt-12 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
              <div className="text-surface-500 font-bold text-xs sm:text-sm tracking-widest uppercase text-center sm:text-start">
                © {new Date().getFullYear()} Jawab24. {isRTL ? 'جميع الحقوق محفوظة' : 'All rights reserved.'}
              </div>
              <div className="flex items-center gap-2 text-surface-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest">
                <span>MADE WITH</span>
                <Sparkles className="w-3 h-3 text-brand-500" />
                <span>IN SYRIA</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
