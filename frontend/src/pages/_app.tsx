import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { useUIStore, useAuthStore } from '@/lib/store';
import type { Language } from '@/i18n';
import { dmSans, cairo, tajawal } from '@/lib/fonts';
import { Toaster } from 'sonner';
import { AppSkeleton } from '@/components/ui';
import { NotificationPrePrompt } from '@/components/ui/NotificationPrePrompt';
import { BRAND_ASSETS } from '@/constants/brand';

/**
 * Type for pages with persistent layouts
 * This pattern prevents layout remounting on navigation, preserving state like:
 * - Sidebar expansion state
 * - Profile image loading state (no flicker!)
 * - Scroll positions
 */
export type NextPageWithLayout<P = object, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

export default function App({ Component, pageProps }: AppPropsWithLayout) {
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
  // Note: _document.tsx also adds this via inline script for even earlier application
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      // Ensure class is added (may already be added by _document.tsx script)
      document.documentElement.classList.add('is-native');
      document.body.classList.add('is-native');
      
      // Configure StatusBar overlay EARLY (before full init) for consistent safe areas
      import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
        StatusBar.setOverlaysWebView({ overlay: true }).catch((e) => console.warn('StatusBar overlay init:', e));
        StatusBar.setStyle({ style: Style.Default }).catch((e) => console.warn('StatusBar style init:', e));
      }).catch((e) => console.warn('StatusBar import failed:', e));
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
        // Safe areas handled by CSS env() with hardcoded fallbacks (24px/20px)
      } catch (err) {
        console.error('StatusBar Setup Error:', err);
      }

      try {
        await Keyboard.setResizeMode({ mode: 'body' } as any);
      } catch (err) {
        console.warn('Keyboard resize mode setup:', err);
      }

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
        // Style.Dark creates white icons for dark backgrounds (needed for dark header gradient)
        // Style.Light creates dark icons for light backgrounds (for public pages)
        // All authenticated dashboard pages have dark gradient header, need white status bar icons
        const DARK_HEADER_PAGES = [
          '/dashboard',
          '/comments',
          '/messages',
          '/pages',
          '/settings',
          '/pricing',
          '/templates',
          '/rules',
          '/auth',
          '/terms',
          '/privacy'
        ];
        const isDarkPage = DARK_HEADER_PAGES.some(page => url.includes(page));
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

  // Push notifications: init listeners (no permission request) + deferred pre-prompt
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authToken = useAuthStore((state) => state.token);
  const [showPushPrompt, setShowPushPrompt] = useState(false);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || !authToken) return;
    if (typeof window === 'undefined') return;
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return;

    // 1. Set up listeners if permission already granted (returning users)
    import('@/lib/notifications').then(({ initPushNotifications, shouldShowNotificationPrePrompt }) => {
      initPushNotifications(authToken).catch(console.error);

      // 2. Check if we should show the pre-prompt (deferred by 5 seconds)
      const timer = setTimeout(() => {
        shouldShowNotificationPrePrompt().then((should) => {
          if (should) setShowPushPrompt(true);
        });
      }, 5000);
      return () => clearTimeout(timer);
    });
  }, [hasHydrated, isAuthenticated, authToken]);

  const handleEnablePush = useCallback(() => {
    setShowPushPrompt(false);
    if (!authToken) return;
    import('@/lib/notifications').then(({ requestAndRegisterPush }) => {
      requestAndRegisterPush(authToken).catch(console.error);
    });
  }, [authToken]);

  const handleDismissPush = useCallback(() => {
    setShowPushPrompt(false);
    import('@/lib/notifications').then(({ dismissNotificationPrePrompt }) => {
      dismissNotificationPrePrompt();
    });
  }, []);

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

  // Use persistent layout if page defines one
  // This prevents DashboardLayout (and Sidebar) from remounting on navigation
  const getLayout = Component.getLayout ?? ((page) => page);

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>{BRAND_ASSETS.meta.appTitle}</title>
        <meta name="description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7." />
        <meta name="theme-color" content={BRAND_ASSETS.meta.themeColor} />
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />

        {/* Canonical URL - Dynamic based on locale */}
        <link rel="canonical" href={BRAND_ASSETS.urls.canonical(locale === 'en' ? '/en' : '')} />

        {/* Hreflang Tags for Multi-language Support */}
        <link rel="alternate" hrefLang="ar" href={BRAND_ASSETS.urls.canonical('/')} />
        <link rel="alternate" hrefLang="en" href={BRAND_ASSETS.urls.canonical('/en')} />
        <link rel="alternate" hrefLang="x-default" href={BRAND_ASSETS.urls.canonical('/')} />

        {/* Open Graph Defaults */}
        <meta property="og:site_name" content={BRAND_ASSETS.meta.appName} />
        <meta property="og:title" content={BRAND_ASSETS.meta.appTitle} />
        <meta property="og:description" content="Jawab24 جواب - Smart AI auto-replies for Facebook & Instagram Pages. Save time with instant, accurate responses 24/7." />
        <meta property="og:image" content={BRAND_ASSETS.urls.ogImage(BRAND_ASSETS.seo.ogSocial)} />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content={locale === 'ar' ? 'ar_SA' : 'en_US'} />
        <meta property="og:locale:alternate" content={locale === 'ar' ? 'en_US' : 'ar_SA'} />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={BRAND_ASSETS.meta.appTitle} />
        <meta name="twitter:description" content="Smart AI auto-replies for Facebook & Instagram. الرد الذكي التلقائي لفيسبوك وإنستغرام." />
        <meta name="twitter:image" content={BRAND_ASSETS.urls.ogImage(BRAND_ASSETS.seo.ogSocial)} />

        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <AppShell className={`${dmSans.variable} ${cairo.variable} ${tajawal.variable}`}>
        <ErrorBoundary>
          {getLayout(<Component {...pageProps} />)}
          <Toaster richColors position="top-center" closeButton duration={4000} />
          {showPushPrompt && (
            <NotificationPrePrompt onEnable={handleEnablePush} onDismiss={handleDismissPush} />
          )}
        </ErrorBoundary>
      </AppShell>
    </QueryClientProvider>
  );
}
