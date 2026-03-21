import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { useUIStore, useAuthStore } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { dmSans, cairo, tajawal, outfit, jetbrainsMono } from '@/lib/fonts';
import { Toaster } from 'sonner';
import { isNativePlatform } from '@/lib/capacitor';
import { captureError, addErrorBreadcrumb } from '@/lib/sentryHelpers';
import { useMobileMessages } from '@/hooks/useMobileMessages';
import { NotificationPrePrompt } from '@/components/ui/NotificationPrePrompt';
import { BRAND_ASSETS } from '@/constants/brand';
import { useSSE, useTheme } from '@/hooks';
import { getLocaleDirection, getOGLocale, getOGAlternateLocales, isDefaultLocale } from '@/utils/locale';

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

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: true,
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

  // Store language — used by locale sync effect and effectiveLocale
  const storeLanguage = useUIStore((s) => s.language);

  // Add is-native class IMMEDIATELY on first render (before hydration completes)
  // This ensures CSS safe area rules apply from the start
  // Note: _document.tsx also adds this via inline script for even earlier application
  useEffect(() => {
    if (!isNativePlatform()) return;
    // Ensure class is added (may already be added by _document.tsx script)
    document.documentElement.classList.add('is-native');
    document.body.classList.add('is-native');

    // Safety timeout: hide splash screen after 3s even if hydration hasn't completed.
    // Prevents the app from being permanently stuck on the splash screen if storage
    // or rehydration fails. The normal path hides it earlier via initNativePlatform().
    const splashTimeout = setTimeout(() => {
      import("@capacitor/splash-screen").then(({ SplashScreen }) => {
        SplashScreen.hide().catch(() => {});
      }).catch(() => {});
    }, 3000);

    // Configure StatusBar overlay EARLY (before full init) for consistent safe areas
    import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
      StatusBar.setOverlaysWebView({ overlay: true }).catch((e) => addErrorBreadcrumb('capacitor', 'StatusBar overlay init failed', { error: String(e) }));
      StatusBar.setStyle({ style: Style.Default }).catch((e) => addErrorBreadcrumb('capacitor', 'StatusBar style init failed', { error: String(e) }));
    }).catch((e) => addErrorBreadcrumb('capacitor', 'StatusBar import failed', { error: String(e) }));

    // Android fix: env(safe-area-inset-top) often returns 0 even with overlaysWebView.
    // Detect this and apply a JS-measured fallback so safe area CSS works correctly.
    // Note: bottom safe area is not needed — Android nav bar is opaque (styles.xml).
    import("@capacitor/core").then(({ Capacitor }) => {
      if (Capacitor.getPlatform() !== 'android') return;
      // Wait a frame for StatusBar overlay to take effect
      requestAnimationFrame(() => {
        const probe = document.createElement('div');
        probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
        document.body.appendChild(probe);
        const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
        document.body.removeChild(probe);
        if (inset === 0) {
          // env() returned 0 — set fallback (24px is standard Android status bar)
          document.documentElement.style.setProperty('--sai-top', '24px');
        }
      });
    }).catch(() => {});

    // Track keyboard height via visualViewport API (web standard).
    // KeyboardResize.Body resizes <body> but fixed-position modals use viewport units,
    // so they need --keyboard-height to cap their max-height correctly.
    // visualViewport is more accurate than Capacitor Keyboard events and works on web too.
    const vv = window.visualViewport;
    if (vv) {
      const updateKeyboardHeight = () => {
        const kbHeight = Math.max(0, window.innerHeight - vv.height);
        document.documentElement.style.setProperty('--keyboard-height', `${kbHeight}px`);
      };
      vv.addEventListener('resize', updateKeyboardHeight);
    }

    return () => clearTimeout(splashTimeout);
  }, []); // Empty deps = runs once on mount

  // Sync Next.js locale with language store
  // Only redirects when on the default locale URL but store says otherwise.
  // This handles: returning user, post-login redirect, store rehydration.
  // We intentionally do NOT overwrite the store from the URL — all language
  // changes go through useLanguage().setLanguage() which syncs both store
  // and router atomically. Overwriting the store here would fight the toggle.
  // IMPORTANT: Never redirect auth callback — it has single-use OAuth codes
  // that would break if the page reloads mid-exchange.
  const pathname = routerRef.current.pathname;
  useEffect(() => {
    if (!locale || !hasHydrated) return;

    if (storeLanguage !== locale && isDefaultLocale(locale) && !pathname.startsWith('/auth/')) {
      routerRef.current.replace(routerRef.current.pathname, routerRef.current.asPath, { locale: storeLanguage });
      return;
    }

    document.documentElement.dir = getLocaleDirection(locale);
    document.documentElement.lang = locale;
  }, [locale, storeLanguage, hasHydrated, pathname]);

  // Native platform initialization (only runs on mobile)
  useEffect(() => {
    const initNativePlatform = async () => {
      if (!isNativePlatform()) return;

      // Note: is-native class is already added in the earlier useEffect

      // StatusBar overlay/style already configured in the early useEffect above
      const [{ StatusBar, Style }, { Keyboard }, { App }, { SplashScreen }, { Network }] = await Promise.all([
        import("@capacitor/status-bar"),
        import("@capacitor/keyboard"),
        import("@capacitor/app"),
        import("@capacitor/splash-screen"),
        import("@capacitor/network")
      ]);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Capacitor Keyboard plugin type lacks 'body' mode
        await Keyboard.setResizeMode({ mode: 'body' } as any);
      } catch (err) {
        addErrorBreadcrumb('capacitor', 'Keyboard resize mode setup failed', { error: String(err) });
      }

      // Clear existing listeners if any (prevent duplicates)
      listenersRef.current.forEach(remove => remove());
      listenersRef.current = [];

      // Handle hardware back button (Android) - Industry Standard
      // Exit app when on root screens, otherwise go back in history
      const ROOT_SCREENS = ['/dashboard', '/login', '/'];
      
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

      // Handle network changes — update offline indicator + refresh data on reconnect
      const { setOffline } = useUIStore.getState();
      const initialStatus = await Network.getStatus();
      setOffline(!initialStatus.connected);
      const networkListener = await Network.addListener('networkStatusChange', (status) => {
        setOffline(!status.connected);
        if (status.connected) {
          queryClient.invalidateQueries();
        }
      });
      listenersRef.current.push(() => networkListener.remove());

      // ALWAYS hide splash - this is critical
      await SplashScreen.hide();
    };

    if (hasHydrated) {
      initNativePlatform().catch((err: unknown) => { captureError(err, 'Native platform init failed', { tags: { context: 'native-init' } }); });
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
    if (!isNativePlatform()) return;

    // 1. Set up listeners if permission already granted (returning users)
    import('@/lib/notifications').then(({ initPushNotifications, shouldShowNotificationPrePrompt }) => {
      initPushNotifications(authToken).catch((err: unknown) => { captureError(err, 'Push notification init failed', { tags: { context: 'push-init' } }); });

      // 2. Check if we should show the pre-prompt (deferred by 5 seconds)
      // shouldShowNotificationPrePrompt is sync (localStorage only, no Capacitor API)
      const timer = setTimeout(() => {
        if (shouldShowNotificationPrePrompt()) setShowPushPrompt(true);
      }, 5000);
      return () => clearTimeout(timer);
    });
  }, [hasHydrated, isAuthenticated, authToken]);

  // SSE: moved to <SSEManager /> inside QueryClientProvider (see below)

  const handleEnablePush = useCallback(() => {
    setShowPushPrompt(false);
    if (!authToken) return;
    import('@/lib/notifications').then(({ requestAndRegisterPush }) => {
      requestAndRegisterPush(authToken).catch((err: unknown) => { captureError(err, 'Push notification register failed', { tags: { context: 'push-register' } }); });
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
    if (!hasHydrated || !isNativePlatform()) return;

    let listenerHandle: { remove: () => void } | undefined;

    const setupDeepLinks = async () => {
      const { App } = await import("@capacitor/app");
      
      // Helper for URL parsing — only allow known hosts
      const handleDeepLink = (url: string): string | null => {
        // Custom scheme (e.g. com.jawab24.app://dashboard)
        if (url.startsWith("com.jawab24.app://")) {
            const raw = url.replace("com.jawab24.app://", "/");
            return raw.startsWith("/") ? raw : `/${raw}`;
        }
        // HTTPS universal links — parse with URL API and whitelist hosts
        try {
            const parsed = new URL(url);
            const allowedHosts = ["localhost", "jawab24.com", "www.jawab24.com"];
            if (allowedHosts.includes(parsed.hostname)) {
                return parsed.pathname + parsed.search;
            }
        } catch {
            // Invalid URL — ignore
        }
        return null;
      };

      // 1. Warm Start Listener
      listenerHandle = await App.addListener('appUrlOpen', async (data) => {
        const slug = handleDeepLink(data.url);
        if (!slug) return;

        // Close any open system browser (Chrome Custom Tab / SFSafariViewController)
        // left over from OAuth flow before navigating
        try {
          const { Browser } = await import('@capacitor/browser');
          await Browser.close();
        } catch {
          // Browser may not be open — that's fine
        }

        // Fast-path: handle auth sync inline instead of navigating to /auth/sync page.
        // The callback passes the full user object in the deep link URL, so we can
        // hydrate the store synchronously — zero network calls, instant redirect.
        if (slug.startsWith('/auth/sync')) {
          const params = new URLSearchParams(slug.split('?')[1] || '');
          const token = params.get('token');
          const fbToken = params.get('fbToken') || '';
          const redirect = params.get('redirect') || '/dashboard';
          const userParam = params.get('user');
          const safePath = redirect.startsWith('/') ? redirect : '/dashboard';

          if (token && userParam) {
            try {
              const user = JSON.parse(userParam);
              if (user?.id) {
                useAuthStore.getState().setAuth(user, token, fbToken);
                routerRef.current.replace(safePath).catch(console.error);
                return;
              }
            } catch (err) {
              captureError(err, 'Deep link auth parse failed', {
                tags: { page: 'deep-link', action: 'auth-sync' },
              });
            }
          }

          // Fallback: navigate to /auth/sync page (handles legacy deep links without user param)
          if (token) {
            routerRef.current.push(`/auth/sync?token=${encodeURIComponent(token)}&fbToken=${encodeURIComponent(fbToken)}&redirect=${encodeURIComponent(safePath)}`).catch(console.error);
            return;
          }
          // No token — fall through to normal navigation
        }

        setTimeout(() => {
            routerRef.current.push(slug).catch(console.error);
        }, 50);
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

  // Use persistent layout if page defines one
  // This prevents DashboardLayout (and Sidebar) from remounting on navigation
  const getLayout = Component.getLayout ?? ((page) => page);

  // Effective locale: router > Zustand store > default 'ar'
  // Mobile builds have no router locale, so fall back to store (reactive subscription)
  const effectiveLocale = locale || storeLanguage || 'ar';

  // On mobile (static export), translations are baked at build time for one locale.
  // Reload the correct messages client-side when language changes.
  const mobileMessages = useMobileMessages(effectiveLocale);

  // Always wrap in QueryClientProvider so hooks in child components can access it.
  // The hydration guard is inside the provider to avoid the "No QueryClient set" error
  // that occurs during Next.js prerendering when useQueryClient() is called outside a provider.
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={effectiveLocale}
        messages={mobileMessages || pageProps.messages || {}}
        timeZone="Asia/Riyadh"
      >
        <>
          <SSEManager />
          <ThemeManager />
          <MetaHead locale={effectiveLocale} />
          <AppShell className={`${dmSans.variable} ${cairo.variable} ${tajawal.variable} ${outfit.variable} ${jetbrainsMono.variable}`}>
            <ErrorBoundary name="root" resetKeys={router.asPath}>
              {getLayout(<Component {...pageProps} />)}
              <Toaster richColors position="top-center" closeButton duration={4000} theme="system" />
              {showPushPrompt && (
                <NotificationPrePrompt onEnable={handleEnablePush} onDismiss={handleDismissPush} />
              )}
            </ErrorBoundary>
          </AppShell>
        </>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** Renders nothing — mounts useSSE inside QueryClientProvider so it can access the QueryClient */
function SSEManager() {
  useSSE();
  return null;
}

/** Renders nothing — applies/removes .dark class on <html> based on theme preference */
function ThemeManager() {
  useTheme();
  return null;
}

/** Renders translated <Head> meta tags — must be inside NextIntlClientProvider */
function MetaHead({ locale }: { locale: string }) {
  const tMeta = useTranslations('meta');
  const router = useRouter();
  const cleanPath = router.asPath.split('?')[0].split('#')[0];
  const arPagePath = cleanPath === '/' ? '' : cleanPath;
  const enPagePath = '/en' + (cleanPath === '/' ? '' : cleanPath);

  return (
    <Head>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <title>{BRAND_ASSETS.meta.appTitle}</title>
      <meta name="description" content={tMeta('description')} />
      <meta name="theme-color" content={BRAND_ASSETS.meta.themeColor} />
      <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />

      {/* Canonical URL - Dynamic based on locale and current page */}
      <link rel="canonical" href={BRAND_ASSETS.urls.canonical(locale === 'en' ? enPagePath : arPagePath)} />

      {/* Hreflang Tags for Multi-language Support - page-aware */}
      <link rel="alternate" hrefLang="ar" href={BRAND_ASSETS.urls.canonical(arPagePath)} />
      <link rel="alternate" hrefLang="en" href={BRAND_ASSETS.urls.canonical(enPagePath)} />
      <link rel="alternate" hrefLang="x-default" href={BRAND_ASSETS.urls.canonical(arPagePath)} />

      {/* Facebook App ID for OG integration */}
      <meta property="fb:app_id" content="774211662298446" />

      {/* Open Graph Defaults — key props enable page-level overrides via next/head dedup */}
      <meta key="og:url" property="og:url" content={BRAND_ASSETS.urls.canonical(locale === 'en' ? enPagePath : arPagePath)} />
      <meta key="og:site_name" property="og:site_name" content={BRAND_ASSETS.meta.appName} />
      <meta key="og:title" property="og:title" content={BRAND_ASSETS.meta.appTitle} />
      <meta key="og:description" property="og:description" content={tMeta('ogDescription')} />
      <meta key="og:image" property="og:image" content={BRAND_ASSETS.urls.ogImage(BRAND_ASSETS.seo.ogSocial)} />
      <meta key="og:image:width" property="og:image:width" content="1200" />
      <meta key="og:image:height" property="og:image:height" content="630" />
      <meta key="og:type" property="og:type" content="website" />
      <meta key="og:locale" property="og:locale" content={getOGLocale(locale)} />
      {getOGAlternateLocales(locale).map(alt => (
        <meta key={alt} property="og:locale:alternate" content={alt} />
      ))}

      {/* Twitter Card — key props enable page-level overrides */}
      <meta key="twitter:card" name="twitter:card" content="summary_large_image" />
      <meta key="twitter:site" name="twitter:site" content="@jawab24" />
      <meta key="twitter:title" name="twitter:title" content={BRAND_ASSETS.meta.appTitle} />
      <meta key="twitter:description" name="twitter:description" content={tMeta('twitterDescription')} />
      <meta key="twitter:image" name="twitter:image" content={BRAND_ASSETS.urls.ogImage(BRAND_ASSETS.seo.ogSocial)} />

      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    </Head>
  );
}
