import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { isIOSNative } from '@/lib/capacitor';
import { isIOSBlockedRoute } from '@/lib/paymentRoutes';

/**
 * App Store Guideline 3.1.1 — the single choke point for route entry on iOS.
 *
 * `useIOSPaymentRedirect` guards a page once it has already been entered, and
 * the deep-link handler in `_app.tsx` guards links arriving from outside the
 * app. Neither covers an in-app navigation to a route that has no hook: a
 * stray `<Link>` (the landing footer still points at `/compare/*`),
 * `router.push`, or restored history.
 *
 * ⚠️ AND DELETING THE PAGE'S HTML DOES NOT COVER IT EITHER. Next serves a
 * client-side navigation from the page's JS chunk under `_next/static/`, which
 * the build-time strip never touches. Proved on a simulator (2026-08-10):
 * `com.jawab24.app://compare/manychat` rendered the full comparison table —
 * "باقة Starter في جواب24 بـ 15 دولاراً شهرياً" — from a build whose
 * `compare/manychat.html` had been deleted. The build-time layers stop the
 * static paint; only this stops the route.
 *
 * Cancelling by throwing from `routeChangeStart` is Next's documented way to
 * abort a navigation. It stops the route being ENTERED, so there is no
 * half-rendered frame in which a price can flash.
 *
 * No-op on web and Android, where these routes are legitimate.
 */
export function useIOSRouteGuard(): void {
  const router = useRouter();

  useEffect(() => {
    if (!isIOSNative()) return;

    const guard = (url: string) => {
      if (!isIOSBlockedRoute(url)) return;
      router.events.emit('routeChangeError');
      // The router swallows this. It is a control-flow signal, not an error,
      // so it deliberately does not go through captureError.
      throw 'Route cancelled: App Store Guideline 3.1.1';
    };

    router.events.on('routeChangeStart', guard);
    return () => router.events.off('routeChangeStart', guard);
  }, [router]);
}
