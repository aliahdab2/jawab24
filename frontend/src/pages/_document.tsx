import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    // Default to LTR, client-side will update based on user preference
    <Html lang="ar" dir="rtl">
      <Head>
        {/* Favicon & Icons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />

        {/* Google Analytics */}
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

        {/* Google Search Console */}
        {process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION && (
          <meta name="google-site-verification" content={process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION} />
        )}

        {/* Primary Meta Tags - Arabic First for Arabic SEO */}
        <meta name="description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7. جواب24 - أول نظام عربي للرد الذكي التلقائي على تعليقات ورسائل فيسبوك وإنستغرام. وفّر وقتك وزد مبيعاتك بردود دقيقة 24/7." />
        <meta name="keywords" content="jawab, jawab24, جواب, auto reply, smart replies, Facebook bot, Instagram bot, AI chatbot, رد تلقائي, ردود ذكية, فيسبوك, انستغرام, بوت عربي, ذكاء اصطناعي, رد آلي" />
        <meta name="author" content="Jawab24 جواب24" />

        {/* Hreflang Tags for Language Targeting - Next.js i18n handles per-page */}
        <link rel="alternate" hrefLang="ar" href="https://jawab24.com/" />
        <link rel="alternate" hrefLang="en" href="https://jawab24.com/en" />
        <link rel="alternate" hrefLang="x-default" href="https://jawab24.com/" />

        {/* Open Graph / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://jawab24.com/" />
        <meta property="og:title" content="جواب24 | جواب - الرد التلقائي الذكي لفيسبوك وإنستغرام" />
        <meta property="og:description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7. جواب24 - أول نظام عربي للرد الذكي التلقائي على تعليقات ورسائل فيسبوك وإنستغرام. وفّر وقتك وزد مبيعاتك بردود دقيقة 24/7." />
        <meta property="og:image" content="https://jawab24.com/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale" content="ar_SA" />
        <meta property="og:locale:alternate" content="en_US" />
        <meta property="og:site_name" content="Jawab24 جواب24" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content="https://jawab24.com/" />
        <meta name="twitter:title" content="Jawab24 جواب24 - ردود ذكية تلقائية | Smart Auto-Replies" />
        <meta name="twitter:description" content="AI-powered auto-replies for Facebook & Instagram. الرد الذكي التلقائي لفيسبوك وإنستغرام." />
        <meta name="twitter:image" content="https://jawab24.com/og-image.png" />

        {/* Structured Data - SoftwareApplication (Bilingual) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Jawab24",
              "alternateName": ["Jawab", "jawab", "جواب24", "جواب٢٤", "جواب", "Jawab 24", "jawab 24", "جواب ٢٤"],
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web",
              "description": "AI-powered auto-replies for Facebook & Instagram Pages. Respond to comments and messages 24/7 in Arabic and English. ردود ذكية تلقائية لصفحات فيسبوك وإنستغرام.",
              "url": "https://jawab24.com",
              "inLanguage": ["ar", "en"],
              "author": {
                "@type": "Person",
                "name": "Mohammad Ali Ahdab"
              },
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              }
            })
          }}
        />

        {/* Structured Data - Organization (for brand recognition) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Jawab24",
              "alternateName": ["Jawab", "jawab", "جواب24", "جواب٢٤", "جواب", "Jawab 24"],
              "url": "https://jawab24.com",
              "logo": "https://jawab24.com/apple-touch-icon.png",
              "description": "Smart AI auto-reply service for Facebook & Instagram - خدمة الرد الذكي التلقائي لفيسبوك وإنستغرام",
              "sameAs": [
                "https://facebook.com/jawab24",
                "https://instagram.com/jawab24"
              ]
            })
          }}
        />

        {/* Structured Data - WebSite (for sitelinks search box) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": "Jawab24 جواب24",
              "alternateName": ["Jawab", "jawab", "جواب24", "جواب٢٤", "جواب", "Jawab 24", "جواب ٢٤"],
              "url": "https://jawab24.com",
              "inLanguage": ["ar", "en"]
            })
          }}
        />

        {/* Google Analytics - Replace GA_MEASUREMENT_ID with your actual ID */}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}');
                `
              }}
            />
          </>
        )}

        {/* Google Search Console Verification - Replace with your verification code */}
        {process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION && (
          <meta name="google-site-verification" content={process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION} />
        )}

        {/* Additional SEO */}
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
        <link rel="canonical" href="https://jawab24.com/" />

        {/* Load both English and Arabic fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Cairo:wght@300;400;500;600;700&family=Tajawal:wght@300;400;500;700&display=swap" rel="stylesheet" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
