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
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
// Direct imports, NOT the '@/components/ui' barrel — see LandingPageContent.
import { Button } from '@/components/ui/Button';
import { WhatsAppIcon } from '@/components/ui/BrandIcons';

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

/*
 * Zid's real logomark: the four-petal pinwheel, traced from the header logo on
 * zid.sa in its original 216×216 coordinate space. Brand colours from the same
 * source — tile `ZID_PURPLE`, mark `ZID_INK`, which is exactly how Zid renders it
 * on their own favicon.
 *
 * What was here before was invented: an orange (#E94F1C) rounded square with a
 * stroked "Z". Wrong shape AND wrong colour — Zid's brand is purple. Verify against
 * zid.sa (or brand.zid.sa) before changing any of this.
 */
const ZID_PURPLE = '#AE72FF';
const ZID_INK = '#1F0433';
const ZID_MARK_PATH = 'M107.97 19.31C102.42 19.31 97.96 23.77 97.96 29.32C97.96 40.57 101.51 51.47 107.97 60.51C114.43 51.47 117.98 40.56 117.98 29.32C117.98 23.77 113.52 19.31 107.97 19.31ZM121.31 74.88C131.6 62.01 137.29 45.95 137.29 29.32C137.29 12.69 124.19 0 107.97 0C91.75 0 78.65 13.11 78.65 29.32C78.65 45.53 84.35 62.02 94.63 74.88L74.88 94.63C62.01 84.34 45.95 78.65 29.32 78.65C12.69 78.65 0 91.76 0 107.97C0 124.18 13.11 137.29 29.32 137.29C45.53 137.29 62.02 131.59 74.88 121.31L94.63 141.06C84.34 153.93 78.65 169.99 78.65 186.62C78.65 203.25 91.76 215.94 107.97 215.94C124.18 215.94 137.29 202.83 137.29 186.62C137.29 170.41 131.59 153.92 121.31 141.06L141.06 121.31C153.93 131.6 169.99 137.29 186.62 137.29C203.25 137.29 215.94 124.18 215.94 107.97C215.94 91.76 202.83 78.65 186.62 78.65C170.41 78.65 153.92 84.35 141.06 94.63L121.31 74.88ZM107.97 88.86L88.85 107.98L107.97 127.1L127.09 107.98L107.97 88.86ZM155.43 107.97C164.47 114.43 175.38 117.98 186.62 117.98C192.17 117.98 196.63 113.52 196.63 107.97C196.63 102.42 192.17 97.96 186.62 97.96C175.37 97.96 164.47 101.51 155.43 107.97ZM107.97 155.43C101.51 164.47 97.96 175.38 97.96 186.62C97.96 192.17 102.42 196.63 107.97 196.63C113.52 196.63 117.98 192.17 117.98 186.62C117.98 175.37 114.43 164.47 107.97 155.43ZM60.51 107.97C51.47 101.51 40.56 97.96 29.32 97.96C23.77 97.96 19.31 102.42 19.31 107.97C19.31 113.52 23.77 117.98 29.32 117.98C40.57 117.98 51.47 114.43 60.51 107.97Z';

/**
 * The pinwheel alone, scaled from its native 216 units into the shared 24×24 icon
 * box. `inset` is the padding in those 24 units — 4 leaves room for the rounded
 * tile in ZidIcon, ~1 lets the orbit badge run the mark near full-bleed on its disc.
 */
function ZidMark({ fill, inset }: { fill: string; inset: number }) {
  const scale = (24 - inset * 2) / 216;
  return (
    <g transform={`translate(${inset} ${inset}) scale(${scale})`}>
      <path fillRule="evenodd" clipRule="evenodd" d={ZID_MARK_PATH} fill={fill} />
    </g>
  );
}

export function ZidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill={ZID_PURPLE} />
      <ZidMark fill={ZID_INK} inset={4} />
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

/*
 * ── Hero orbit badges ──
 * The channel/store badges floating around the phone mockup.
 *
 * The ring is INTERLEAVED: walking down this list alternates sides, so no two
 * badges ever sit at the same height on the same side. That constraint is not
 * cosmetic — the float keyframes travel up to 25px (`float-rotate` /
 * `float-orbit` in globals.css), which on the 140px-wide mobile phone is ~8% of
 * its height, so two same-side anchors closer than ~25% overlap mid-animation.
 *
 * `top` also has a floor of ~12%, set by that same 25px lift: a badge anchored at
 * X% of the phone's height H must satisfy X%·H >= 25px or it rises above the phone's
 * top edge at the peak of its float. H is ~295px at the mobile `max-w-[140px]`
 * (aspect 9/19), so the binding case is X >= 8.5%; 12% keeps a margin. July 2026 —
 * WhatsApp was appended at `top-[6%]`, i.e. 17.7px on mobile against a 25px lift,
 * AND as a third badge on the start side only 19% from Facebook. Both rules at once.
 *
 * The two columns do NOT have to be level. The end column is tucked 5% up from where
 * even spacing would put it, so it trails the start column by 7% rather than 12%
 * (owner request). Only the same-side spacing and the floor are real constraints —
 * the stagger between the columns is taste, so don't "correct" it back to level.
 *
 * The ring mirrors the platform chip row above it — every platform we support
 * appears in BOTH or the two disagree about what Jawab24 connects to (Zid was
 * missing here while present as a chip).
 *
 * Adding a channel means inserting a slot and re-spacing BOTH columns, never
 * appending to whichever side happens to have room. At six badges the columns are
 * full at 28% spacing; a seventh needs a different layout, not a squeeze.
 */
const HERO_ORBIT: Array<{
  key: string;
  /** Full class string, not composed — Tailwind's scanner reads these literally. */
  position: string;
  anim: 'animate-float-rotate' | 'animate-float-orbit';
  /** Brand fill of the inner disc. */
  badge: string;
  icon: ReactNode;
}> = [
  {
    key: 'facebook',
    position: '-start-4 sm:-start-8 top-[18%]',
    anim: 'animate-float-rotate',
    badge: 'bg-[#1877F2]',
    icon: <Facebook className="w-5 h-5 sm:w-7 sm:h-7 text-white" />,
  },
  {
    key: 'instagram',
    position: '-end-4 sm:-end-8 top-[25%]',
    anim: 'animate-float-orbit',
    badge: 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400',
    icon: <Instagram className="w-5 h-5 sm:w-7 sm:h-7 text-white" />,
  },
  {
    key: 'whatsapp',
    position: '-start-4 sm:-start-8 top-[46%]',
    anim: 'animate-float-orbit',
    badge: 'bg-[#25D366]',
    icon: <WhatsAppIcon className="w-5 h-5 sm:w-7 sm:h-7 text-white" aria-hidden="true" />,
  },
  {
    key: 'salla',
    position: '-end-4 sm:-end-8 top-[53%]',
    anim: 'animate-float-rotate',
    badge: 'bg-[#BAF3E6] dark:bg-[#004956]',
    icon: <SallaIcon className="w-5 h-5 sm:w-7 sm:h-7 text-[#004956] dark:text-[#BAF3E6]" />,
  },
  {
    key: 'shopify',
    position: '-start-4 sm:-start-8 top-[74%]',
    anim: 'animate-float-rotate',
    badge: 'bg-[#96bf48]',
    icon: <ShoppingBag className="w-5 h-5 sm:w-7 sm:h-7 text-white" />,
  },
  {
    key: 'zid',
    position: '-end-4 sm:-end-8 top-[81%]',
    anim: 'animate-float-orbit',
    // Purple disc + ink mark, matching how Zid renders its own favicon. The other
    // badges use a white icon, but a white pinwheel on #AE72FF is far too faint.
    // Literal, NOT `bg-[${ZID_PURPLE}]` — Tailwind's scanner only reads static
    // class strings, so an interpolated one is never generated.
    badge: 'bg-[#AE72FF]',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 sm:w-7 sm:h-7" aria-hidden="true">
        <ZidMark fill={ZID_INK} inset={1} />
      </svg>
    ),
  },
];

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
  // 250, not 100: `heroFadeSlide.exit` runs 180ms, so a shorter blank restarts
  // the loop while the previous cycle's bubbles are still leaving — `hc1`
  // re-mounts under the same key and the container snaps back to opacity 1
  // (duration 0), making the half-exited bubbles visible under the new one.
  [250, 'blank'],  // 8: blank → restart
];

function HeroTypingDots() {
  return (
    <motion.div
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
          {/* One ternary, so only ONE child can ever exist here. Two sibling
              conditionals gave AnimatePresence two slots, and `mode="wait"`
              held the exiting dots mounted at slot 0 while mounting the reply
              at slot 1 — both `justify-end`, so they stacked into one blob. */}
          <AnimatePresence mode="wait" initial={false}>
            {phase === 1 ? (
              <HeroTypingDots key="dots-1" />
            ) : show(2) ? (
              <motion.div key="hr1" variants={heroFadeSlide} initial="enter" animate="visible" exit="exit">
                <BotBubble text={t('hero.chatResponse')} />
              </motion.div>
            ) : null}
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
          <AnimatePresence mode="wait" initial={false}>
            {phase === 4 ? (
              <HeroTypingDots key="dots-2" />
            ) : show(5) ? (
              <motion.div key="hr2" variants={heroFadeSlide} initial="enter" animate="visible" exit="exit">
                <BotBubble text={t('hero.chatResponse2')} />
              </motion.div>
            ) : null}
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
      {/* Background gradients — static blur (rasterised once), opacity-only pulse (compositor-safe) */}
      <div className="absolute top-20 left-1/4 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-brand-200/40 dark:bg-blue-700/25 rounded-full animate-pulse" style={{ filter: 'blur(40px)' }} />
      <div className="absolute bottom-0 right-1/4 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-violet-200/40 dark:bg-indigo-700/25 rounded-full animate-pulse delay-1000" style={{ filter: 'blur(40px)' }} />
      {/* Centered Glowing Background */}
      <div className="absolute top-1/2 inset-x-0 flex justify-center -translate-y-1/2 pointer-events-none">
        <div className="w-[600px] sm:w-[1000px] h-[600px] sm:h-[1000px] bg-gradient-to-br from-cyan-100/30 to-violet-100/30 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-full" style={{ filter: 'blur(80px)' }} />
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
              <div className="flex items-center gap-2 px-4 py-2 rounded-full landing-platform-chip-whatsapp font-bold text-sm sm:text-base transition-all cursor-default">
                <WhatsAppIcon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                <span>{t('platforms.whatsapp')}</span>
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
              {/* Glowing Background — opacity-only pulse, GPU compositor only */}
              <div className="absolute inset-0 bg-gradient-to-br from-amber-400/20 via-brand-400/20 to-violet-400/20 rounded-[50px] blur-2xl scale-125 animate-pulse" />

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

              {/* Floating Elements — interleaved ring, see HERO_ORBIT */}
              {HERO_ORBIT.map(badge => (
                <div key={badge.key} className={clsx('absolute z-10', badge.position, badge.anim)}>
                  {/*
                    * `scale-90` is the 10% size reduction, applied here rather than by
                    * shrinking the four w-/h- steps: it takes the shell, its padding,
                    * the icon, the radius and the shadow down together, and 56px → 50.4px
                    * has no Tailwind size step (it would need arbitrary values in every
                    * badge). It sits on this inner div, NOT the animated parent — the
                    * float keyframes set `transform` outright and would overwrite it.
                    */}
                  <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full landing-icon-shell p-1.5 scale-90">
                    <div className={clsx('w-full h-full rounded-full flex items-center justify-center', badge.badge)}>
                      {badge.icon}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
