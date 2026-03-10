import { useTranslations } from 'next-intl';
import { ShopifyIcon } from './LandingHero';

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


function SallaBadgeLogo() {
  return (
    <div
      className="flex items-center justify-center rounded-md"
      style={{ width: 26, height: 26, background: '#004956' }}
      aria-hidden="true"
    >
      <span className="text-white font-bold" style={{ fontSize: 14, lineHeight: 1 }}>S</span>
    </div>
  );
}

function ChatMockup({ t }: { t: (key: string) => string }) {
  return (
    <div
      style={{
        background: '#f9fafb',
        borderRadius: 24,
        padding: '28px 22px',
        width: 360,
        maxWidth: '100%',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        border: '1px solid #f3f4f6',
      }}
    >
      {/* Chat header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingBottom: 14,
          marginBottom: 20,
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: '#0d9488',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{t('showcase.chatHeader')}</div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>{t('showcase.chatChannel')}</div>
        </div>
      </div>

      {/* Customer message 1 */}
      <div style={{ marginBottom: 12 }}>
        <div
          dir="auto"
          style={{
            background: '#e5e7eb',
            padding: '10px 14px',
            borderRadius: '14px 14px 14px 4px',
            maxWidth: '85%',
            fontSize: 13,
            color: '#374151',
            lineHeight: 1.6,
          }}
        >
          {t('showcase.chatCustomer1')}
        </div>
      </div>

      {/* AI reply with product cards */}
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <div
          dir="auto"
          style={{
            background: '#0d9488',
            padding: '12px 14px',
            borderRadius: '14px 14px 4px 14px',
            maxWidth: '88%',
          }}
        >
          <div style={{ fontSize: 13, color: '#fff', marginBottom: 8, lineHeight: 1.6 }}>
            {t('showcase.chatReply1Intro')}
          </div>

          {/* Product card 1 */}
          <div
            style={{
              background: 'rgba(255,255,255,0.13)',
              borderRadius: 8,
              padding: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 6,
                background: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 01-8 0" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{t('showcase.chatProduct1Name')}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{t('showcase.chatProduct1Details')}</div>
            </div>
          </div>

          {/* Product card 2 */}
          <div
            style={{
              background: 'rgba(255,255,255,0.13)',
              borderRadius: 8,
              padding: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 6,
                background: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 01-8 0" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{t('showcase.chatProduct2Name')}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{t('showcase.chatProduct2Details')}</div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 1.6 }}>
            {t('showcase.chatReply1Outro')}
          </div>
        </div>
      </div>

      {/* Customer follow-up */}
      <div style={{ marginBottom: 10 }}>
        <div
          dir="auto"
          style={{
            background: '#e5e7eb',
            padding: '10px 14px',
            borderRadius: '14px 14px 14px 4px',
            maxWidth: '85%',
            fontSize: 13,
            color: '#374151',
            lineHeight: 1.6,
          }}
        >
          {t('showcase.chatCustomer2')}
        </div>
      </div>

      {/* AI follow-up reply */}
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <div
          dir="auto"
          style={{
            background: '#0d9488',
            padding: '12px 14px',
            borderRadius: '14px 14px 4px 14px',
            maxWidth: '88%',
            fontSize: 13,
            color: '#fff',
            lineHeight: 1.6,
          }}
        >
          {t('showcase.chatReply2')}
        </div>
      </div>

      {/* Powered by footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          marginTop: 6,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{t('showcase.chatPoweredBy')}</span>
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
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <a
                href={integrationsLink}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: '#f4f6f8',
                  border: '1.5px solid #e2e6ea',
                  padding: '10px 18px',
                  borderRadius: 12,
                  textDecoration: 'none',
                }}
              >
                <ShopifyIcon className="w-6 h-7" />
                <div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{t('showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{t('showcase.shopifyStore')}</div>
                </div>
              </a>
              <a
                href={integrationsLink}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: '#f4f6f8',
                  border: '1.5px solid #e2e6ea',
                  padding: '10px 18px',
                  borderRadius: 12,
                  textDecoration: 'none',
                }}
              >
                <SallaBadgeLogo />
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
