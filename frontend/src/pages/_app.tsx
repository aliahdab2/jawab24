import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { dmSans, cairo, tajawal, outfit, jetbrainsMono } from '@/lib/fonts';
import { useUIStore, useAuthStore } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { Toaster } from 'sonner';
import { isNativePlatform, isIOSNative } from '@/lib/capacitor';
import { isIOSBlockedRoute } from '@/lib/paymentRoutes';
import { useIOSRouteGuard } from '@/hooks/useIOSRouteGuard';
import { captureError, addErrorBreadcrumb } from '@/lib/sentryHelpers';
import { useMobileMessages } from '@/hooks/useMobileMessages';
import { dismissTopModal } from '@/hooks/useModalBackHandler';
import { resolveBackAction, createNavDepthTracker } from '@/lib/nativeBackButton';
import { NotificationPrePrompt } from '@/components/ui/NotificationPrePrompt';
import { BRAND_ASSETS } from '@/constants/brand';
import { AUTH_BRIDGE_PATHS } from '@/constants/auth';
// Direct imports, NOT the '@/hooks' barrel (53 re-exports): _app is in the
// shared chunk every public visitor downloads, and the barrel drags
// sonner/react-query/api-consuming hooks into it (measured 2026-08-17:
// _app chunk 238.9 kB wire at Slow 3G).
import { useSSE } from '@/hooks/useSSE';
import { useTheme } from '@/hooks/useTheme';

// PushDeniedBanner statically imports @capacitor/core; it renders only inside
// the authed app, so keep the Capacitor package out of the public shared chunk.
const PushDeniedBanner = dynamic(
  () => import('@/components/ui/PushDeniedBanner').then((m) => m.PushDeniedBanner),
  { ssr: false },
);
import { getLocaleDirection, getOGLocale, getOGAlternateLocales, isDefaultLocale, isRTLLocale } from '@/utils/locale';

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

// 30-day aggregation queries with long staleTime (see dashboard.tsx). Excluded
// from the blanket resume/reconnect invalidation below: those fire on every app
// foreground, and re-running the two heaviest analytics aggregations each time
// contributes to the burst that can trip the API rate limit. Their data spans
// 30 days — minutes of staleness is invisible.
const SLOW_ANALYTICS_KEYS = new Set(['dashboard-analytics', 'dashboard-ai-usage']);
const invalidateVolatileQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({
    predicate: (query) => !SLOW_ANALYTICS_KEYS.has(String(query.queryKey[0])),
  });
};

export default function App({ Component, pageProps }: AppPropsWithLayout) {
  const router = useRouter();
  const { locale } = router;

  // Use ref for router to avoid dependency issues
  const routerRef = useRef(router);
  routerRef.current = router;

  // Use ref for listeners to handle cleanup
  const listenersRef = useRef<(() => void)[]>([]);

  // In-app navigation depth for the Android back button. Must outlive the native
  // init effect: a function-local counter is reset to 0 by any re-run of that
  // effect, which makes back exit the app from every screen.
  const navDepthRef = useRef(createNavDepthTracker());

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // Single retry layer for HTTP errors (axios only retries transport failures).
        // 4xx is a client error — retrying makes things worse, especially 429 which
        // means we're already being throttled. 5xx/network: up to 2 retries.
        retry: (failureCount, error) => {
          const status = isAxiosError(error) ? error.response?.status : undefined;
          if (typeof status === 'number' && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
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

    // iOS: lock viewport scale to prevent auto-zoom when focusing inputs.
    // WKWebView zooms on input focus even with font-size >= 16px in some cases,
    // permanently distorting the layout. This is standard for Capacitor apps.
    // Only applied on native to preserve accessibility zoom on web.
    import("@capacitor/core").then(({ Capacitor }) => {
      if (!Capacitor.isNativePlatform()) return;
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
      }
    }).catch(() => {});

    // Configure StatusBar overlay EARLY (before full init) for consistent safe areas
    import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
      StatusBar.setOverlaysWebView({ overlay: true }).catch((e) => addErrorBreadcrumb('capacitor', 'StatusBar overlay init failed', { error: String(e) }));
      StatusBar.setStyle({ style: Style.Default }).catch((e) => addErrorBreadcrumb('capacitor', 'StatusBar style init failed', { error: String(e) }));
    }).catch((e) => addErrorBreadcrumb('capacitor', 'StatusBar import failed', { error: String(e) }));

    // Android fix: env(safe-area-inset-top) often returns 0 even with overlaysWebView.
    // Detect this and apply a JS-measured fallback so safe area CSS works correctly.
    // Side safe areas are not needed — viewport-fit=cover is iOS-only now, so the
    // Android WebView does not extend behind the navigation bar.
    import("@capacitor/core").then(({ Capacitor }) => {
      if (Capacitor.getPlatform() !== 'android') return;
      requestAnimationFrame(() => {
        const probe = document.createElement('div');
        probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
        document.body.appendChild(probe);
        const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
        document.body.removeChild(probe);
        if (inset === 0) {
          document.documentElement.style.setProperty('--sai-top', '24px');
        }
      });
    }).catch(() => {});

    // --keyboard-height / keyboard-open tracking lives in setupKeyboard()
    // (src/lib/keyboardSetup.ts), wired up in initNativePlatform below. Keeping
    // it in one place means a single source of truth for the keyboard height —
    // two competing writers used to race and double-count, floating modals far
    // above the keyboard on edge-to-edge Android.

    return () => {
      clearTimeout(splashTimeout);
    };
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

      // See src/lib/keyboardSetup.ts for the platform-specific strategy.
      let isAndroid = false;
      let kbCleanup: Array<() => void> = [];
      try {
        const [{ getCapacitor }, { setupKeyboard }] = await Promise.all([
          import('@/lib/capacitor'),
          import('@/lib/keyboardSetup'),
        ]);
        isAndroid = getCapacitor()?.getPlatform() === 'android';
        if (isAndroid) {
          document.documentElement.classList.add('is-android');
        }
        kbCleanup = await setupKeyboard(Keyboard, isAndroid);
      } catch (err) {
        addErrorBreadcrumb('capacitor', 'Keyboard resize mode setup failed', { error: String(err) });
      }

      // Clear existing listeners if any (prevent duplicates)
      listenersRef.current.forEach(remove => remove());
      listenersRef.current = [];

      kbCleanup.forEach(fn => listenersRef.current.push(fn));

      // Handle hardware back button (Android) - Industry Standard
      // Priority: close open modal/overlay first, then navigate back, then exit.
      // The decision and the depth arithmetic live in @/lib/nativeBackButton so
      // they are testable. beforePopState marks backward navigation: Next emits
      // routeChangeComplete for pops as well, so without it a back press is
      // counted as a forward one and the depth never decreases.
      const navTracker = navDepthRef.current;
      routerRef.current.beforePopState(() => { navTracker.markPop(); return true; });
      listenersRef.current.push(() => routerRef.current.beforePopState(() => true));

      const onRouteChangeComplete = () => { navTracker.settle(); };
      const onRouteChangeError = () => { navTracker.abort(); };
      routerRef.current.events.on('routeChangeComplete', onRouteChangeComplete);
      routerRef.current.events.on('routeChangeError', onRouteChangeError);
      listenersRef.current.push(() => {
        routerRef.current.events.off('routeChangeComplete', onRouteChangeComplete);
        routerRef.current.events.off('routeChangeError', onRouteChangeError);
      });

      const backListener = await App.addListener('backButton', () => {
        // 1. Dismiss topmost open modal/overlay first (Android user expectation)
        if (dismissTopModal()) return;

        const router = routerRef.current;

        // 2. Exit on a root screen, or when no in-app navigation has happened
        if (resolveBackAction(router.pathname, navTracker.depth()) === 'exit') {
          App.exitApp();
        } else {
          // 3. Navigate back within the app. The depth is decremented by the
          //    popstate this triggers, not here — decrementing here as well
          //    double-counts and leaves the depth unchanged.
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
          '/auth',
          '/terms',
          '/privacy'
        ];
        const isDarkPage = DARK_HEADER_PAGES.some(page => url.includes(page));
        StatusBar.setStyle({ style: isDarkPage ? Style.Dark : Style.Light }).catch(() => {});
      };
      
      routerRef.current.events.on('routeChangeComplete', handleRouteChange);
      listenersRef.current.push(() => routerRef.current.events.off('routeChangeComplete', handleRouteChange));

      // Set initial style
      handleRouteChange(routerRef.current.asPath);

      // Handle app resume - refresh data
      const resumeListener = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          invalidateVolatileQueries(queryClient);
          // Ensure overlay and style are correct on resume (Best Practice for cold starts)
          StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
          handleRouteChange(routerRef.current.asPath);
          // Self-healing FCM token: re-register on every foreground so backend
          // gets a fresh last_used_at and any rotated token. No-op if user never
          // granted permission or listeners aren't initialized yet.
          import('@/lib/notifications').then(({ refreshPushRegistration }) => {
            refreshPushRegistration();
          });
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
          invalidateVolatileQueries(queryClient);
        }
      });
      listenersRef.current.push(() => networkListener.remove());

      // Register notification tap handler BEFORE hiding splash — cold-start taps
      // navigate while splash is still showing, so user never sees an intermediate page.
      const { registerNotificationTapListener } = await import('@/lib/notifications');
      await registerNotificationTapListener();

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
    // `router` is deliberately NOT a dependency. useRouter() has no stable identity
    // in the pages router — next/dist/client/index.js renders the provider with
    // `value={makePublicRouterInstance(router)}`, which builds a fresh object on
    // every call, and AppContainer re-renders on every navigation. Listing it here
    // re-ran this whole block per navigation: back/keyboard/app-state/network
    // listeners were torn down and re-registered, SplashScreen.hide() and
    // Network.getStatus() re-fired, navDepth reset to 0 (back then exited the app
    // from any screen), and setupKeyboard() re-captured its baseline — mid-typing,
    // that baseline is the shrunken viewport. Everything inside reads
    // routerRef.current, which is refreshed on every render, so the live router is
    // always in hand without re-running the effect.
  }, [hasHydrated, queryClient]);

  // Push notifications: init listeners (no permission request) + deferred pre-prompt
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authToken = useAuthStore((state) => state.token);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [showPushDeniedBanner, setShowPushDeniedBanner] = useState(false);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || !authToken) return;
    if (!isNativePlatform()) return;

    // Cancellation is owned by the EFFECT, not by the dynamic import's callback.
    // Returning the cleanup from inside .then() hands it to the promise chain,
    // which discards it — React never sees it, so the timer outlived the effect
    // and could raise the pre-prompt after logout or stack duplicates when the
    // token refreshed. The `cancelled` flag covers the window the timer cannot:
    // the import and the two Preferences reads are all async, so each can still
    // resolve after teardown.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    // 1. Set up listeners if permission already granted (returning users)
    import('@/lib/notifications').then(({ initPushNotifications, shouldShowNotificationPrePrompt, shouldShowPushDeniedBanner }) => {
      if (cancelled) return;
      initPushNotifications(authToken).catch((err: unknown) => { captureError(err, 'Push notification init failed', { tags: { context: 'push-init' } }); });

      // 2. Check if we should show the pre-prompt (deferred by 5 seconds)
      // shouldShowNotificationPrePrompt is async (uses native Preferences)
      timer = setTimeout(() => {
        shouldShowNotificationPrePrompt().then(show => { if (!cancelled && show) setShowPushPrompt(true); });
        // Recovery banner for users who previously denied — only shows when
        // pre-prompt won't (the helpers are mutually exclusive by design).
        shouldShowPushDeniedBanner().then(show => { if (!cancelled && show) setShowPushDeniedBanner(true); });
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
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

  const handleDismissPushDeniedBanner = useCallback(() => {
    setShowPushDeniedBanner(false);
    import('@/lib/notifications').then(({ dismissPushDeniedBanner }) => {
      dismissPushDeniedBanner();
    });
  }, []);

  // Dedicated Deep Link Handling - Separate effect for reliability
  // App Store Guideline 3.1.1 — the single choke point for route entry on iOS.
  // Lives in a hook so it can be tested against a real router; see the hook for
  // why the build-time layers cannot replace it.
  useIOSRouteGuard();

  useEffect(() => {
    if (!hasHydrated || !isNativePlatform()) return;

    let listenerHandle: { remove: () => void } | undefined;

    const setupDeepLinks = async () => {
      const { App } = await import("@capacitor/app");
      
      // Helper for URL parsing — only allow known hosts
      const handleDeepLink = (url: string): string | null => {
        const resolve = (): string | null => {
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

        const slug = resolve();
        // App Store Guideline 3.1.1: a deep link must never carry the iOS app
        // into a payment surface. Refusing here means the route is not entered
        // at all — the page-level guard would only blank it AFTER hydration,
        // and the exported HTML holds the prices as plain markup.
        if (slug && isIOSNative() && isIOSBlockedRoute(slug)) return null;
        return slug;
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
        // OAuth cancelled or failed — return to login
        if (slug.startsWith('/auth/error')) {
          routerRef.current.replace('/login').catch((err: unknown) => captureError(err, 'Deep link error redirect failed', { tags: { page: 'deep-link', action: 'error' } }));
          return;
        }

        if (AUTH_BRIDGE_PATHS.some((bridgePath) => slug.startsWith(bridgePath))) {
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
                routerRef.current.replace(safePath).catch((err: unknown) => captureError(err, 'Deep link replace failed', { tags: { page: 'deep-link', action: 'replace' } }));
                return;
              }
            } catch (err) {
              captureError(err, 'Deep link auth parse failed', {
                tags: { page: 'deep-link', action: 'auth-sync' },
              });
            }
          }

          // No token, but an explicit intent: an app-initiated flow coming
          // HOME rather than signing in — the WhatsApp connect return leg,
          // where the app never lost its session (it only lent the browser
          // one). Go to the intent; pushing `slug` would land on the bridge
          // page itself, which re-deep-links and loops.
          if (!token && params.has('redirect')) {
            routerRef.current.replace(safePath).catch((err: unknown) => captureError(err, 'Deep link return failed', { tags: { page: 'deep-link', action: 'return' } }));
            return;
          }

          // Fallback: navigate to /auth/sync page (handles legacy deep links without user param)
          if (token) {
            routerRef.current.push(`/auth/sync?token=${encodeURIComponent(token)}&fbToken=${encodeURIComponent(fbToken)}&redirect=${encodeURIComponent(safePath)}`).catch((err: unknown) => captureError(err, 'Deep link auth-sync push failed', { tags: { page: 'deep-link', action: 'auth-sync' } }));
            return;
          }
          // No token — fall through to normal navigation
        }

        setTimeout(() => {
            routerRef.current.push(slug).catch((err: unknown) => captureError(err, 'Deep link push failed', { tags: { page: 'deep-link', action: 'push' } }));
        }, 50);
      });

      // 2. Cold Start Check
      const launchUrl = await App.getLaunchUrl();
      if (launchUrl && launchUrl.url) {
        const slug = handleDeepLink(launchUrl.url);
        if (slug) {
             routerRef.current.push(slug).catch((err: unknown) => captureError(err, 'Deep link launch push failed', { tags: { page: 'deep-link', action: 'launch' } }));
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
          {/* Font CSS variables MUST be defined on :root, not on an inner wrapper:
              Tailwind's font stacks are built from these vars, and both
              `body { @apply font-sans }` (globals.css) and portals rendered into
              document.body sit OUTSIDE any wrapper — with the vars scoped to a
              wrapper, the body's font-family is invalid at computed-value time and
              the browser silently falls back to its default serif (Times).
              This is the documented pages-router pattern for styling <html>/<body>
              with next/font (font.style.fontFamily in a global style). */}
          <style jsx global>{`
            :root {
              --font-dm-sans: ${dmSans.style.fontFamily};
              --font-cairo: ${cairo.style.fontFamily};
              --font-tajawal: ${tajawal.style.fontFamily};
              --font-outfit: ${outfit.style.fontFamily};
              --font-jetbrains-mono: ${jetbrainsMono.style.fontFamily};
            }
          `}</style>
          {/* Google Analytics — lazyOnload, deliberately. As a raw
              <script async> in _document's <Head> it was the FIRST resource
              in <head>: 163.9 kB (14% of all first-visit bytes) queued ahead
              of the render-blocking stylesheet (measured 2026-08-17, Slow 3G:
              first paint 16.2 s). lazyOnload defers it to browser idle after
              load; no gtag()/dataLayer consumer exists elsewhere in the app,
              so nothing depends on it being ready early. */}
          {process.env.NEXT_PUBLIC_GA_ID && (
            <>
              <Script
                src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
                strategy="lazyOnload"
              />
              <Script id="gtag-init" strategy="lazyOnload">
                {`
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}', {
                    page_path: window.location.pathname,
                  });
                `}
              </Script>
            </>
          )}
          <AppShell>
            <ErrorBoundary name="root" resetKeys={router.asPath}>
              {getLayout(<Component {...pageProps} />)}
              <Toaster
                richColors
                // Bottom corner, mirrored for RTL (start-side stays clear of the
                // sidebar): bottom-right in LTR, bottom-left in AR.
                position={isRTLLocale(effectiveLocale) ? 'bottom-left' : 'bottom-right'}
                closeButton
                duration={4000}
                theme="system"
                dir={isRTLLocale(effectiveLocale) ? 'rtl' : 'ltr'}
                // Both props read the SAME token: sonner switches between them
                // at its own fixed 600px query, but the nav clearance the
                // offset exists for flips at lg (1024px). The token carries
                // the breakpoint (16px ≥lg in globals.css), so the 601–1023px
                // band clears the still-visible bottom nav too.
                offset={{ bottom: 'var(--toast-offset-bottom)' }}
                mobileOffset={{ bottom: 'var(--toast-offset-bottom)' }}
              />
              {showPushDeniedBanner && (
                <PushDeniedBanner onDismiss={handleDismissPushDeniedBanner} />
              )}
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

      {/* Facebook App ID — also in _document.tsx as backup for SSG */}
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
