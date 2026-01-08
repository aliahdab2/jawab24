import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useUIStore, useAuthStore } from '@/lib/store';
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
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      },
    },
  }));

  // Hydration state from both stores
  const uiHasHydrated = useUIStore((state) => state._hasHydrated);
  const authHasHydrated = useAuthStore((state) => state._hasHydrated);
  const hasHydrated = uiHasHydrated && authHasHydrated;

  // Sync Next.js locale with language store
  useEffect(() => {
    if (!locale || !hasHydrated) return;

    const storedLang = useUIStore.getState().language;
    const isDefaultLocale = locale === 'ar';

    if (isDefaultLocale && storedLang === 'en') {
      routerRef.current.replace(routerRef.current.pathname, routerRef.current.asPath, { locale: 'en' });
      return;
    }

    if (!isDefaultLocale && storedLang !== locale) {
      setLanguage(locale as Language);
    }

    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale, hasHydrated, setLanguage]);

  // Native platform initialization (only runs on mobile)
  useEffect(() => {
    const initNativePlatform = async () => {
      if (typeof window === "undefined") return;
      const cap = (window as any).Capacitor;
      if (!cap?.isNativePlatform?.()) return;

      const [{ StatusBar, Style }, { Keyboard }, { App }, { SplashScreen }, { Network }] = await Promise.all([
        import("@capacitor/status-bar"),
        import("@capacitor/keyboard"),
        import("@capacitor/app"),
        import("@capacitor/splash-screen"),
        import("@capacitor/network")
      ]);

      // Configure native UI (non-critical - wrap in try/catch)
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: Style.Dark });
      } catch {
        // StatusBar may not be available on all devices
      }

      try {
        await Keyboard.setResizeMode({ mode: 'body' } as any);
      } catch {
        // Keyboard resize not implemented on all platforms
      }

      // Handle hardware back button (Android)
      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          App.exitApp();
        }
      });

      // Handle app resume - refresh data
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          queryClient.invalidateQueries();
        }
      });

      // Handle network changes
      Network.addListener('networkStatusChange', (status) => {
        if (status.connected) {
          queryClient.invalidateQueries();
        }
      });

      // Handle deep links
      App.addListener('appUrlOpen', (data) => {
        const slug = data.url.split(".com").pop() || data.url.split("://").pop() || "";
        if (slug) {
          routerRef.current.push(slug);
        }
      });

      // Handle external links - open in system browser
      const handleExternalClick = async (e: MouseEvent) => {
        const anchor = (e.target as HTMLElement).closest('a');
        if (anchor?.href) {
          try {
            const url = new URL(anchor.href);
            const isExternal = !url.hostname.includes('jawab24.com') && !url.hostname.includes('localhost');
            if (isExternal) {
              e.preventDefault();
              const { Browser } = await import('@capacitor/browser');
              await Browser.open({ url: anchor.href });
            }
          } catch {
            // Invalid URL, ignore
          }
        }
      };
      document.addEventListener('click', handleExternalClick);

      // ALWAYS hide splash - this is critical
      await SplashScreen.hide();
    };

    if (hasHydrated) {
      initNativePlatform().catch(console.error);
    }
  }, [hasHydrated, queryClient]);

  // Hydration guard - show branded splash while loading secure storage
  if (!hasHydrated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center animate-pulse">
          <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-teal-500 to-teal-600 rounded-2xl flex items-center justify-center">
            <span className="text-white text-3xl font-bold">ج</span>
          </div>
          <div className="h-1 w-24 mx-auto bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-teal-500 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>Jawab24 جواب | AI Auto-Reply for Facebook & Instagram</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
      <div className={`${dmSans.variable} ${cairo.variable} ${tajawal.variable} app-safe-area`}>
        <ErrorBoundary>
          <Component {...pageProps} />
        </ErrorBoundary>
      </div>
    </QueryClientProvider>
  );
}
