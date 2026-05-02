import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { isIOSNative } from '@/lib/capacitor';

/**
 * App Store Guideline 3.1.1: payment surfaces must not exist in the iOS app.
 * Redirects iOS native users away from any pricing/checkout/payment-result
 * page to the dashboard. No-op on web and Android.
 */
export function useIOSPaymentRedirect(): boolean {
  const router = useRouter();
  const shouldRedirect = isIOSNative();

  useEffect(() => {
    if (shouldRedirect) void router.replace('/dashboard');
  }, [router, shouldRedirect]);

  return shouldRedirect;
}
