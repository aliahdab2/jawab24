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
  CheckCircle2,
  Mail
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
      title: t('landing.features.aiTitle'),
      description: t('landing.features.aiDesc'),
    },
    {
      icon: Instagram,
      title: t('landing.features.platformsTitle'),
      description: t('landing.features.platformsDesc'),
    },
    {
      icon: Languages,
      title: t('landing.features.languageTitle'),
      description: t('landing.features.languageDesc'),
    },
    {
      icon: Zap,
      title: t('landing.features.instantTitle'),
      description: t('landing.features.instantDesc'),
    },
    {
      icon: BookOpen,
      title: t('landing.features.knowledgeTitle'),
      description: t('landing.features.knowledgeDesc'),
    },
    {
      icon: Smartphone,
      title: t('landing.features.mobileTitle'),
      description: t('landing.features.mobileDesc'),
    },
  ];

  const howItWorks = [
    {
      step: '1',
      title: t('landing.howItWorks.step1Title'),
      description: t('landing.howItWorks.step1Desc'),
    },
    {
      step: '2',
      title: t('landing.howItWorks.step2Title'),
      description: t('landing.howItWorks.step2Desc'),
    },
    {
      step: '3',
      title: t('landing.howItWorks.step3Title'),
      description: t('landing.howItWorks.step3Desc'),
    },
  ];

  const faqs = [
    {
      question: t('landing.faq.q1'),
      answer: t('landing.faq.a1'),
    },
    {
      question: t('landing.faq.q2'),
      answer: t('landing.faq.a2'),
    },
    {
      question: t('landing.faq.q3'),
      answer: t('landing.faq.a3'),
    },
    {
      question: t('landing.faq.q4'),
      answer: t('landing.faq.a4'),
    },
  ];

  const statsList = [
    { value: '24/7', label: t('landing.stats.available') },
    { value: '<1s', label: t('landing.stats.speed') },
  ];

  if (!mounted) {
    return null;
  }

  return (
    <>
      <Head>
        <title>{t('landing.seoTitle')}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={t('landing.seoDescription')} />
        <meta name="keywords" content={t('landing.seoKeywords')} />
        <link rel="canonical" href="https://jawab24.com/landing" />
      </Head>

      <div className="min-h-screen bg-white overflow-x-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Navigation - Mobile optimized */}
        <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-xl border-b border-surface-100">
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
                <Link href="/pricing" className="hidden md:block px-4 py-2 text-sm font-bold text-surface-600 hover:text-brand-600 rounded-xl hover:bg-brand-50 transition-all">
                  {t('landing.nav.pricing')}
                </Link>
                <button
                  onClick={toggleLanguage}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-surface-600 hover:text-brand-600 rounded-lg sm:rounded-xl hover:bg-brand-50 transition-all"
                >
                  {language === 'ar' ? 'English' : 'العربية'}
                </button>
                <Link href="/login" className="hidden sm:block">
                  <Button variant="secondary" size="sm" className="font-bold border-none bg-surface-100">
                    {t('landing.nav.login')}
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="sm" className="font-bold shadow-xl shadow-brand-500/20 px-3 sm:px-6 text-xs sm:text-sm py-2 sm:py-2.5">
                    {t('landing.nav.start')}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </nav>

        {/* Hero Section - Optimized for Mobile with Illustration */}
        <section className="relative pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24 overflow-hidden bg-gradient-to-br from-sky-50 via-white to-violet-50">
          {/* Animated Background Elements */}
          <div className="absolute top-20 start-1/4 w-[200px] sm:w-[400px] h-[200px] sm:h-[400px] bg-brand-200/40 rounded-full blur-[60px] sm:blur-[100px] animate-pulse" />
          <div className="absolute bottom-0 end-1/4 w-[200px] sm:w-[400px] h-[200px] sm:h-[400px] bg-violet-200/40 rounded-full blur-[60px] sm:blur-[100px] animate-pulse delay-1000" />
          <div className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] sm:w-[1000px] h-[600px] sm:h-[1000px] bg-gradient-to-br from-cyan-100/30 to-violet-100/30 rounded-full blur-[80px] sm:blur-[150px]" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:grid sm:grid-cols-2 items-center gap-6 sm:gap-8 lg:gap-12">
              {/* Text Content */}
              <div className="w-full text-center sm:text-start order-1">
                {/* Heading */}
                <h1 className="text-xl min-[375px]:text-2xl sm:text-5xl lg:text-6xl font-display font-extrabold text-surface-900 mb-3 sm:mb-8 leading-tight tracking-tight animate-slide-up">
                  {t('landing.hero.title1')}
                  <span className="block bg-gradient-to-r from-brand-600 via-blue-600 to-violet-600 bg-clip-text text-transparent pb-1 sm:pb-2 mt-1 sm:mt-2">
                    {t('landing.hero.title2')}
                  </span>
                </h1>

                {/* Description */}
                <p className="text-xs min-[375px]:text-sm sm:text-lg lg:text-xl text-surface-600 mb-4 sm:mb-12 leading-relaxed animate-slide-up animation-delay-100">
                  {t('landing.hero.description')}
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col items-stretch gap-2 sm:gap-4 mb-4 sm:mb-12 animate-slide-up animation-delay-200 px-2 sm:px-0">
                  <Link href="/login" className="w-full sm:w-auto">
                    <Button size="lg" className="w-full sm:w-auto sm:min-w-[240px] justify-center shadow-2xl shadow-brand-500/40 px-3 sm:px-8 py-2.5 sm:py-5 text-xs sm:text-lg font-bold rounded-lg sm:rounded-2xl transition-transform hover:scale-105 active:scale-95 whitespace-nowrap">
                      {t('landing.hero.cta1')}
                    </Button>
                  </Link>
                  <Link href="/pricing" className="w-full sm:w-auto">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto sm:min-w-[240px] justify-center px-3 sm:px-8 py-2.5 sm:py-5 text-xs sm:text-lg font-bold rounded-lg sm:rounded-2xl border-2 border-surface-200 hover:border-brand-500 bg-white hover:bg-white transition-all shadow-lg whitespace-nowrap">
                      {t('landing.hero.cta2')}
                    </Button>
                  </Link>
                </div>

                {/* Platform Icons */}
                <div className="hidden sm:flex items-center gap-3 sm:gap-6 animate-slide-up animation-delay-300">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#1877F2]/10 text-[#1877F2] font-bold text-sm sm:text-base hover:bg-[#1877F2] hover:text-white transition-all cursor-default">
                    <Facebook className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>{t('landing.platforms.facebook')}</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-orange-500/10 text-pink-600 font-bold text-sm sm:text-base hover:from-purple-500 hover:via-pink-500 hover:to-orange-500 hover:text-white transition-all cursor-default">
                    <Instagram className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>{t('landing.platforms.instagram')}</span>
                  </div>
                </div>
              </div>

              {/* Hero Illustration - Phone Mockup with Floating Icons */}
              <div className="relative animate-slide-up order-2 flex justify-center w-full mt-6 sm:mt-0">
                <div className="relative mx-auto w-full max-w-[140px] min-[375px]:max-w-[160px] sm:max-w-[220px] lg:max-w-[280px]">
                  {/* Glowing Background - More Vibrant like your image */}
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-400/20 via-brand-400/20 to-violet-400/20 rounded-[50px] blur-3xl scale-125 animate-pulse" />

                  {/* Phone Mockup - Titanium/Silver Frame instead of Black */}
                  <div className="relative bg-[#E5E7EB] rounded-[36px] sm:rounded-[42px] p-2 sm:p-2.5 shadow-2xl shadow-brand-900/20 border-[6px] border-[#F3F4F6]">
                    {/* Notch - Smaller and subtle */}
                    <div className="absolute top-4 sm:top-5 start-1/2 -translate-x-1/2 w-12 sm:w-16 h-3 sm:h-4 bg-[#1F2937] rounded-full z-10"></div>

                    {/* Screen Content - Cleaner, more integrated look */}
                    <div className="bg-gradient-to-br from-white to-brand-50/30 rounded-[28px] sm:rounded-[34px] overflow-hidden aspect-[9/19] relative border border-white/50">
                      {/* App Interface */}
                      <div className="p-2.5 sm:p-4 h-full flex flex-col justify-evenly">
                        {/* Status Bar */}
                        <div className="flex items-center justify-between pt-1 sm:pt-2">
                          <div className="flex items-center gap-0.5 sm:gap-1">
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-brand-500 rounded-full" />
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-brand-300 rounded-full" />
                          </div>
                          <div className="text-[8px] sm:text-[9px] lg:text-xs font-bold text-brand-900/30">9:41</div>
                          <div className="w-3 sm:w-4 lg:w-5 h-1.5 sm:h-2 bg-brand-500/10 rounded-sm" />
                        </div>

                        {/* Robot Avatar - Subtler Colors with Pulse Animation */}
                        <div className="flex flex-col items-center justify-center">
                          <div className="w-8 h-8 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-xl sm:rounded-3xl bg-white shadow-xl shadow-brand-500/10 flex items-center justify-center mb-1 sm:mb-2 animate-float-pulse border border-brand-50">
                            <Bot className="w-5 h-5 sm:w-10 sm:h-10 lg:w-12 lg:h-12 text-brand-500" />
                          </div>
                          <span className="font-display font-bold text-[8px] sm:text-xs lg:text-base text-brand-600">jawab24.com</span>
                        </div>

                        {/* Chat Bubbles - Brand Colors */}
                        <div className="space-y-1.5 sm:space-y-3 lg:space-y-4 pb-2 sm:pb-4">
                          <div className="flex items-end gap-1 sm:gap-1.5 lg:gap-2 rtl:flex-row-reverse animate-slide-up">
                            <div className="w-4 h-4 sm:w-5 sm:h-5 lg:w-7 lg:h-7 rounded-full bg-surface-100 flex items-center justify-center flex-shrink-0 shadow-sm">
                              <Facebook className="w-2.5 h-2.5 sm:w-3 sm:h-3 lg:w-4 lg:h-4 text-surface-600" />
                            </div>
                            <div className="bg-white rounded-xl sm:rounded-2xl rounded-bl-none rtl:rounded-bl-xl sm:rtl:rounded-bl-2xl rtl:rounded-br-none px-2 py-1 sm:px-3 sm:py-2 lg:px-4 lg:py-3 shadow-sm border border-brand-50 max-w-full">
                              <p className="text-[8px] sm:text-[11px] lg:text-base text-surface-700 font-medium leading-tight lg:leading-relaxed">{t('landing.hero.chatQuery')}</p>
                            </div>
                          </div>
                          <div className="flex items-end gap-1 sm:gap-1.5 lg:gap-2 justify-end rtl:flex-row-reverse rtl:justify-start animate-slide-up animation-delay-500">
                            <div className="bg-brand-500 rounded-xl sm:rounded-2xl rounded-br-none rtl:rounded-br-xl sm:rtl:rounded-br-2xl rtl:rounded-bl-none px-2 py-1 sm:px-3 sm:py-2 lg:px-4 lg:py-3 shadow-lg shadow-brand-500/20 max-w-[85%]">
                              <p className="text-[8px] sm:text-[11px] lg:text-base text-white font-bold leading-tight lg:leading-relaxed">{t('landing.hero.chatResponse')}</p>
                            </div>
                            <div className="w-4 h-4 sm:w-5 sm:h-5 lg:w-7 lg:h-7 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0 shadow-sm">
                              <Zap className="w-2.5 h-2.5 sm:w-3 sm:h-3 lg:w-4 lg:h-4 text-brand-500" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Floating Elements - Each with unique animation */}
                  {/* Facebook - Original Blue Color */}
                  <div className="absolute -start-4 sm:-start-8 top-1/4 animate-float-rotate">
                    <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-white/90 backdrop-blur p-1.5 shadow-xl shadow-blue-500/20 border-b-2 border-blue-100">
                      <div className="w-full h-full rounded-full bg-[#1877F2] flex items-center justify-center">
                        <Facebook className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                      </div>
                    </div>
                  </div>

                  {/* Instagram - Original Gradient Colors */}
                  <div className="absolute -end-4 sm:-end-8 top-1/3 animate-float-orbit">
                    <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-white/90 backdrop-blur p-1.5 shadow-xl shadow-pink-500/20 border-b-2 border-pink-100">
                      <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 flex items-center justify-center">
                        <Instagram className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section - Compact on mobile */}
        <section className="py-8 sm:py-16 bg-surface-900 relative">
          <div className="absolute top-0 start-0 w-full h-1 bg-gradient-to-r from-transparent via-brand-500 to-transparent"></div>
          <div className="flex items-center justify-center gap-8 sm:gap-20 lg:gap-32 relative z-10">
            {statsList.map((stat, i) => (
              <div key={i} className="text-center group">
                <div className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-2 sm:mb-3 group-hover:scale-110 transition-transform duration-500">{stat.value}</div>
                <div className="text-brand-300 font-bold uppercase tracking-widest text-xs sm:text-sm lg:text-base">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features Section - Optimized for mobile */}
        <section id="features" className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8 sm:mb-16 lg:mb-24">
              <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-3 sm:mb-6 tracking-tight">
                {t('landing.features.sectionTitle')}
              </h2>
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
                <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-4 sm:mb-8 leading-relaxed sm:leading-snug text-center lg:text-start">
                  {t('landing.howItWorks.title1')}
                  <span className="block text-brand-600 mt-2 sm:mt-1">{t('landing.howItWorks.title2')}</span>
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
                      <span className="flex items-center gap-2">
                        {t('landing.howItWorks.cta')}
                        <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 rtl:rotate-180" />
                      </span>
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
                <div className="absolute -top-10 -end-10 w-32 h-32 bg-accent-100 rounded-full -z-10 blur-2xl"></div>
                <div className="absolute -bottom-10 -start-10 w-40 h-40 bg-brand-100 rounded-full -z-10 blur-3xl"></div>
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
              "{t('landing.testimonials.quote1')}"
            </h2>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border-2 sm:border-4 border-white/30 overflow-hidden mb-2 sm:mb-4 shadow-xl">
                <img src="https://ui-avatars.com/api/?name=Ahmed+S&background=white&color=0EA5E9" alt="User" />
              </div>
              <div className="text-white font-bold text-base sm:text-xl">{t('landing.testimonials.author1')}</div>
            </div>
          </div>
        </section>

        {/* Pricing Section - Compact on mobile */}
        <section id="pricing" className="py-12 sm:py-20 lg:py-32 bg-white relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8 sm:mb-16">
              <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-brand-50 text-brand-600 border border-brand-100 mb-4 sm:mb-6 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
                {t('pricing.description')}
              </div>
              <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display font-extrabold text-surface-900 mb-3 sm:mb-6 tracking-tight">
                {t('pricing.startTrial')}
              </h2>
              <p className="text-sm sm:text-lg lg:text-xl text-surface-600 max-w-2xl mx-auto leading-relaxed mb-4 sm:mb-10">
                {t('pricing.noCreditCard')}
              </p>
            </div>

            {/* Plan Features Preview - Horizontal scroll on mobile */}
            <div className="grid grid-cols-3 gap-2 sm:gap-8 mb-8 sm:mb-16 max-w-4xl mx-auto">
              {/* Starter */}
              <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 transition-colors">
                <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Zap className="w-5 h-5 sm:w-7 sm:h-7" />
                </div>
                <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{t('pricing.starter')}</h3>
                <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
                  {t('pricing.starterDesc')}
                </p>
                <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
                  <li>✓ {t('pricing.starterFeature1')}</li>
                  <li className="hidden sm:block">✓ {t('pricing.starterFeature2')}</li>
                  <li>✓ {t('pricing.starterFeature3')}</li>
                </ul>
              </div>

              {/* Business */}
              <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl bg-brand-50 border sm:border-2 border-brand-200 relative">
                <div className="absolute -top-2 sm:-top-3 start-1/2 -translate-x-1/2 px-2 sm:px-3 py-0.5 sm:py-1 bg-brand-600 text-white text-[8px] sm:text-xs font-bold rounded-full whitespace-nowrap">
                  {t('pricing.popular')}
                </div>
                <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center mt-2 sm:mt-0">
                  <Sparkles className="w-5 h-5 sm:w-7 sm:h-7" />
                </div>
                <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{t('pricing.business')}</h3>
                <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
                  {t('pricing.businessDesc')}
                </p>
                <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
                  <li>✓ {t('pricing.businessFeature1')}</li>
                  <li className="hidden sm:block">✓ {t('pricing.businessFeature2')}</li>
                  <li>✓ {t('pricing.businessFeature3')}</li>
                </ul>
              </div>

              {/* Pro */}
              <div className="text-center p-2 sm:p-6 rounded-xl sm:rounded-2xl hover:bg-surface-50 transition-colors">
                <div className="w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-4 rounded-xl sm:rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center">
                  <Crown className="w-5 h-5 sm:w-7 sm:h-7" />
                </div>
                <h3 className="text-sm sm:text-lg font-bold text-surface-900 mb-1 sm:mb-2">{t('pricing.pro')}</h3>
                <p className="text-[10px] sm:text-sm text-surface-500 mb-2 sm:mb-3 hidden sm:block">
                  {t('pricing.proDesc')}
                </p>
                <ul className="text-[10px] sm:text-sm text-surface-600 space-y-0.5 sm:space-y-1">
                  <li>✓ {t('pricing.proFeature1')}</li>
                  <li className="hidden sm:block">✓ {t('pricing.proFeature2')}</li>
                  <li>✓ {t('pricing.proFeature3')}</li>
                </ul>
              </div>
            </div>

            {/* CTA - Compact on mobile */}
            <div className="text-center">
              <Link href="/pricing">
                <Button size="lg" className="px-6 sm:px-12 py-4 sm:py-6 text-sm sm:text-lg font-bold rounded-xl sm:rounded-2xl shadow-xl shadow-brand-200">
                  <span className="flex items-center gap-2">
                    {t('pricing.viewPricingDetails')}
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 rtl:rotate-180" />
                  </span>
                </Button>
              </Link>
              <p className="text-xs sm:text-sm text-surface-400 mt-3 sm:mt-4">
                {t('landing.cta.note')}
              </p>
            </div>
          </div>
        </section>

        {/* FAQ Section - Compact on mobile */}
        <section className="py-12 sm:py-20 lg:py-32 bg-surface-50 relative overflow-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-8 sm:mb-20">
              <h2 className="text-2xl sm:text-4xl font-display font-extrabold text-surface-900 mb-2 sm:mb-4">
                {t('landing.faq.title')}
              </h2>
            </div>

            <div className="space-y-3 sm:space-y-4">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className={`bg-white rounded-2xl sm:rounded-3xl border-2 transition-all duration-300 overflow-hidden ${openFaq === i ? 'border-brand-500 shadow-xl shadow-brand-100' : 'border-transparent shadow-sm hover:border-surface-200'
                    }`}
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full px-4 sm:px-8 py-4 sm:py-6 text-start flex items-center justify-between group"
                  >
                    <span className={`font-bold text-sm sm:text-lg transition-colors rtl:text-start ${openFaq === i ? 'text-brand-600' : 'text-surface-900 group-hover:text-brand-600'}`}>
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
          <div className="absolute bottom-0 end-0 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-brand-500/5 rounded-full blur-[80px] sm:blur-[120px] pointer-events-none"></div>

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
                  {t('landing.footer.description')}
                </p>
                <div className="flex items-center gap-3 sm:gap-4">
                  <a
                    href="https://wa.me/963959858266?text=مرحباً، أريد الاستفسار عن خدمة Jawab24"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-[#25D366]/10 flex items-center justify-center hover:bg-[#25D366] transition-colors border border-[#25D366]/20 group"
                  >
                    <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#25D366] group-hover:text-white group-hover:scale-110 transition-all" />
                  </a>
                  <a
                    href="mailto:support@jawab24.com"
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center hover:bg-brand-600 transition-colors border border-white/10 group"
                  >
                    <Mail className="w-4 h-4 sm:w-5 sm:h-5 group-hover:scale-110 transition-transform" />
                  </a>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{t('landing.footer.quickLinks')}</h4>
                <ul className="space-y-2 sm:space-y-4 font-medium text-sm sm:text-base">
                  <li><Link href="/pricing" className="text-surface-400 hover:text-brand-400 transition-colors">{t('landing.footer.pricingPlans')}</Link></li>
                  <li><Link href="/login" className="text-surface-400 hover:text-brand-400 transition-colors">{t('landing.footer.startTrial')}</Link></li>
                  <li><Link href="/terms" className="text-surface-400 hover:text-brand-400 transition-colors">{t('landing.footer.termsOfService')}</Link></li>
                  <li><Link href="/privacy" className="text-surface-400 hover:text-brand-400 transition-colors">{t('landing.footer.privacyPolicy')}</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm sm:text-lg mb-4 sm:mb-8 uppercase tracking-widest">{t('landing.footer.support')}</h4>
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
                    <span className="text-xs sm:text-base">{t('landing.footer.responseTime')}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="pt-6 sm:pt-12 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
              <div className="text-surface-500 font-bold text-xs sm:text-sm tracking-widest uppercase text-center sm:text-start">
                © {new Date().getFullYear()} Jawab24. {t('landing.footer.copyright')}
              </div>
              <div className="flex items-center gap-2 text-surface-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest">
                <span>{t('landing.footer.madeWith')}</span>
                <span className="text-red-500 text-sm">❤️</span>
                <span>{t('landing.footer.inSyria')}</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

