import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    // Default to LTR, client-side will update based on user preference
    <Html lang="ar" dir="rtl">
      <Head>
        {/* Favicon & Icons */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/app-icon.svg" />
        
        {/* Primary Meta Tags - Arabic First for Arabic SEO */}
        <meta name="description" content="جواب24 - خدمة الرد التلقائي الذكي على تعليقات ورسائل فيسبوك وإنستغرام. ردود فورية ذكية على مدار الساعة. Jawab24 - Smart AI auto-replies for Facebook & Instagram Pages 24/7." />
        <meta name="keywords" content="جواب, جواب 24, جواب24, جواب٢٤, رد تلقائي, ردود تلقائية, رد تلقائي فيسبوك, رد تلقائي انستغرام, بوت فيسبوك عربي, بوت انستغرام, ردود ذكية, رد آلي, الرد الذكي, رد على التعليقات, رد على الرسائل, ذكاء اصطناعي عربي, jawab, jawab24, Facebook auto reply, Instagram auto reply, AI chatbot Arabic" />
        <meta name="author" content="Jawab24 جواب24" />
        
        {/* Hreflang Tags for Language Targeting */}
        <link rel="alternate" hrefLang="en" href="https://jawab24.com/" />
        <link rel="alternate" hrefLang="ar" href="https://jawab24.com/" />
        <link rel="alternate" hrefLang="x-default" href="https://jawab24.com/" />
        
        {/* Open Graph / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://jawab24.com/" />
        <meta property="og:title" content="جواب24 | جواب - الرد التلقائي الذكي لفيسبوك وإنستغرام" />
        <meta property="og:description" content="جواب24 - خدمة الرد التلقائي الذكي على تعليقات ورسائل فيسبوك وإنستغرام 24/7. ردود فورية ذكية بالعربية والإنجليزية." />
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
              "alternateName": ["جواب24", "جواب٢٤", "جواب", "Jawab"],
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
              "alternateName": ["جواب24", "جواب٢٤", "جواب"],
              "url": "https://jawab24.com",
              "logo": "https://jawab24.com/app-icon.svg",
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
              "alternateName": ["جواب24", "جواب٢٤", "جواب", "Jawab"],
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
