import { useTranslation } from '@/i18n';
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

function ChatMockup() {
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
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Customer Chat</div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>via Instagram DM</div>
        </div>
      </div>

      {/* Customer message 1 */}
      <div style={{ marginBottom: 12 }}>
        <div
          dir="rtl"
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
          {'\u0623\u0628\u064a \u0634\u0646\u0637\u0629 \u062c\u0644\u062f \u062a\u0646\u0627\u0633\u0628 \u0627\u0644\u0644\u0627\u0628\u062a\u0648\u0628\u060c \u0645\u0648 \u0643\u0628\u064a\u0631\u0629 \u0648\u0627\u064a\u062f. \u0639\u0646\u062f\u0643\u0645 \u0634\u064a\u061f \ud83e\udd14'}
        </div>
      </div>

      {/* AI reply with product cards */}
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <div
          dir="rtl"
          style={{
            background: '#0d9488',
            padding: '12px 14px',
            borderRadius: '14px 14px 4px 14px',
            maxWidth: '88%',
          }}
        >
          <div style={{ fontSize: 13, color: '#fff', marginBottom: 8, lineHeight: 1.6 }}>
            {'\u0623\u0647\u0644\u0627\u064b! \u0639\u0646\u062f\u064a \u062e\u064a\u0627\u0631\u064a\u0646 \u064a\u0646\u0627\u0633\u0628\u0648\u0646\u0643 \ud83d\udc47'}
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
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Classic Leather Sleeve</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{`199 SAR \u00b7 Fits 14" \u00b7 Slim`}</div>
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
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Executive Messenger</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{`279 SAR \u00b7 Fits 15" \u00b7 With strap`}</div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 1.6 }}>
            {'\u0627\u0644\u0623\u0648\u0644\u0649 \u0623\u0646\u062d\u0641 \u0648\u0623\u062e\u0641\u060c \u0648\u0627\u0644\u062b\u0627\u0646\u064a\u0629 \u0641\u064a\u0647\u0627 \u062d\u0632\u0627\u0645 \u0643\u062a\u0641 \u0648\u062c\u064a\u0628 \u0625\u0636\u0627\u0641\u064a. \u0623\u064a\u0647\u0645 \u062a\u062d\u0628 \u062a\u0639\u0631\u0641 \u0639\u0646\u0647\u0627 \u0623\u0643\u062b\u0631\u061f \ud83d\ude0a'}
          </div>
        </div>
      </div>

      {/* Customer follow-up */}
      <div style={{ marginBottom: 10 }}>
        <div
          dir="rtl"
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
          {'\u0627\u0644\u062b\u0627\u0646\u064a\u0629\u060c \u0647\u0644 \u0627\u0644\u062c\u0644\u062f \u0637\u0628\u064a\u0639\u064a\u061f'}
        </div>
      </div>

      {/* AI follow-up reply */}
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <div
          dir="rtl"
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
          {'\u0625\u064a \u0646\u0639\u0645! \u062c\u0644\u062f \u0628\u0642\u0631\u064a \u0637\u0628\u064a\u0639\u064a 100% \u0645\u0639 \u0628\u0637\u0627\u0646\u0629 \u0645\u062e\u0645\u0644 \u062a\u062d\u0645\u064a \u0627\u0644\u0644\u0627\u0628\u062a\u0648\u0628. \u0645\u062a\u0648\u0641\u0631\u0629 \u0628\u0627\u0644\u0623\u0633\u0648\u062f \u0648\u0627\u0644\u0628\u0646\u064a \u2705'}
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
        <span style={{ fontSize: 10, color: '#9ca3af' }}>Powered by Jawab AI + your store data</span>
      </div>
    </div>
  );
}

export function IntegrationShowcase({ isAuthenticated }: IntegrationShowcaseProps) {
  const { t } = useTranslation();

  const features = [
    t('landing.showcase.feature1'),
    t('landing.showcase.feature2'),
    t('landing.showcase.feature3'),
    t('landing.showcase.feature4'),
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
              {t('landing.showcase.badge')}
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
              {t('landing.showcase.heading1')}
              <br />
              {t('landing.showcase.heading2')}
            </h2>

            {/* Description */}
            <p className="mb-7" style={{ fontSize: 17, color: '#6b7280', lineHeight: 1.7 }}>
              {t('landing.showcase.description')}
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
              {t('landing.showcase.availableOn')}
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
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{t('landing.showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{t('landing.showcase.shopifyStore')}</div>
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
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{t('landing.showcase.availableOn')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{t('landing.showcase.sallaStore')}</div>
                </div>
              </a>
            </div>
          </div>

          {/* Right column — chat mockup */}
          <div className="w-full md:w-[45%] flex justify-center">
            <ChatMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
