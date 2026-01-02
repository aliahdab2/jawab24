import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useUIStore } from '@/lib/store';
import type { Language } from '@/i18n';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const { locale } = router;
  const setLanguage = useUIStore((state) => state.setLanguage);

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
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
      router.replace(router.pathname, router.asPath, { locale: 'en' });
      return;
    }

    // If we are on a non-default locale (en), trust the URL and update store
    if (!isDefaultLocale && storedLang !== locale) {
      setLanguage(locale as Language);
    }

    // Update document direction and language
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale, hasHydrated, router, setLanguage]);

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#18181b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <ErrorBoundary>
        <Component {...pageProps} />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

