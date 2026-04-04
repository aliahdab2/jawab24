import Link from 'next/link';
import {
  Facebook,
  Instagram,
  Zap,
  Bot,
  Check,
  ShoppingBag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

export function ShopifyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 28" fill="none" className={className} aria-hidden="true">
      <path d="M20.5 5.4c-.1-.1-.2-.2-.4-.2s-1.8-.1-1.8-.1-.8-.8-1-1c-.2-.2-.5-.1-.6-.1l-.8.3c-.1-.4-.3-.8-.6-1.2C14.6 2 13.6 1.5 12.4 1.5h-.2c-.3-.4-.7-.6-1-.6C8.3.9 7 4.3 6.6 6l-2.4.7c-.7.2-.7.2-.8.9L2 19.3l13.6 2.5 7.3-1.8c0 .1-2.3-14.2-2.4-14.6zM14.7 4.5l-1.2.4V4.5c0-.5-.1-1-.2-1.4.8.1 1.1.9 1.4 1.4zm-2.6-1.1c.1.4.2.9.2 1.5v.1l-2.6.8c.5-1.9 1.4-2.3 2.4-2.4zm-1-.7c.2 0 .3.1.5.2-.6.3-1.3.9-1.7 2.5L8.1 6c.5-1.7 1.5-3.3 3-3.3z" fill="#96BF47" />
      <path d="M20.1 5.2c-.2 0-1.8-.1-1.8-.1s-.8-.8-1-1c-.1-.1-.1-.1-.2-.1l-1 20.5 7.3-1.8L20.1 5.2z" fill="#5E8E3E" />
      <path d="M12.4 9.4l-.8 2.5s-.9-.5-2-.4c-1.6.1-1.6 1.1-1.6 1.3.1 1.5 3.9 1.8 4.1 5.2.2 2.7-1.4 4.5-3.7 4.6-2.7.2-4.2-1.4-4.2-1.4l.6-2.4s1.5 1.1 2.7 1c.8 0 1.1-.7 1.1-1.2-.1-1.9-3.2-1.8-3.4-4.9-.2-2.6 1.5-5.2 5.3-5.4 1.4-.1 2.2.3 2.2.3l-.3.8z" fill="#fff" />
    </svg>
  );
}

export function SallaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.862 13.439a1.27 1.27 0 0 0-.81-.555 1.27 1.27 0 0 0-.964.18c-3.422 2.231-6.75 2.231-10.178 0a1.27 1.27 0 0 0-.964-.18 1.283 1.283 0 0 0-.434 2.327c2.142 1.394 4.326 2.1 6.49 2.1 2.166 0 4.348-.706 6.488-2.102a1.27 1.27 0 0 0 .555-.81 1.27 1.27 0 0 0-.18-.964zm5.103 2.82-1.171-9.764a5.24 5.24 0 0 0-5.2-4.614H6.406a5.236 5.236 0 0 0-5.198 4.612l-1.17 9.766a5.235 5.235 0 0 0 5.198 5.86h13.529a5.238 5.238 0 0 0 5.198-5.86zm-3.21 2.4c-.532.6-1.265.929-2.066.929H5.311c-.801 0-1.536-.33-2.066-.929a2.73 2.73 0 0 1-.676-2.16l1.157-9.657A2.764 2.764 0 0 1 6.468 4.41h11.064a2.765 2.765 0 0 1 2.742 2.432l1.157 9.656a2.72 2.72 0 0 1-.676 2.161" />
    </svg>
  );
}

export function ZidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#E94F1C" />
      <path d="M6 7h8.5l-7 10H16" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MetaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M7.5 2.4C5.7 2.4 4 4 2.8 6.6 1.2 10 .2 14.6.2 17.5c0 2.5.9 4.1 2.8 4.1 2 0 3.5-1.8 5.3-5.3l2-3.8c2.3-4.4 4.5-7.2 7.7-7.2s5.3 1.6 6.2 4.5c.7-2.8 2.8-7.4 6.3-7.4 1.7 0 2.9.8 3.7 2.1C33 2.4 30.7.9 27.6.9c-5.2 0-8 4.8-10.6 10l-1.8 3.5c-2 3.9-3.3 5.6-4.8 5.6-1 0-1.5-.8-1.5-2.5 0-2.7.9-6.7 2.3-9.9C12.6 4.6 14 3.1 15.3 2.8c-1-.3-2-.4-3-.4H7.5zm17.3 0c-1.8 0-3.2 2.4-4.5 5.5l-1.7 3.4c-1.6 3.2-2.8 5.4-2.8 7.2 0 2.5.9 4.1 2.8 4.1 2 0 3.5-1.8 5.3-5.3l2-3.8c1.2-2.2 2.2-3.6 3.2-4.3-.3-2.5-1.1-4.2-2.3-5.3-.6-.9-1.3-1.5-2-1.5z" />
    </svg>
  );
}

/* ── Hero phone animation ── */
const heroSpring = { type: 'spring' as const, stiffness: 220, damping: 20 };

const heroFadeSlide: Variants = {
  enter: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: heroSpring },
  exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.18 } },
};

const heroConversationFade: Variants = {
  visible: { opacity: 1, transition: { duration: 0 } },
  resetting: { opacity: 0, y: -8, transition: { duration: 0.35, ease: 'easeInOut' } },
};

/*
 * Step timeline — each entry is [delay, state]:
 *  0→cust1, 1→dots, 2→bot1, 3→cust2, 4→dots, 5→bot2, 6→hold, 7→fade-out, 8→blank→restart
 */
const HERO_STEPS: [number, 'chat' | 'reset' | 'blank'][] = [
  [800, 'chat'],   // 0: customer msg 1
  [1000, 'chat'],  // 1: typing dots
  [1400, 'chat'],  // 2: bot reply 1
  [1000, 'chat'],  // 3: customer msg 2
  [1000, 'chat'],  // 4: typing dots
  [1400, 'chat'],  // 5: bot reply 2
  [2000, 'chat'],  // 6: hold
  [500, 'reset'],  // 7: fade out
  [100, 'blank'],  // 8: blank → restart
];

function HeroTypingDots() {
  return (
    <motion.div
      key="hero-dots"
      variants={heroFadeSlide}
      initial="enter"
      animate="visible"
      exit="exit"
      className="flex items-end gap-0.5 sm:gap-1 justify-end"
    >
      <div className="bg-brand-500/80 rounded-lg sm:rounded-xl rounded-be-none px-1.5 py-1 sm:px-2 sm:py-1.5 shadow-lg shadow-brand-500/20 flex items-center gap-0.5 sm:gap-1">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white/70 rounded-full block"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </div>
      <div className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5 rounded-full bg-brand-50 dark:bg-brand-400/20 flex items-center justify-center flex-shrink-0">
        <Zap className="w-2 h-2 sm:w-2.5 sm:h-2.5 lg:w-3 lg:h-3 text-brand-500 dark:text-brand-300" aria-hidden="true" />
      </div>
    </motion.div>
  );
}

function CustomerBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-0.5 sm:gap-1">
      <div className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4 rounded-full bg-surface-100 dark:bg-surface-400/25 flex items-center justify-center flex-shrink-0">
        <Facebook className="w-1.5 h-1.5 sm:w-2 sm:h-2 lg:w-2.5 lg:h-2.5 text-surface-600 dark:text-surface-300" aria-hidden="true" />
      </div>
      <div className="landing-chat-bubble rounded-lg sm:rounded-xl rounded-es-none px-1.5 py-0.5 sm:px-2 sm:py-1 lg:px-2.5 lg:py-1.5 shadow-sm max-w-[80%]">
        <p className="text-[7px] sm:text-[10px] lg:text-sm text-surface-700 dark:text-[#E5E7EB] font-medium leading-tight">{text}</p>
      </div>
    </div>
  );
}

function BotBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-0.5 sm:gap-1 justify-end">
      <div className="bg-brand-500 dark:bg-brand-500/90 rounded-lg sm:rounded-xl rounded-ee-none px-1.5 py-0.5 sm:px-2 sm:py-1 lg:px-2.5 lg:py-1.5 shadow-lg shadow-brand-500/20 dark:shadow-brand-400/15 max-w-[85%]">
        <p className="text-[7px] sm:text-[10px] lg:text-sm text-white font-bold leading-tight">{text}</p>
      </div>
      <div className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4 rounded-full bg-brand-50 dark:bg-brand-400/20 flex items-center justify-center flex-shrink-0">
        <Zap className="w-1.5 h-1.5 sm:w-2 sm:h-2 lg:w-2.5 lg:h-2.5 text-brand-500 dark:text-brand-300" aria-hidden="true" />
      </div>
    </div>
  );
}


function HeroPhoneChat({ t }: { t: (key: string) => string }) {
  const [step, setStep] = useState(0);

  const [delay, mode] = HERO_STEPS[step] ?? HERO_STEPS[0];
  const phase = mode === 'chat' ? step : -1;
  const resetting = mode === 'reset';

  useEffect(() => {
    const timer = setTimeout(() => {
      setStep(prev => (prev + 1) % HERO_STEPS.length);
    }, delay);
    return () => clearTimeout(timer);
  }, [step, delay]);

  const show = (atPhase: number) => phase >= atPhase;

  return (
    <div className="landing-phone-screen rounded-[28px] sm:rounded-[34px] overflow-hidden aspect-[9/19] relative">
      <div className="relative p-2.5 sm:p-4 h-full flex flex-col">
        {/* Status Bar */}
        <div className="flex items-center justify-between pt-5 sm:pt-9 pb-1.5 sm:pb-4 px-4">
          {/* Signal bars */}
          <div className="flex items-end gap-[1px] sm:gap-[1.5px]">
            <div className="w-[2px] sm:w-[3px] h-[3px] sm:h-[4px] bg-brand-900/30 dark:bg-brand-300/30 rounded-[0.5px]" />
            <div className="w-[2px] sm:w-[3px] h-[5px] sm:h-[6px] bg-brand-900/30 dark:bg-brand-300/30 rounded-[0.5px]" />
            <div className="w-[2px] sm:w-[3px] h-[7px] sm:h-[8px] bg-brand-900/30 dark:bg-brand-300/30 rounded-[0.5px]" />
            <div className="w-[2px] sm:w-[3px] h-[9px] sm:h-[10px] bg-brand-900/30 dark:bg-brand-300/30 rounded-[0.5px]" />
          </div>
          <div className="text-[8px] sm:text-[9px] lg:text-xs font-bold text-brand-900/30 dark:text-brand-300/30">9:41</div>
          {/* Battery */}
          <div className="flex items-center gap-[1px]">
            <div className="relative w-4 sm:w-5 lg:w-6 h-2 sm:h-2.5 lg:h-3 border border-brand-900/25 dark:border-brand-300/25 rounded-[2px] sm:rounded-[3px] p-[1px] sm:p-[1.5px]">
              <div className="h-full w-[75%] bg-brand-500/40 rounded-[1px]" />
            </div>
            <div className="w-[1.5px] sm:w-[2px] h-1 sm:h-1.5 bg-brand-900/25 dark:bg-brand-300/25 rounded-e-sm" />
          </div>
        </div>

        {/* Bot Icon */}
        <div className="flex flex-col items-center justify-center mt-0.5 sm:mt-2 mb-1 sm:mb-3">
          <div className="w-7 h-7 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-lg sm:rounded-3xl bg-white dark:bg-brand-900/60 shadow-xl shadow-brand-500/10 dark:shadow-brand-400/20 flex items-center justify-center animate-float-pulse border border-brand-50 dark:border-brand-400/30">
            <Bot className="w-4 h-4 sm:w-10 sm:h-10 lg:w-12 lg:h-12 text-brand-500 dark:text-brand-300" aria-hidden="true" />
          </div>
        </div>

        {/* Chat Messages */}
        <motion.div
          variants={heroConversationFade}
          initial="visible"
          animate={resetting ? 'resetting' : 'visible'}
          className="flex-1 min-h-0 flex flex-col justify-start gap-1.5 sm:gap-3 lg:gap-4 px-1 sm:px-2 pt-1 sm:pt-3 overflow-hidden"
        >
          {/* Phase 0: Customer message 1 */}
          <AnimatePresence>
            {show(0) && (
              <motion.div key="hc1" variants={heroFadeSlide} initial="enter" animate="visible" exit="exit">
                <CustomerBubble text={t('hero.chatQuery')} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase 1→2: Typing dots → Bot reply 1 */}
          <AnimatePresence mode="wait">
            {phase === 1 && <HeroTypingDots />}
            {show(2) && (
              <motion.div key="hr1" variants={heroFadeSlide} initial="enter" animate="visible" exit="exit">
                <BotBubble text={t('hero.chatResponse')} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase 3: Customer follow-up */}
          <AnimatePresence>
            {show(3) && (
              <motion.div key="hc2" variants={heroFadeSlide} initial="enter" animate="visible" exit="exit">
                <CustomerBubble text={t('hero.chatFollowUp')} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase 4→5: Typing dots → Bot reply 2 */}
          <AnimatePresence mode="wait">
            {phase === 4 && <HeroTypingDots />}
            {show(5) && (
              <motion.div key="hr2" variants={heroFadeSlide} initial="enter" animate="visible" exit="exit">
                <BotBubble text={t('hero.chatResponse2')} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

interface LandingHeroProps {
  isAuthenticated: boolean;
}

export function LandingHero({ isAuthenticated }: LandingHeroProps) {
  const t = useTranslations('landing');
  const tNav = useTranslations('nav');

  return (
    <section className="relative pt-6 sm:pt-10 lg:pt-16 pb-12 sm:pb-16 lg:pb-24 overflow-hidden bg-gradient-to-br from-sky-50 via-white to-violet-50 dark:from-surface-50 dark:via-surface-100 dark:to-surface-200">
      {/* Static background gradients — no blur filter, no animation */}
      <div className="absolute top-20 left-1/4 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-brand-200/30 dark:bg-blue-700/15 rounded-full opacity-60" style={{ filter: 'blur(40px)' }} />
      <div className="absolute bottom-0 right-1/4 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-violet-200/30 dark:bg-indigo-700/15 rounded-full opacity-60" style={{ filter: 'blur(40px)' }} />
      {/* Centered Glowing Background */}
      <div className="absolute top-1/2 inset-x-0 flex justify-center -translate-y-1/2 pointer-events-none">
        <div className="w-[600px] sm:w-[1000px] h-[600px] sm:h-[1000px] bg-gradient-to-br from-cyan-100/20 to-violet-100/20 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-full opacity-70" />
      </div>

      <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-2 items-center gap-3 sm:gap-8 lg:gap-12">
          {/* Text Content */}
          <div className="text-start order-1">
            <h1 className="text-xl min-[375px]:text-2xl sm:text-5xl lg:text-6xl font-display font-extrabold text-foreground mb-3 sm:mb-8 leading-tight tracking-tight animate-slide-up">
              {t('hero.title1')}
              <span className="block bg-gradient-to-r from-brand-600 via-blue-600 to-violet-600 bg-clip-text text-transparent pb-1 sm:pb-2 mt-1 sm:mt-2">
                {t('hero.title2')}
              </span>
            </h1>

            <p className="text-xs min-[375px]:text-sm sm:text-lg lg:text-xl text-muted-foreground mb-4 sm:mb-12 leading-relaxed animate-slide-up animation-delay-100">
              {t('hero.description')}
            </p>

            <div className="flex flex-col items-center sm:items-start gap-3 sm:gap-5 mb-4 sm:mb-12 animate-slide-up animation-delay-200">
              <Link href={isAuthenticated ? "/dashboard" : "/login?redirect=%2Fdashboard"} className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto sm:min-w-[240px] justify-center shadow-2xl shadow-brand-500/40 px-6 sm:px-8 py-3 sm:py-5 text-sm sm:text-lg font-bold rounded-lg sm:rounded-2xl transition-transform hover:scale-105 active:scale-95">
                  {isAuthenticated ? (tNav('dashboard') || 'Dashboard') : t('hero.cta1')}
                </Button>
              </Link>
              {!isAuthenticated && (
                <p className="flex items-center gap-1.5 text-xs sm:text-sm text-surface-500 font-medium">
                  <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand-500" aria-hidden="true" />
                  {t('cta.note')}
                </p>
              )}
              {/* Meta Trust Anchor */}
              <div className="flex items-center gap-2 group cursor-default" title={t('metaBadge.description')}>
                <MetaIcon className="h-[14px] w-auto text-[#0668E1] dark:text-blue-400 flex-shrink-0" />
                <span className="text-[13px] font-semibold text-[#475569] dark:text-slate-300 tracking-wide group-hover:text-[#0668E1] dark:group-hover:text-blue-400 transition-colors">
                  {t('metaBadge.label')}
                </span>
              </div>
              {!isAuthenticated && (
                <Link href="/pricing" className="w-full sm:w-auto">
                  <Button variant="secondary" size="lg" className="w-full sm:w-auto sm:min-w-[240px] justify-center px-6 sm:px-8 py-3 sm:py-5 text-sm sm:text-lg font-bold rounded-lg sm:rounded-2xl border-2 border-theme-border hover:border-brand-500 bg-card hover:bg-card transition-all shadow-lg dark:shadow-black/20">
                    {t('hero.cta2')}
                  </Button>
                </Link>
              )}
            </div>

            {/* Platform Icons */}
            <div className="hidden sm:flex items-center gap-3 sm:gap-6 animate-slide-up animation-delay-300">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full landing-platform-chip-facebook font-bold text-sm sm:text-base transition-all cursor-default">
                <Facebook className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>{t('platforms.facebook')}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full landing-platform-chip-instagram font-bold text-sm sm:text-base transition-all cursor-default">
                <Instagram className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>{t('platforms.instagram')}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full landing-platform-chip-shopify font-bold text-sm sm:text-base transition-all cursor-default">
                <ShopifyIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>{t('platforms.shopify')}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full landing-platform-chip-salla font-bold text-sm sm:text-base transition-all cursor-default">
                <SallaIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>{t('platforms.salla')}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full landing-platform-chip-zid font-bold text-sm sm:text-base transition-all cursor-default">
                <ZidIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>{t('platforms.zid')}</span>
              </div>
            </div>

          </div>

          {/* Hero Illustration - Phone Mockup with Floating Icons */}
          <div className="relative animate-slide-up order-2 flex justify-center">
            <div className="relative mx-auto w-full max-w-[140px] min-[375px]:max-w-[160px] sm:max-w-[220px] lg:max-w-[280px]">
              {/* Glowing Background — static, no animation */}
              <div className="absolute inset-0 bg-gradient-to-br from-amber-400/20 via-brand-400/20 to-violet-400/20 rounded-[50px] blur-2xl scale-125 opacity-70" />

              {/* Phone Mockup — gentle float, transform-only */}
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="relative landing-phone-frame rounded-[36px] sm:rounded-[42px] p-2 sm:p-2.5"
                style={{ boxShadow: '0 20px 60px -10px rgba(0, 128, 128, 0.25), 0 8px 24px -6px rgba(0, 0, 0, 0.15)', willChange: 'transform' }}
              >
                <div className="absolute top-5 sm:top-7 left-1/2 -translate-x-1/2 w-12 sm:w-16 h-3 sm:h-4 landing-phone-notch rounded-full z-10" />

                <HeroPhoneChat t={t} />
              </motion.div>

              {/* Floating Elements */}
              <div className="absolute -start-4 sm:-start-8 top-1/4 animate-float-rotate">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full landing-icon-shell p-1.5">
                  <div className="w-full h-full rounded-full bg-[#1877F2] flex items-center justify-center">
                    <Facebook className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                  </div>
                </div>
              </div>

              <div className="absolute -end-4 sm:-end-8 top-1/3 animate-float-orbit">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full landing-icon-shell p-1.5">
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 flex items-center justify-center">
                    <Instagram className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                  </div>
                </div>
              </div>

              <div className="absolute -start-4 sm:-start-8 top-2/3 animate-float-rotate z-10">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full landing-icon-shell p-1.5">
                  <div className="w-full h-full rounded-full bg-[#96bf48] flex items-center justify-center relative">
                    <ShoppingBag className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                  </div>
                </div>
              </div>

              <div className="absolute -end-4 sm:-end-8 top-2/3 animate-float-orbit z-10">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full landing-icon-shell p-1.5">
                  <div className="w-full h-full rounded-full bg-[#BAF3E6] dark:bg-[#004956] flex items-center justify-center relative">
                    <SallaIcon className="w-5 h-5 sm:w-7 sm:h-7 text-[#004956] dark:text-[#BAF3E6]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
