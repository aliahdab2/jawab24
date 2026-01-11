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
import { Toaster } from 'sonner';
import { AppSkeleton } from '@/components/ui';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const { locale } = router;

  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;

  // Use ref for listeners to handle cleanup
  const listenersRef = useRef<(() => void)[]>([]);

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

  // Add is-native class IMMEDIATELY on first render (before hydration completes)
  // This ensures CSS safe area rules apply from the start
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      document.documentElement.classList.add('is-native');
      document.body.classList.add('is-native');
    }
  }, []); // Empty deps = runs once on mount

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

      // Note: is-native class is already added in the earlier useEffect

      const [{ StatusBar, Style }, { Keyboard }, { App }, { SplashScreen }, { Network }] = await Promise.all([
        import("@capacitor/status-bar"),
        import("@capacitor/keyboard"),
        import("@capacitor/app"),
        import("@capacitor/splash-screen"),
        import("@capacitor/network")
      ]);

      // Configure native UI (non-critical - wrap in try/catch)
      try {
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: Style.Default });
        
        // --- INDUSTRY BEST PRACTICE: Native Height Sync ---
        // Some devices don't report env(safe-area-inset-top) correctly on cold starts.
        // We set a stable fallback for native platforms that we can refine.
        document.documentElement.style.setProperty('--sat', '24px');
      } catch (err) {
        console.error('StatusBar Sync Error:', err);
      }

      try {
        await Keyboard.setResizeMode({ mode: 'body' } as any);
      } catch {}

      // Clear existing listeners if any (prevent duplicates)
      listenersRef.current.forEach(remove => remove());
      listenersRef.current = [];

      // Handle hardware back button (Android) - Industry Standard
      // Exit app when on root screens, otherwise go back in history
      const ROOT_SCREENS = ['/dashboard', '/login', '/landing', '/'];
      
      const backListener = await App.addListener('backButton', () => {
        const router = routerRef.current;
        const currentPath = router.pathname;
        
        // Check if we're on a root screen (no meaningful "back" destination)
        const isRootScreen = ROOT_SCREENS.includes(currentPath);
        
        // Also check if browser history has somewhere to go
        const hasHistory = window.history.length > 1;
        
        if (isRootScreen || !hasHistory) {
          // On root screen or no history - exit app (like WhatsApp, Instagram)
          App.exitApp();
        } else {
          // Has history and not on root - go back
          router.back();
        }
      });
      listenersRef.current.push(() => backListener.remove());

      // Track route changes to update status bar style dynamically (Best Practice)
      const handleRouteChange = (url: string) => {
        // Style.Dark creates white icons for dark backgrounds
        // Style.Light creates dark icons for light backgrounds
        const isDarkPage = url.includes('/dashboard') || url.includes('/zinc') || url.includes('/auth');
         StatusBar.setStyle({ style: isDarkPage ? Style.Dark : Style.Light }).catch(() => {});
      };
      
      router.events.on('routeChangeComplete', handleRouteChange);
      listenersRef.current.push(() => router.events.off('routeChangeComplete', handleRouteChange));
      
      // Set initial style
      handleRouteChange(router.asPath);

      // Handle app resume - refresh data
      const resumeListener = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          queryClient.invalidateQueries();
          // Ensure overlay and style are correct on resume (Best Practice for cold starts)
          StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
          handleRouteChange(routerRef.current.asPath);
        }
      });
      listenersRef.current.push(() => resumeListener.remove());

      // Handle network changes
      const networkListener = await Network.addListener('networkStatusChange', (status) => {
        if (status.connected) {
          queryClient.invalidateQueries();
        }
      });
      listenersRef.current.push(() => networkListener.remove());

      // ALWAYS hide splash - this is critical
      await SplashScreen.hide();
    };

    if (hasHydrated) {
      initNativePlatform().catch(console.error);
    }

    return () => {
      listenersRef.current.forEach(remove => remove());
      listenersRef.current = [];
    };
  }, [hasHydrated, queryClient, router]);

  // Dedicated Deep Link Handling - Separate effect for reliability
  useEffect(() => {
    if (!hasHydrated || typeof window === "undefined") return;
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return;

    let listenerHandle: any;

    const setupDeepLinks = async () => {
      const { App } = await import("@capacitor/app");
      
      // Helper for URL parsing
      const handleDeepLink = (url: string): string | null => {
        if (url.includes("com.jawab24.app://")) {
            const raw = url.replace("com.jawab24.app://", "/");
            return raw.startsWith("/") ? raw : `/${raw}`;
        } else if (url.includes("localhost/")) {
            const raw = url.split("localhost").pop() || "";
            return raw.startsWith("/") ? raw : `/${raw}`;
        } else if (url.includes(".com")) {
            const raw = url.split(".com").pop() || "";
            return raw.startsWith("/") ? raw : `/${raw}`;
        }
        return null;
      };

      // 1. Warm Start Listener
      listenerHandle = await App.addListener('appUrlOpen', (data) => {
        const slug = handleDeepLink(data.url);
        if (slug) {
            setTimeout(() => {
                routerRef.current.push(slug).catch(console.error);
            }, 50);
        }
      });

      // 2. Cold Start Check
      const launchUrl = await App.getLaunchUrl();
      if (launchUrl && launchUrl.url) {
        const slug = handleDeepLink(launchUrl.url);
        if (slug) {
             routerRef.current.push(slug).catch(console.error);
        }
      }
    };

    setupDeepLinks();

    return () => {
      if (listenerHandle) {
        listenerHandle.remove();
      }
    };
  }, [hasHydrated]);

  // Hydration guard - show skeleton while loading for better UX
  if (!hasHydrated) {
    return <AppSkeleton />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>Jawab24 جواب | AI Auto-Reply for Facebook & Instagram</title>
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
      <div className={`${dmSans.variable} ${cairo.variable} ${tajawal.variable} app-container`}>
        <ErrorBoundary>
          <Component {...pageProps} />
          <Toaster richColors position="top-center" closeButton />
        </ErrorBoundary>
      </div>
    </QueryClientProvider>
  );
}
