import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useUIStore } from '@/lib/store';
import type { Language } from '@/i18n';
import { dmSans, cairo, tajawal } from '@/lib/fonts';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const { locale } = router;

  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;

  // Memoize setLanguage to ensure stable reference
  const setLanguageStore = useUIStore((state) => state.setLanguage);
  const setLanguage = useCallback((lang: Language) => {
    setLanguageStore(lang);
  }, [setLanguageStore]);

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes - reduce refetches on poor connections
        gcTime: 10 * 60 * 1000, // 10 minutes - keep data in cache longer
        refetchOnWindowFocus: false, // Don't refetch on window focus
        refetchOnReconnect: true, // Do refetch when connection is restored
        retry: 2, // Retry failed queries twice
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
      },
    },
  }));

  // Sync Next.js locale with our language store and handle redirects
  const hasHydrated = useUIStore((state) => state._hasHydrated);

  useEffect(() => {
    if (!locale || !hasHydrated) return;

    const storedLang = useUIStore.getState().language;
    const isDefaultLocale = locale === 'ar';

    // If we are on the default locale (ar) but user prefers 'en', redirect
    if (isDefaultLocale && storedLang === 'en') {
      routerRef.current.replace(routerRef.current.pathname, routerRef.current.asPath, { locale: 'en' });
      return;
    }

    // If we are on a non-default locale (en), trust the URL and update store
    if (!isDefaultLocale && storedLang !== locale) {
      setLanguage(locale as Language);
    }

    // Update document direction and language
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale, hasHydrated, setLanguage]);

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>Jawab24 جواب | AI Auto-Reply for Facebook & Instagram</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7." />
        <meta name="theme-color" content="#18181b" />
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />

        {/* Canonical URL - Dynamic based on locale */}
        <link rel="canonical" href={`https://jawab24.com${locale === 'en' ? '/en' : ''}`} />

        {/* Hreflang Tags for Multi-language Support */}
        <link rel="alternate" hrefLang="ar" href="https://jawab24.com/" />
        <link rel="alternate" hrefLang="en" href="https://jawab24.com/en" />
        <link rel="alternate" hrefLang="x-default" href="https://jawab24.com/" />

        {/* Open Graph Defaults */}
        <meta property="og:site_name" content="Jawab24 جواب" />
        <meta property="og:title" content="Jawab24 جواب | AI Auto-Reply for Facebook & Instagram" />
        <meta property="og:description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7." />
        <meta property="og:image" content="https://jawab24.com/brand/og-social.png" />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content={locale === 'ar' ? 'ar_SA' : 'en_US'} />
        <meta property="og:locale:alternate" content={locale === 'ar' ? 'en_US' : 'ar_SA'} />

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
      </div>
    </QueryClientProvider>
  );
}

