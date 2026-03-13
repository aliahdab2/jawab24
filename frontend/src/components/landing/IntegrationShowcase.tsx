import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useInView, type Variants } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ShopifyIcon, SallaIcon } from './LandingHero';

interface IntegrationShowcaseProps {
  isAuthenticated: boolean;
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="#ecfdf5" />
      <path d="M6 10l3 3 5-5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Animation config ── */
const springIn = { type: 'spring' as const, stiffness: 120, damping: 20 };
const layoutSpring = { type: 'spring' as const, stiffness: 300, damping: 30 };

const fadeSlide: Variants = {
  enter: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: springIn },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

const cardSlide: Variants = {
  enter: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
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
        background: '#0d948833', borderRadius: '14px 14px 4px 14px',
      }}>
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#0d9488', display: 'block',
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

    // Phase 7 = hold → fade out → reset
    if (phase >= TOTAL_PHASES) return;
    const delay = PHASE_DELAYS[phase];
    const timer = setTimeout(() => {
      const next = phase + 1;
      if (next >= TOTAL_PHASES) {
        // Fade out conversation, then reset
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
      {/* Fixed-height container — section never shifts */}
      <div
        style={{
          background: '#f9fafb',
          borderRadius: 24,
          width: 360,
          maxWidth: '100%',
          height: 620,
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          border: '1px solid #f3f4f6',
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
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          {/* Avatar with online pulse */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: '50%', background: '#0d9488',
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
                background: '#22c55e', border: '2px solid #f9fafb',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{t('showcase.chatHeader')}</div>
            <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 500 }}>{t('showcase.chatChannel')}</div>
          </div>
        </div>

        {/* Messages area — fills remaining space, overflow hidden clips long content */}
        <motion.div
          variants={conversationFade}
          animate={resetting ? 'resetting' : 'visible'}
          style={{
            flex: 1,
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
                <div dir="auto" style={{
                  background: '#e5e7eb', padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
                  maxWidth: '85%', fontSize: 13, color: '#374151', lineHeight: 1.6,
                }}>
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
                <div dir="auto" style={{
                  background: '#0d9488', padding: '12px 14px',
                  borderRadius: '14px 14px 4px 14px', maxWidth: '88%',
                }}>
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
                        background: 'linear-gradient(110deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%)',
                        borderRadius: 8, padding: 8,
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                        border: '1px solid rgba(255,255,255,0.12)',
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
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{product.details}</div>
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
                <div dir="auto" style={{
                  background: '#e5e7eb', padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
                  maxWidth: '85%', fontSize: 13, color: '#374151', lineHeight: 1.6,
                }}>
                  {t('showcase.chatCustomer2')}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase 4→5: Typing dots → AI reply 2 (mutually exclusive) */}
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
                <div dir="auto" style={{
                  background: '#0d9488', padding: '12px 14px', borderRadius: '14px 14px 4px 14px',
                  maxWidth: '88%', fontSize: 13, color: '#fff', lineHeight: 1.6,
                }}>
                  {t('showcase.chatReply2')}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>

        {/* Powered-by badge — slides in from end like a real widget watermark */}
        <AnimatePresence>
          {show(6) && (
            <motion.div
              key="footer"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0, transition: { type: 'spring', stiffness: 120, damping: 18 } }}
              style={{
                display: 'flex', justifyContent: 'flex-end',
                padding: '8px 22px 16px',
                flexShrink: 0,
              }}
            >
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: '#0d94880d', border: '1px solid #0d94881a',
                borderRadius: 100, padding: '4px 12px 4px 8px',
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span style={{ fontSize: 10, color: '#0d9488', fontWeight: 600, letterSpacing: '0.01em' }}>
                  {t('showcase.chatPoweredBy')}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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

  const integrationsLink = isAuthenticated
    ? '/integrations'
    : '/login?redirect=%2Fintegrations';

  return (
    <section style={{ background: '#ffffff' }} className="py-12 md:py-20">
      <div className="mx-auto px-4 sm:px-8" style={{ maxWidth: 1200 }}>
        <div className="flex flex-col md:flex-row items-center gap-10 md:gap-[60px]">
          {/* Left column */}
          <div className="w-full md:w-1/2 md:flex-shrink-0">
            {/* Pill badge */}
            <div
              className="inline-block mb-5"
              style={{
                background: '#ecfdf5',
                color: '#059669',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 14px',
                borderRadius: 100,
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
                color: '#111',
                lineHeight: 1.2,
              }}
            >
              {t('showcase.heading1')}
              <br />
              {t('showcase.heading2')}
            </h2>

            {/* Description */}
            <p className="mb-7" style={{ fontSize: 17, color: '#6b7280', lineHeight: 1.7 }}>
              {t('showcase.description')}
            </p>

            {/* Checkmark features */}
            <ul className="mb-8" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {features.map((feature, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckIcon />
                  <span style={{ fontSize: 15, color: '#374151', fontWeight: 500 }}>{feature}</span>
                </li>
              ))}
            </ul>

            {/* Available on */}
            <div
              className="mb-3.5"
              style={{
                fontSize: 12,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t('showcase.availableOn')}
            </div>

            {/* Store badges */}
            <div className="flex gap-3.5 flex-wrap">
              <a
                href={integrationsLink}
                className="flex items-center gap-2.5 no-underline rounded-xl border-[1.5px] border-[#e2e6ea] bg-[#f4f6f8] px-[18px] py-2.5 transition-all duration-200 hover:shadow-md hover:border-[#0d9488] hover:-translate-y-0.5"
              >
                <ShopifyIcon className="w-6 h-7" />
                <div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{t('showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{t('showcase.shopifyStore')}</div>
                </div>
              </a>
              <a
                href={integrationsLink}
                className="flex items-center gap-2.5 no-underline rounded-xl border-[1.5px] border-[#e2e6ea] bg-[#f4f6f8] px-[18px] py-2.5 transition-all duration-200 hover:shadow-md hover:border-[#004956] hover:-translate-y-0.5"
              >
                <SallaIcon className="w-6 h-6 text-[#004956]" />
                <div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{t('showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{t('showcase.sallaStore')}</div>
                </div>
              </a>
            </div>
          </div>

          {/* Right column — chat mockup */}
          <div className="w-full md:w-[45%] flex justify-center">
            <ChatMockup t={t} />
          </div>
        </div>
      </div>
    </section>
  );
}
