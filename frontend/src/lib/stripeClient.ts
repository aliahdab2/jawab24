import { loadStripe } from '@stripe/stripe-js';
import type { Appearance } from '@stripe/stripe-js';

/**
 * Shared Stripe.js client + Elements appearance.
 *
 * Single source of truth for the browser Stripe integration — imported by the
 * subscription checkout (`pages/checkout.tsx`), the payment return page
 * (`pages/payment/return.tsx`), and the top-up modal. Keeping one loader
 * matters: `loadStripe` must be called once per page load (the promise is
 * memoized below) and the appearance must stay visually consistent across
 * every payment surface.
 */

let stripePromise: ReturnType<typeof loadStripe> | null = null;

/**
 * Memoized Stripe.js loader. Returns `null` when
 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not configured (e.g. preview
 * environments) so callers can degrade gracefully instead of throwing.
 */
export function getStripePromise() {
  if (!stripePromise && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}

/** Stripe Elements appearance matching the Jawab24 brand, theme-aware. */
export function getStripeAppearance(isDark: boolean): Appearance {
  return {
    theme: isDark ? 'night' : 'stripe',
    variables: {
      colorPrimary: isDark ? '#3e877e' : '#0d9488',
      colorBackground: isDark ? '#0e182a' : '#ffffff',
      colorText: isDark ? '#ebf0f5' : '#121c1b',
      colorDanger: '#f87171',
      fontFamily: 'Inter, system-ui, sans-serif',
      borderRadius: '12px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': {
        backgroundColor: isDark ? '#060d18' : '#ffffff',
        borderColor: isDark ? '#1c283c' : '#dae4e3',
        color: isDark ? '#ebf0f5' : '#121c1b',
      },
      '.Input:focus': {
        borderColor: isDark ? '#3e877e' : '#0d9488',
        boxShadow: `0 0 0 1px ${isDark ? '#3e877e' : '#0d9488'}`,
      },
      '.Label': {
        color: isDark ? '#788da0' : '#556361',
      },
      '.Tab': {
        backgroundColor: isDark ? '#0e182a' : '#ffffff',
        borderColor: isDark ? '#1c283c' : '#dae4e3',
      },
      '.Tab--selected': {
        backgroundColor: isDark ? '#3e877e' : '#0d9488',
        color: '#ffffff',
      },
    },
  };
}
