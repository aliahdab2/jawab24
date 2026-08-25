import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useInView, type Variants } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ShopifyIcon, SallaIcon, ZidIcon } from './LandingHero';

interface IntegrationShowcaseProps {
  isAuthenticated: boolean;
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="rgba(16, 185, 129, 0.15)" />
      <path d="M6 10l3 3 5-5" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Animation config ── */
const springPop = { type: 'spring' as const, stiffness: 220, damping: 20 };
const layoutSpring = { type: 'spring' as const, stiffness: 300, damping: 30 };

const fadeSlide: Variants = {
  enter: { opacity: 0, y: 15, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: springPop },
  exit: { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.2 } },
};

const cardSlide: Variants = {
  enter: { opacity: 0, x: -20, scale: 0.95 },
  visible: { opacity: 1, x: 0, scale: 1, transition: { type: 'spring', stiffness: 100, damping: 15 } },
};

/* Fade-out all messages before loop reset */
const conversationFade: Variants = {
  visible: { opacity: 1, transition: { duration: 0.15 } },
  resetting: { opacity: 0, y: -12, transition: { duration: 0.5, ease: 'easeInOut' } },
};

/*
 * Phase timeline (state machine):
 *  0 → customer msg 1
 *  1 → typing dots 1
 *  2 → AI reply 1 (dots disappear, reply appears)
 *  3 → customer msg 2
 *  4 → typing dots 2
 *  5 → AI reply 2 (dots disappear, reply appears)
 *  6 → footer
 *  7 → hold, then fade out → reset to 0
 */
const PHASE_DELAYS = [800, 1200, 1500, 1200, 1200, 1500, 800, 2200];
const TOTAL_PHASES = PHASE_DELAYS.length;
const RESET_FADE_MS = 600;

/* Typing indicator — three bouncing dots (AI-side styling) */
function TypingDots() {
  return (
    <motion.div
      key="dots"
      variants={fadeSlide}
      initial="enter"
      animate="visible"
      exit="exit"
      style={{ display: 'flex', justifyContent: 'flex-end' }}
    >
      <div style={{
        display: 'flex', gap: 4, padding: '10px 14px',
        background: 'rgba(16, 185, 129, 0.1)', borderRadius: '14px 14px 4px 14px',
        border: '1px solid rgba(16, 185, 129, 0.2)',
        boxShadow: '0 0 15px rgba(16, 185, 129, 0.1)',
      }}>
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#10B981', display: 'block',
            }}
            animate={{ y: [0, -6, 0] }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function ChatMockup({ t }: { t: (key: string) => string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(wrapperRef, { once: false, amount: 0.3 });
  const [phase, setPhase] = useState(-1);
  const [resetting, setResetting] = useState(false);

  // Phase state machine — advances through timeline while in view
  useEffect(() => {
    if (!isInView) { setPhase(-1); return; }
    setPhase(0);
  }, [isInView]);

  useEffect(() => {
    if (phase < 0) return;

    if (phase >= TOTAL_PHASES) return;
    const delay = PHASE_DELAYS[phase];
    const timer = setTimeout(() => {
      const next = phase + 1;
      if (next >= TOTAL_PHASES) {
        setResetting(true);
        setTimeout(() => {
          setResetting(false);
          setPhase(0);
        }, RESET_FADE_MS);
      } else {
        setPhase(next);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [phase]);

  const show = (atPhase: number) => phase >= atPhase && !resetting;

  return (
    <div ref={wrapperRef}>
      {/* Gentle float — transform-only for GPU compositing, no shadow animation */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ borderRadius: 24, boxShadow: '0 0 30px rgba(16, 185, 129, 0.15), 0 8px 32px rgba(0,0,0,0.4)', willChange: 'transform' }}
      >
        {/* Glassmorphism card — fixed height in portrait, capped in landscape */}
        <div
          className="w-[360px] h-[620px] origin-top scale-[0.82] sm:scale-100"
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            borderRadius: 24,
            maxWidth: '100%',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
        {/* Chat header with online status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '20px 22px 14px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            flexShrink: 0,
          }}
        >
          {/* Avatar with online pulse */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: '50%', background: '#10B981',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            {/* Online indicator dot */}
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 10, height: 10, borderRadius: '50%',
                background: '#22c55e', border: '2px solid rgba(5, 8, 15, 0.8)',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F9FAFB' }}>{t('showcase.chatHeader')}</div>
            <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 500 }}>{t('showcase.chatChannel')}</div>
          </div>
        </div>

        {/* Messages area — fills remaining space */}
        <motion.div
          variants={conversationFade}
          animate={resetting ? 'resetting' : 'visible'}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: '16px 22px 8px',
            overflow: 'hidden',
          }}
        >
          {/* Phase 0: Customer message 1 */}
          <AnimatePresence mode="popLayout">
            {show(0) && (
              <motion.div key="cust1" layout="position" transition={layoutSpring} variants={fadeSlide} initial="enter" animate="visible" exit="exit">
                <div
                  dir="auto"
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
                    maxWidth: '85%', fontSize: 13, color: '#F9FAFB', lineHeight: 1.6,
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    boxShadow: '0 0 15px rgba(59, 130, 246, 0.15)',
                  }}
                >
                  {t('showcase.chatCustomer1')}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase 1→2: Typing dots → AI reply 1 (mutually exclusive) */}
          <AnimatePresence mode="wait">
            {phase === 1 && <TypingDots />}
            {show(2) && (
              <motion.div
                key="ai1"
                layout="position"
                transition={layoutSpring}
                variants={fadeSlide}
                initial="enter"
                animate="visible"
                style={{ display: 'flex', justifyContent: 'flex-end' }}
              >
                <div
                  dir="auto"
                  style={{
                    background: 'linear-gradient(135deg, #10B981 0%, #065f56 100%)',
                    padding: '12px 14px',
                    borderRadius: '14px 14px 4px 14px', maxWidth: '88%',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)',
                  }}
                >
                  <div style={{ fontSize: 13, color: '#fff', marginBottom: 8, lineHeight: 1.6 }}>
                    {t('showcase.chatReply1Intro')}
                  </div>

                  {/* Product cards — stagger from X axis */}
                  {[
                    { name: t('showcase.chatProduct1Name'), details: t('showcase.chatProduct1Details') },
                    { name: t('showcase.chatProduct2Name'), details: t('showcase.chatProduct2Details') },
                  ].map((product, i) => (
                    <motion.div
                      key={i}
                      variants={cardSlide}
                      initial="enter"
                      animate="visible"
                      transition={{ delay: 0.3 + i * 0.25 }}
                      style={{
                        background: 'linear-gradient(110deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.10) 100%)',
                        borderRadius: 8, padding: 8,
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                        border: '1px solid rgba(251, 191, 36, 0.35)',
                        boxShadow: '0 0 12px rgba(251, 191, 36, 0.08)',
                      }}
                    >
                      <div style={{
                        width: 34, height: 34, borderRadius: 6, background: 'rgba(255,255,255,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <path d="M16 10a4 4 0 01-8 0" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{product.name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>{product.details}</div>
                      </div>
                    </motion.div>
                  ))}

                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 1.6 }}>
                    {t('showcase.chatReply1Outro')}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase 3: Customer follow-up */}
          <AnimatePresence mode="popLayout">
            {show(3) && (
              <motion.div key="cust2" layout="position" transition={layoutSpring} variants={fadeSlide} initial="enter" animate="visible" exit="exit">
                <div
                  dir="auto"
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
                    maxWidth: '85%', fontSize: 13, color: '#F9FAFB', lineHeight: 1.6,
                    border: '1px solid rgba(251, 191, 36, 0.3)',
                    boxShadow: '0 0 15px rgba(251, 191, 36, 0.15)',
                  }}
                >
                  {t('showcase.chatCustomer2')}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase 4→5: Typing dots → AI reply 2 */}
          <AnimatePresence mode="wait">
            {phase === 4 && <TypingDots />}
            {show(5) && (
              <motion.div
                key="ai2"
                layout="position"
                transition={layoutSpring}
                variants={fadeSlide}
                initial="enter"
                animate="visible"
                style={{ display: 'flex', justifyContent: 'flex-end' }}
              >
                <div
                  dir="auto"
                  style={{
                    background: 'linear-gradient(135deg, #10B981 0%, #065f56 100%)',
                    padding: '12px 14px', borderRadius: '14px 14px 4px 14px',
                    maxWidth: '88%', fontSize: 13, color: '#fff', lineHeight: 1.6,
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)',
                  }}
                >
                  {t('showcase.chatReply2')}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Powered-by badge — inside scroll area so it doesn't steal space */}
          <AnimatePresence>
            {show(6) && (
              <motion.div
                key="footer"
                initial={{ opacity: 1, x: 30 }}
                animate={{ opacity: 1, x: 0, transition: { type: 'spring', stiffness: 120, damping: 18 } }}
                style={{
                  display: 'flex', justifyContent: 'flex-end',
                  padding: '8px 0 16px',
                }}
              >
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)',
                  borderRadius: 100, padding: '4px 12px 4px 8px',
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span style={{ fontSize: 10, color: '#10B981', fontWeight: 600, letterSpacing: '0.01em' }}>
                    {t('showcase.chatPoweredBy')}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>
      </div>
      </motion.div>
    </div>
  );
}

export function IntegrationShowcase({ isAuthenticated }: IntegrationShowcaseProps) {
  const t = useTranslations('landing');

  const features = [
    t('showcase.feature1'),
    t('showcase.feature2'),
    t('showcase.feature3'),
    t('showcase.feature4'),
  ];

  const shopifyLink = isAuthenticated ? '/integrations' : '/integrations/shopify';
  const sallaLink = isAuthenticated ? '/integrations' : '/integrations/salla';
  const zidLink = isAuthenticated ? '/integrations' : '/integrations/zid';

  return (
    <section
      className="py-12 md:py-20 relative overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 50%, #101827 0%, #05080f 100%)' }}
    >
      {/* Background glow — subtle teal radial light */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 800,
          height: 800,
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.06) 0%, transparent 60%)',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      <div className="mx-auto px-4 sm:px-8 relative z-10" style={{ maxWidth: 1200 }}>
        <div className="flex flex-col md:flex-row items-center gap-10 md:gap-[60px]">
          {/* Left column */}
          <div className="w-full md:w-1/2 md:flex-shrink-0">
            {/* Pill badge */}
            <div
              className="inline-block mb-5"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10B981',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 14px',
                borderRadius: 100,
                border: '1px solid rgba(16, 185, 129, 0.2)',
              }}
            >
              {t('showcase.badge')}
            </div>

            {/* Heading */}
            <h2
              className="font-display mb-4"
              style={{
                fontSize: 'clamp(28px, 4vw, 36px)',
                fontWeight: 800,
                color: '#F9FAFB',
                lineHeight: 1.2,
              }}
            >
              {t('showcase.heading1')}
              <br />
              {t('showcase.heading2')}
            </h2>

            {/* Description */}
            <p className="mb-7" style={{ fontSize: 17, color: 'rgba(249, 250, 251, 0.6)', lineHeight: 1.7 }}>
              {t('showcase.description')}
            </p>

            {/* Checkmark features */}
            <ul className="mb-8" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {features.map((feature, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckIcon />
                  <span style={{ fontSize: 15, color: 'rgba(249, 250, 251, 0.85)', fontWeight: 500 }}>{feature}</span>
                </li>
              ))}
            </ul>

            {/* Available on */}
            <div
              className="mb-3.5"
              style={{
                fontSize: 12,
                color: 'rgba(249, 250, 251, 0.4)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t('showcase.availableOn')}
            </div>

            {/* Store badges — glassmorphism dark */}
            <div className="flex gap-3.5 flex-wrap">
              <a
                href={shopifyLink}
                className="flex items-center gap-2.5 no-underline rounded-xl px-[18px] py-2.5 transition-[transform,background-color,box-shadow] duration-200 hoverable:-translate-y-0.5"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(150, 191, 71, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(150, 191, 71, 0.4)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                <ShopifyIcon className="w-6 h-7" />
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(249, 250, 251, 0.4)' }}>{t('showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#F9FAFB' }}>{t('showcase.shopifyStore')}</div>
                </div>
              </a>
              <a
                href={sallaLink}
                className="flex items-center gap-2.5 no-underline rounded-xl px-[18px] py-2.5 transition-[transform,background-color,box-shadow] duration-200 hoverable:-translate-y-0.5"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 73, 86, 0.3)';
                  e.currentTarget.style.borderColor = 'rgba(0, 73, 86, 0.5)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                <SallaIcon className="w-6 h-6 text-[#00b4b6]" />
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(249, 250, 251, 0.4)' }}>{t('showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#F9FAFB' }}>{t('showcase.sallaStore')}</div>
                </div>
              </a>
              <a
                href={zidLink}
                className="flex items-center gap-2.5 no-underline rounded-xl px-[18px] py-2.5 transition-[transform,background-color,box-shadow] duration-200 hoverable:-translate-y-0.5"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(233, 79, 28, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(233, 79, 28, 0.4)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                <ZidIcon className="w-6 h-6" />
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(249, 250, 251, 0.4)' }}>{t('showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#F9FAFB' }}>{t('showcase.zidStore')}</div>
                </div>
              </a>
            </div>
          </div>

          {/* Right column — chat mockup (hidden in landscape on small screens) */}
          <div className="w-full md:w-[45%] flex justify-center max-md:landscape:hidden">
            <ChatMockup t={t} />
          </div>
        </div>
      </div>
    </section>
  );
}
