import Document, { Html, Head, Main, NextScript, type DocumentContext } from 'next/document';

interface DocProps {
  locale: string;
}

export default function MyDocument({ locale }: DocProps) {
  return (
    // Dynamic lang/dir based on Next.js i18n locale (SSR-correct for Google)
    <Html lang={locale || 'ar'} dir={locale === 'en' ? 'ltr' : 'rtl'} suppressHydrationWarning>
      <Head>
        {/* Facebook App ID — MUST be before any <script> tags so OG parsers see it */}
        <meta property="fb:app_id" content="774211662298446" />

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

        {/* Global Verification Tags */}
        {process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION && (
          <meta name="google-site-verification" content={process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION} />
        )}

        {/* Google Analytics - Global Site Tag (gtag.js) */}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}', {
                    page_path: window.location.pathname,
                  });
                `,
              }}
            />
          </>
        )}

        {/* Organization Structured Data (Global) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Jawab24",
              "alternateName": ["Jawab", "jawab", "جواب24", "جواب٢٤", "جواب", "Jawab 24"],
              "url": "https://jawab24.com",
              "logo": "https://jawab24.com/brand/apple-touch-icon.png",
              "description": "Arabic-first AI auto-reply platform for businesses on Facebook, Instagram, Shopify, and Salla. Bilingual customer support automation in Arabic and English with 6 dialect families, product catalog sync, and price verification. 24/7 automated responses.",
              "knowsLanguage": ["ar", "en"],
              "areaServed": [
                { "@type": "GeoShape", "name": "Middle East and North Africa" },
                { "@type": "Country", "name": "Saudi Arabia" },
                { "@type": "Country", "name": "United Arab Emirates" },
                { "@type": "Country", "name": "Egypt" },
                { "@type": "Country", "name": "Kuwait" },
                { "@type": "Country", "name": "Qatar" }
              ],
              "sameAs": [
                "https://facebook.com/jawab24app",
                "https://instagram.com/jawab24"
              ]
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
              "alternateName": "جواب24",
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web, iOS, Android",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD",
                "description": "Start free trial - no credit card required"
              },
              "description": "AI-powered auto-reply platform for Facebook and Instagram business pages. Integrates with Shopify and Salla e-commerce stores. Automatically respond to comments and messages in Arabic and English 24/7.",
              "featureList": [
                "AI-powered automatic replies",
                "Facebook & Instagram integration",
                "Shopify store integration",
                "Salla store integration",
                "E-commerce product catalog sync",
                "Arabic & English language support",
                "24/7 automated responses",
                "Custom reply templates",
                "Business knowledge base"
              ],
              "screenshot": "https://jawab24.com/brand/og-social.png",
              "softwareVersion": "1.0"
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
