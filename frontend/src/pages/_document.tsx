import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    // Default to LTR, client-side will update based on user preference
    <Html lang="en" dir="ltr">
      <Head>
        {/* Favicon & Icons */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/app-icon.svg" />
        
        {/* Primary Meta Tags */}
        <meta name="description" content="Jawab24 - Smart AI-powered auto-replies for Facebook Pages. Respond to comments and messages 24/7 in Arabic and English. ردود ذكية تلقائية لصفحات فيسبوك" />
        <meta name="keywords" content="Facebook auto reply, Facebook automation, AI chatbot, Arabic Facebook bot, social media automation, Jawab24, ردود تلقائية فيسبوك" />
        <meta name="author" content="Jawab24" />
        
        {/* Open Graph / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://jawab24.com/" />
        <meta property="og:title" content="Jawab24 - Smart Facebook Auto-Replies 24/7" />
        <meta property="og:description" content="AI-powered auto-replies for Facebook Pages. Respond to comments and messages 24/7 in Arabic and English." />
        <meta property="og:image" content="https://jawab24.com/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale" content="en_US" />
        <meta property="og:locale:alternate" content="ar_SA" />
        <meta property="og:site_name" content="Jawab24" />
        
        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content="https://jawab24.com/" />
        <meta name="twitter:title" content="Jawab24 - Smart Facebook Auto-Replies 24/7" />
        <meta name="twitter:description" content="AI-powered auto-replies for Facebook Pages. Respond to comments and messages 24/7." />
        <meta name="twitter:image" content="https://jawab24.com/og-image.png" />
        
        {/* Structured Data - Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Jawab24",
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web",
              "description": "AI-powered auto-replies for Facebook Pages. Respond to comments and messages 24/7 in Arabic and English.",
              "url": "https://jawab24.com",
              "author": {
                "@type": "Person",
                "name": "Mohammad Ali Ahdab"
              },
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.8",
                "ratingCount": "50"
              }
            })
          }}
        />
        
        {/* Additional SEO */}
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://jawab24.com/" />
        
        {/* Load both English and Arabic fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Cairo:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

