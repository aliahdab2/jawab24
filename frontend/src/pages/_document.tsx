import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    // Default to LTR, client-side will update based on user preference
    <Html lang="ar" dir="rtl">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
              "description": "Smart AI auto-reply service for Facebook & Instagram",
              "sameAs": [
                "https://facebook.com/jawab24",
                "https://instagram.com/jawab24"
              ]
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
