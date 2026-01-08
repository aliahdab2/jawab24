import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useUIStore } from '@/lib/store';
import { dmSans, cairo, tajawal } from '@/lib/fonts';
import OfflineBanner from '@/components/OfflineBanner';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  
  // Use store as single source of truth for language
  const language = useUIStore((state) => state.language);
  const hasHydrated = useUIStore((state) => state._hasHydrated);

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      },
    },
  }));

  // Handle Capacitor Initialization (Deep Links, StatusBar)
  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    // Dynamic import to avoid SSR issues with Capacitor plugins
    const initCapacitor = async () => {
      const { Capacitor } = await import('@capacitor/core');
      const { App: CapApp } = await import('@capacitor/app');
      const { StatusBar, Style } = await import('@capacitor/status-bar');

      if (Capacitor.isNativePlatform()) {
        try {
          // Status Bar Styling
          await StatusBar.setStyle({ style: Style.Dark });
          if (Capacitor.getPlatform() === 'android') {
            await StatusBar.setBackgroundColor({ color: '#18181b' }); // Matches theme-color
          }

          // Deep Link Handling
          CapApp.addListener('appUrlOpen', (data) => {
            // data.url contains the full URL (e.g., https://jawab24.com/dashboard)
            try {
              const url = new URL(data.url);
              // Extract pathname and query to navigate internally
              const path = url.pathname + url.search + url.hash;
              // Clean up domain if it matches ours, or just push the path
              if (path) {
                router.push(path);
              }
            } catch (e) {
              console.error('Error handling deep link:', e);
            }
          });
        } catch (e) {
          console.error('Capacitor init error:', e);
        }
      }
    };

    initCapacitor();
  }, [router]);

  // Sync Document Attributes with Store Language
  useEffect(() => {
    if (!hasHydrated) return;

    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language, hasHydrated]);

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>Jawab24 جواب | AI Auto-Reply for Facebook & Instagram</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7." />
        <meta name="theme-color" content="#18181b" />
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />

        {/* Canonical URL - Static */}
        <link rel="canonical" href="https://jawab24.com" />

        {/* Hreflang Tags - Simplified */}
        <link rel="alternate" hrefLang="ar" href="https://jawab24.com/" />
        <link rel="alternate" hrefLang="en" href="https://jawab24.com/" />
        <link rel="alternate" hrefLang="x-default" href="https://jawab24.com/" />

        {/* Open Graph Defaults */}
        <meta property="og:site_name" content="Jawab24 جواب" />
        <meta property="og:title" content="Jawab24 جواب | AI Auto-Reply for Facebook & Instagram" />
        <meta property="og:description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7." />
        <meta property="og:image" content="https://jawab24.com/brand/og-social.png" />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content={language === 'ar' ? 'ar_SA' : 'en_US'} />
        
        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Jawab24 جواب | AI Auto-Reply for Facebook & Instagram" />
        <meta name="twitter:description" content="Smart AI auto-replies for Facebook & Instagram. الرد الذكي التلقائي لفيسبوك وإنستغرام." />
        <meta name="twitter:image" content="https://jawab24.com/brand/og-social.png" />

        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <div className={`${dmSans.variable} ${cairo.variable} ${tajawal.variable}`}>
        <ErrorBoundary>
          <Component {...pageProps} />
        </ErrorBoundary>
        <OfflineBanner />
      </div>
    </QueryClientProvider>
  );
}

