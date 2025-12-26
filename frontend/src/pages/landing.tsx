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
  Users
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useUIStore } from '@/lib/store';
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
        ? 'ردود مخصصة وذكية تفهم سياق المحادثة وتوفر إجابات دقيقة'
        : 'Custom, intelligent responses that understand context and provide accurate answers',
    },
    {
      icon: Clock,
      title: isRTL ? 'متاح 24/7' : 'Available 24/7',
      description: isRTL 
        ? 'لا تفوت أي رسالة أو تعليق - نرد على عملائك في أي وقت'
        : 'Never miss a message or comment - we respond to your customers anytime',
    },
    {
      icon: Languages,
      title: isRTL ? 'دعم العربية والإنجليزية' : 'Arabic & English Support',
      description: isRTL 
        ? 'ردود تلقائية بلغة العميل - عربي أو إنجليزي'
        : 'Auto-replies in your customer\'s language - Arabic or English',
    },
    {
      icon: Zap,
      title: isRTL ? 'رد فوري' : 'Instant Response',
      description: isRTL 
        ? 'ردود في أقل من ثانية - لا تجعل عملائك ينتظرون'
        : 'Responses in less than a second - never keep customers waiting',
    },
    {
      icon: BookOpen,
      title: isRTL ? 'قاعدة معرفة مخصصة' : 'Custom Knowledge Base',
      description: isRTL 
        ? 'أضف معلومات عملك ومنتجاتك للحصول على ردود أكثر دقة'
        : 'Add your business info and products for more accurate responses',
    },
    {
      icon: BarChart3,
      title: isRTL ? 'تحليلات وإحصائيات' : 'Analytics & Insights',
      description: isRTL 
        ? 'تتبع الردود والتفاعلات واحصل على رؤى قيمة'
        : 'Track responses, engagement, and get valuable insights',
    },
  ];

  const howItWorks = [
    {
      step: '1',
      title: isRTL ? 'ربط صفحتك' : 'Connect Your Page',
      description: isRTL 
        ? 'سجل دخولك بفيسبوك واختر الصفحات التي تريد تفعيل الردود الذكية عليها'
        : 'Sign in with Facebook and select the pages you want to enable smart replies on',
    },
    {
      step: '2',
      title: isRTL ? 'أضف معلومات عملك' : 'Add Your Business Info',
      description: isRTL 
        ? 'أضف معلومات عن منتجاتك وخدماتك لتحسين جودة الردود'
        : 'Add information about your products and services to improve response quality',
    },
    {
      step: '3',
      title: isRTL ? 'استمتع بالردود الذكية' : 'Enjoy Smart Replies',
      description: isRTL 
        ? 'اترك الباقي علينا - سنرد على تعليقات ورسائل عملائك تلقائياً'
        : 'Leave the rest to us - we\'ll auto-reply to your customers\' comments and messages',
    },
  ];

  const faqs = [
    {
      question: isRTL ? 'هل Jawab24 مجاني؟' : 'Is Jawab24 free?',
      answer: isRTL 
        ? 'نعم! Jawab24 مجاني حالياً للاستخدام. نخطط لإضافة خطط مدفوعة مع ميزات إضافية في المستقبل.'
        : 'Yes! Jawab24 is currently free to use. We plan to add paid plans with additional features in the future.',
    },
    {
      question: isRTL ? 'هل يمكنني التحكم في الردود؟' : 'Can I control the responses?',
      answer: isRTL 
        ? 'بالتأكيد! يمكنك إضافة قاعدة معرفة مخصصة لعملك، وتعطيل الردود التلقائية في أي وقت، ومراجعة جميع الردود من لوحة التحكم.'
        : 'Absolutely! You can add a custom knowledge base for your business, disable auto-replies anytime, and review all responses from the dashboard.',
    },
    {
      question: isRTL ? 'ما الصفحات التي يدعمها Jawab24؟' : 'What pages does Jawab24 support?',
      answer: isRTL 
        ? 'يدعم Jawab24 جميع صفحات فيسبوك التجارية التي أنت مسؤول عنها. يمكنك ربط عدة صفحات بحساب واحد.'
        : 'Jawab24 supports all Facebook Business Pages you\'re an admin of. You can connect multiple pages to one account.',
    },
    {
      question: isRTL ? 'هل بياناتي آمنة؟' : 'Is my data secure?',
      answer: isRTL 
        ? 'نعم، نحن نأخذ أمان البيانات على محمل الجد. نستخدم تشفير SSL ولا نخزن كلمات المرور. يمكنك حذف بياناتك في أي وقت.'
        : 'Yes, we take data security seriously. We use SSL encryption and don\'t store passwords. You can delete your data anytime.',
    },
    {
      question: isRTL ? 'كيف يفهم الذكاء الاصطناعي عملي؟' : 'How does the AI understand my business?',
      answer: isRTL 
        ? 'يمكنك إضافة "قاعدة معرفة" تحتوي على معلومات عن منتجاتك وخدماتك وأسعارك. الذكاء الاصطناعي يستخدم هذه المعلومات لتقديم ردود دقيقة ومخصصة.'
        : 'You can add a "Knowledge Base" containing information about your products, services, and prices. The AI uses this to provide accurate, customized responses.',
    },
  ];

  const stats = [
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
        <title>Jawab24 - Smart Facebook Auto-Replies 24/7 | ردود ذكية على مدار الساعة</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={isRTL 
          ? "ردود ذكية تلقائية لصفحات فيسبوك على مدار الساعة. رد على التعليقات والرسائل بالذكاء الاصطناعي"
          : "AI-powered auto-replies for Facebook Pages. Respond to comments and messages 24/7 in Arabic and English."
        } />
        <link rel="canonical" href="https://jawab24.com/landing" />
      </Head>

      <div className="min-h-screen bg-white" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-surface-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Logo */}
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <span className="font-display font-bold text-xl text-surface-900">Jawab24</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleLanguage}
                  className="px-3 py-1.5 text-sm font-medium text-surface-600 hover:text-surface-900 rounded-lg hover:bg-surface-100 transition-colors"
                >
                  {language === 'ar' ? 'English' : 'العربية'}
                </button>
                <Link href="/login">
                  <Button size="sm" className="shadow-lg shadow-brand-500/25">
                    {isRTL ? 'ابدأ الآن' : 'Get Started'}
                    {isRTL ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="relative pt-32 pb-20 overflow-hidden">
          {/* Background */}
          <div className="absolute inset-0 bg-gradient-to-br from-surface-50 via-white to-brand-50" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-200 rounded-full blur-3xl opacity-30" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent-200 rounded-full blur-3xl opacity-30" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-4xl mx-auto">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-50 border border-brand-200 mb-8">
                <Sparkles className="w-4 h-4 text-brand-600" />
                <span className="text-sm font-medium text-brand-700">
                  {isRTL ? 'مدعوم بالذكاء الاصطناعي' : 'Powered by AI'}
                </span>
              </div>

              {/* Heading */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-surface-900 mb-6 leading-tight">
                {isRTL ? 'ردود ذكية لصفحات فيسبوك' : 'Smart Replies for Facebook Pages'}
                <span className="block gradient-text mt-2">
                  {isRTL ? 'على مدار الساعة' : '24/7 Auto-Response'}
                </span>
              </h1>

              {/* Description */}
              <p className="text-lg sm:text-xl text-surface-600 mb-10 max-w-2xl mx-auto">
                {isRTL 
                  ? 'وفّر ساعات يومياً مع الردود التلقائية الذكية على تعليقات ورسائل صفحتك على فيسبوك'
                  : 'Save hours daily with AI-powered auto-replies to your Facebook page comments and messages'}
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                <Link href="/login">
                  <Button size="lg" className="w-full sm:w-auto shadow-xl shadow-brand-500/30 px-8">
                    <Facebook className="w-5 h-5" />
                    {isRTL ? 'ابدأ مجاناً' : 'Start Free'}
                    {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                  </Button>
                </Link>
                <a href="#features" className="text-surface-600 hover:text-surface-900 font-medium flex items-center gap-2">
                  {isRTL ? 'اكتشف المميزات' : 'Explore Features'}
                  <ChevronDown className="w-4 h-4" />
                </a>
              </div>

              {/* Stats */}
              <div className="flex flex-wrap justify-center gap-8 sm:gap-16">
                {stats.map((stat) => (
                  <div key={stat.label} className="text-center">
                    <div className="text-3xl sm:text-4xl font-bold gradient-text">{stat.value}</div>
                    <div className="text-sm text-surface-500 mt-1">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-20 bg-surface-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-display font-bold text-surface-900 mb-4">
                {isRTL ? 'كل ما تحتاجه لإدارة صفحتك' : 'Everything You Need to Manage Your Page'}
              </h2>
              <p className="text-lg text-surface-600 max-w-2xl mx-auto">
                {isRTL 
                  ? 'ميزات قوية تساعدك على التفاعل مع عملائك بشكل أفضل'
                  : 'Powerful features to help you engage with your customers better'}
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-lg transition-shadow border border-surface-100"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-100 to-brand-50 flex items-center justify-center mb-4">
                    <feature.icon className="w-6 h-6 text-brand-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-surface-900 mb-2">{feature.title}</h3>
                  <p className="text-surface-600">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-display font-bold text-surface-900 mb-4">
                {isRTL ? 'كيف يعمل Jawab24؟' : 'How Jawab24 Works?'}
              </h2>
              <p className="text-lg text-surface-600 max-w-2xl mx-auto">
                {isRTL 
                  ? 'ثلاث خطوات بسيطة للبدء'
                  : 'Three simple steps to get started'}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {howItWorks.map((item, i) => (
                <div key={i} className="text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-6 shadow-lg shadow-brand-500/30">
                    {item.step}
                  </div>
                  <h3 className="text-xl font-semibold text-surface-900 mb-3">{item.title}</h3>
                  <p className="text-surface-600">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-20 bg-gradient-to-br from-surface-900 via-surface-800 to-surface-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-display font-bold mb-4">
                {isRTL ? 'مجاني للجميع' : 'Free for Everyone'}
              </h2>
              <p className="text-lg text-surface-300 max-w-2xl mx-auto">
                {isRTL 
                  ? 'ابدأ الآن بدون أي تكاليف - جميع الميزات متاحة مجاناً'
                  : 'Start now with zero costs - all features available for free'}
              </p>
            </div>

            <div className="max-w-md mx-auto">
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20">
                <div className="text-center mb-8">
                  <div className="text-5xl font-bold mb-2">$0</div>
                  <div className="text-surface-300">{isRTL ? 'شهرياً' : 'per month'}</div>
                </div>

                <ul className="space-y-4 mb-8">
                  {[
                    isRTL ? 'ردود ذكية غير محدودة' : 'Unlimited smart replies',
                    isRTL ? 'دعم العربية والإنجليزية' : 'Arabic & English support',
                    isRTL ? 'قاعدة معرفة مخصصة' : 'Custom knowledge base',
                    isRTL ? 'لوحة تحكم كاملة' : 'Full dashboard access',
                    isRTL ? 'دعم عدة صفحات' : 'Multiple pages support',
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/login">
                  <Button size="lg" className="w-full bg-white text-surface-900 hover:bg-surface-100">
                    {isRTL ? 'ابدأ الآن مجاناً' : 'Start Free Now'}
                    {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 bg-surface-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-display font-bold text-surface-900 mb-4">
                {isRTL ? 'الأسئلة الشائعة' : 'Frequently Asked Questions'}
              </h2>
            </div>

            <div className="space-y-4">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-surface-200 overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full px-6 py-4 text-start flex items-center justify-between hover:bg-surface-50 transition-colors"
                  >
                    <span className="font-semibold text-surface-900">{faq.question}</span>
                    {openFaq === i ? (
                      <ChevronUp className="w-5 h-5 text-surface-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-surface-400" />
                    )}
                  </button>
                  {openFaq === i && (
                    <div className="px-6 pb-4 text-surface-600">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-surface-900 mb-6">
              {isRTL ? 'جاهز للبدء؟' : 'Ready to Get Started?'}
            </h2>
            <p className="text-lg text-surface-600 mb-8 max-w-2xl mx-auto">
              {isRTL 
                ? 'انضم إلى آلاف أصحاب الصفحات الذين يوفرون وقتهم مع Jawab24'
                : 'Join thousands of page owners saving time with Jawab24'}
            </p>
            <Link href="/login">
              <Button size="lg" className="shadow-xl shadow-brand-500/30 px-12">
                <Facebook className="w-5 h-5" />
                {isRTL ? 'ابدأ مجاناً الآن' : 'Start Free Now'}
                {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
              </Button>
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-surface-900 text-white py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              {/* Logo */}
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <span className="font-display font-bold text-xl">Jawab24</span>
              </div>

              {/* Links */}
              <div className="flex items-center gap-6 text-sm text-surface-400">
                <Link href="/privacy" className="hover:text-white transition-colors">
                  {isRTL ? 'سياسة الخصوصية' : 'Privacy Policy'}
                </Link>
                <Link href="/terms" className="hover:text-white transition-colors">
                  {isRTL ? 'شروط الخدمة' : 'Terms of Service'}
                </Link>
                <Link href="/data-deletion" className="hover:text-white transition-colors">
                  {isRTL ? 'حذف البيانات' : 'Data Deletion'}
                </Link>
              </div>

              {/* Copyright */}
              <div className="text-sm text-surface-400">
                © {new Date().getFullYear()} Jawab24. {isRTL ? 'جميع الحقوق محفوظة' : 'All rights reserved.'}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

