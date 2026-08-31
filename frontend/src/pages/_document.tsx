import Document, { Html, Head, Main, NextScript, type DocumentContext } from 'next/document';
import { BRAND_ASSETS } from '@/constants/brand';

interface DocProps {
  locale: string;
}

export default function MyDocument({ locale }: DocProps) {
  return (
    // Dynamic lang/dir based on Next.js i18n locale (SSR-correct for Google)
    <Html lang={locale || 'ar'} dir={locale === 'en' ? 'ltr' : 'rtl'} translate="no" className="notranslate" suppressHydrationWarning>
      <Head>
        <meta name="google" content="notranslate" />
        {/* fb:app_id is in _app.tsx MetaHead (via next/head) — do NOT duplicate here,
           Facebook rejects pages with duplicate fb:app_id property tags */}

        {/* Early detection of Capacitor native platform - runs BEFORE React hydrates
            Industry standard: Check Capacitor.isNativePlatform() first (most reliable) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Primary check: Capacitor object (most reliable - works in Capacitor 3+)
                var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

                // Fallback: Protocol-based detection (for edge cases)
                if (!isNative) {
                  var protocol = window.location.protocol;
                  // capacitor:// = iOS, file:// = older Android, https://localhost = Android WebView
                  isNative = protocol === 'capacitor:' ||
                             protocol === 'file:' ||
                             (protocol === 'https:' && window.location.hostname === 'localhost');
                }

                if (isNative) {
                  document.documentElement.classList.add('is-native');
                }
              })();
            `
          }}
        />
        {/* Dark mode flash prevention — reads persisted theme from Zustand localStorage
            and applies .dark class BEFORE React hydrates to prevent white flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('ui-storage');
                  var theme = stored ? JSON.parse(stored).state && JSON.parse(stored).state.theme : 'system';
                  if (!theme) theme = 'system';
                  var isDark = theme === 'dark' ||
                    (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  // Set color-scheme so the WebView's UA canvas matches the theme on the
                  // very first paint — without this it defaults to white, causing a white
                  // flash in dark mode before the styled body paints (native + web).
                  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `
          }}
        />
        {/* Favicon & Icons - SVG for modern browsers, PNG fallbacks */}
        <link rel="icon" type="image/svg+xml" href="/brand/icon-vector.svg?v=3" />
        <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16x16.png" />
        <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />

        {/* Fonts are now loaded via next/font in _app.tsx for better performance */}

        {/* API-origin warm-up, MOBILE BUILD ONLY. In the APK the app is served
            from app.jawab24.com while the API is jawab24.com, so the first call
            pays a cold DNS+TCP+TLS handshake; here it is in the HTML shell from
            the start. On the website the two are the SAME origin, where a
            preconnect is at best ignored — and a speculative handshake on a
            starved link competes with the render-blocking stylesheet, which is
            exactly what this file was cleaned up to stop.
            Facebook-origin hints live in DashboardLayout (authed screens only) —
            no public page loads a Facebook asset. Measured: the landing's only
            hosts are jawab24.com, googletagmanager and google-analytics. */}
        {process.env.IS_MOBILE_BUILD === 'true' && (
          <link rel="preconnect" href="https://jawab24.com" />
        )}

        {/* Global Verification Tags */}
        <meta name="google-site-verification" content="tshkD5ag97rX0t8u87eKuEKTO3ezhPneMj3auK18Jjw" />

        {/* Google Analytics moved to _app.tsx as <Script strategy="lazyOnload">.
            As a raw <script async> here it was the FIRST resource in <head> —
            163.9 kB (14% of all first-visit bytes) queued ahead of the
            render-blocking stylesheet. Measured 2026-08-17 at Slow 3G: first
            paint 16.2 s, CSS arriving 15th in line. Do not reintroduce any
            third-party script in this file. */}

        {/* Organization Structured Data (Global) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Jawab24",
              "alternateName": ["Jawab", "jawab", "جواب24", "جواب٢٤", "جواب", "Jawab 24", "جواب 24", "نظام جواب", "جواب للرد التلقائي", "Jawab Auto-Reply"],
              "url": "https://jawab24.com",
              "logo": "https://jawab24.com/brand/apple-touch-icon.png",
              "description": "Arabic-first AI auto-reply platform for businesses on WhatsApp, Facebook, Instagram, Shopify, Salla, and Zid. Bilingual customer support automation in Arabic and English with 6 dialect families, product catalog sync, and price verification. 24/7 automated responses.",
              "slogan": "جواب — نظام الرد التلقائي الذكي بالذكاء الاصطناعي لواتساب وفيسبوك وإنستغرام",
              "knowsLanguage": ["ar", "en"],
              "areaServed": [
                { "@type": "GeoShape", "name": "Middle East and North Africa" },
                { "@type": "Country", "name": "Saudi Arabia" },
                { "@type": "Country", "name": "United Arab Emirates" },
                { "@type": "Country", "name": "Egypt" },
                { "@type": "Country", "name": "Kuwait" },
                { "@type": "Country", "name": "Qatar" },
                { "@type": "Country", "name": "Bahrain" },
                { "@type": "Country", "name": "Oman" },
                { "@type": "Country", "name": "Jordan" },
                { "@type": "Country", "name": "Lebanon" },
                { "@type": "Country", "name": "Iraq" },
                { "@type": "Country", "name": "Syria" },
                { "@type": "Country", "name": "Palestine" },
                { "@type": "Country", "name": "Yemen" },
                { "@type": "Country", "name": "Libya" },
                { "@type": "Country", "name": "Tunisia" },
                { "@type": "Country", "name": "Algeria" },
                { "@type": "Country", "name": "Morocco" },
                { "@type": "Country", "name": "Sudan" },
                { "@type": "Country", "name": "Somalia" },
                { "@type": "Country", "name": "Mauritania" },
                { "@type": "Country", "name": "Djibouti" },
                { "@type": "Country", "name": "Comoros" }
              ],
              "@id": "https://jawab24.com/#organization",
              "sameAs": [
                "https://www.facebook.com/jawab24app",
                "https://www.instagram.com/jawab24app",
                "https://x.com/jawab24",
                // The Play listing (4.8★) is our strongest external trust asset —
                // Google already attaches it to blog results in the SERP; claim it.
                BRAND_ASSETS.stores.googlePlay
              ],
              "foundingDate": "2024",
              "numberOfEmployees": {
                "@type": "QuantitativeValue",
                "minValue": 1,
                "maxValue": 10
              },
              "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "customer support",
                "email": "support@jawab24.com",
                "url": "https://jawab24.com/contact",
                "availableLanguage": ["Arabic", "English"]
              }
            })
          }}
        />

        {/* WebSite Structured Data — helps Google associate brand name with domain */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              "@id": "https://jawab24.com/#website",
              "name": "Jawab24",
              "alternateName": ["جواب24", "جواب٢٤", "Jawab 24", "جواب 24", "جواب", "Jawab", "نظام جواب", "جواب للرد التلقائي"],
              "url": "https://jawab24.com",
              "description": "جواب24 — أول نظام عربي متخصص في الرد الذكي على رسائل واتساب وتعليقات ورسائل فيسبوك وإنستغرام بالذكاء الاصطناعي",
              "inLanguage": ["ar", "en"],
              "publisher": {
                "@id": "https://jawab24.com/#organization"
              },
              "potentialAction": {
                "@type": "SearchAction",
                "target": {
                  "@type": "EntryPoint",
                  "urlTemplate": "https://jawab24.com/en/blog?q={search_term_string}"
                },
                "query-input": "required name=search_term_string"
              }
            })
          }}
        />

        {/* SoftwareApplication Structured Data for Rich Snippets */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Jawab24",
              "alternateName": ["جواب24", "جواب", "Jawab", "نظام جواب للرد التلقائي"],
              "applicationCategory": "BusinessApplication",
              "applicationSubCategory": "AI Auto-Reply & Conversational Commerce",
              "operatingSystem": "Web, iOS, Android",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "15",
                "highPrice": "79",
                "priceCurrency": "USD",
                "offerCount": "3",
                "description": "14-day free trial — plans from $15 to $79/month"
              },
              // NOTE: no aggregateRating here, deliberately. It previously mirrored
              // /pricing's "4.8/5 · 50+ businesses", but socialProofReviews is a
              // CUSTOMER count — there is no corpus of 50 collected user reviews behind
              // it. Google requires aggregate ratings to come from real user reviews, so
              // the markup was unsupported and liable to be dropped or penalised.
              // Re-add only when sourced from a genuine review corpus (Play Store / G2 /
              // Capterra) that is also displayed on the page.
              "description": "AI-powered auto-reply platform for WhatsApp Business numbers and Facebook and Instagram business pages. No online store or website required — connects to the page itself; optional integrations with Shopify, Salla, and Zid e-commerce stores. Automatically respond to comments and messages in Arabic and English 24/7, and turn conversations into leads.",
              "installUrl": BRAND_ASSETS.stores.googlePlay,
              "featureList": [
                "AI-powered automatic replies — رد تلقائي ذكي بالذكاء الاصطناعي",
                "WhatsApp Business integration — تكامل مع واتساب للأعمال",
                "Facebook & Instagram integration — تكامل مع فيسبوك وإنستغرام",
                "Shopify store integration — تكامل مع شوبيفاي",
                "Salla store integration — تكامل مع سلة",
                "Zid store integration — تكامل مع زد",
                "E-commerce product catalog sync — مزامنة كتالوج المنتجات",
                "Arabic dialect support (6 families) — دعم 6 عائلات لهجات عربية",
                "24/7 automated responses — رد تلقائي على مدار الساعة",
                "Per-post keyword replies (Post Replies) — رد فوري على البوست بكلمات مفتاحية",
                "Voice note and photo understanding — فهم الرسائل الصوتية والصور",
                "Business Info knowledge with RAG retrieval — معلومات نشاطك التجاري مع استرجاع ذكي",
                "No online store required — يعمل بدون متجر إلكتروني، صفحة فيسبوك تكفي",
                "Lead capture from conversations — استخراج العملاء المحتملين من المحادثات"
              ],
              "screenshot": "https://jawab24.com/brand/og-social.png",
              "softwareVersion": "1.0",
              "creator": {
                "@id": "https://jawab24.com/#organization"
              },
              "keywords": "جواب, jawab, رد تلقائي, auto reply, واتساب, فيسبوك, إنستغرام, شوبيفاي, سلة, زد, ذكاء اصطناعي, AI chatbot"
            })
          }}
        />
      </Head>
      <body>
        {/* Early body class for native apps - runs as soon as body is parsed */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (document.documentElement.classList.contains('is-native')) {
                document.body.classList.add('is-native');
              }
            `
          }}
        />
        <Main />
        <div id="modal-root" />
        <NextScript />
      </body>
    </Html>
  );
}

MyDocument.getInitialProps = async (ctx: DocumentContext) => {
  const initialProps = await Document.getInitialProps(ctx);
  return { ...initialProps, locale: ctx.locale || 'ar' };
};
