/**
 * Regression: a checkout that never initialises must not fail in silence.
 *
 * Two distinct dead ends existed, both invisible to us:
 *
 *  1. Stripe.js never loads (blocked script, hostile network, a WebView that
 *     never fetched js.stripe.com). The submit button is `disabled={!stripe}`,
 *     so the merchant just sees a dead form — no message, no Sentry event.
 *  2. `stripe` resolves but `elements` doesn't. The button is NOT disabled in
 *     that case, so the click lands on `handleSubmit`, which opened with a bare
 *     `if (!stripe || !elements) return;` and swallowed it without a word.
 *
 * From support's side either one is indistinguishable from a refused card,
 * which is how a merchant sat on an `incomplete` subscription across three
 * attempts with no trace in Stripe or Sentry (2026-07-25).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import enCheckout from '@/i18n/en/checkout.json';

// --- Stripe ---------------------------------------------------------------
// `stripeState` lets each test decide how far Stripe.js got.
const stripeState: { stripe: unknown; elements: unknown } = { stripe: null, elements: null };
const mockConfirmPayment = vi.fn();
const mockConfirmSetup = vi.fn();
vi.mock('@stripe/react-stripe-js', () => ({
    Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PaymentElement: () => <div data-testid="payment-element" />,
    useStripe: () => stripeState.stripe,
    useElements: () => stripeState.elements,
}));

// --- Sentry ---------------------------------------------------------------
const mockCaptureError = vi.fn();
vi.mock('@/lib/sentryHelpers', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

// --- Module-load dependencies of the checkout page ------------------------
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), query: {}, locale: 'en' }) }));
vi.mock('next/head', () => ({ __esModule: true, default: () => null }));
vi.mock('@/lib/api', () => ({ api: { post: vi.fn() }, publicApi: { get: vi.fn() } }));
vi.mock('@/lib/store', () => ({ useAuthStore: () => ({ isAuthenticated: true }) }));
vi.mock('@/hoc', () => ({ withOwnerOnly: (c: unknown) => c }));
vi.mock('@/utils/geoCheck', () => ({ isUserSanctioned: () => Promise.resolve(false) }));
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false, isIOSNative: () => false }));
// `loaderResult` decides what the memoized loadStripe() promise does: null (no
// publishable key), a rejection (script blocked/offline), or a resolved value.
const loaderResult: { promise: Promise<unknown> | null } = { promise: null };
vi.mock('@/lib/stripeClient', () => ({
    getStripePromise: () => loaderResult.promise,
    getStripeAppearance: () => ({}),
}));
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/webUrl', () => ({ buildWebUrl: (p: string) => p }));
vi.mock('@/hooks', () => ({ useIOSPaymentRedirect: () => ({}), useIsDarkMode: () => false }));

import { PaymentForm } from '@/pages/checkout';

const GRACE_MS = 10_000;

const renderForm = () =>
    render(<PaymentForm type="payment" submitLabel="Pay" trustNote="secure" />);

beforeEach(() => {
    vi.clearAllMocks();
    stripeState.stripe = null;
    stripeState.elements = null;
    // A loader that never settles: the stripe-js#26 quirk the backstop exists
    // for. `null` means "no publishable key configured" and now reports
    // immediately, so it belongs only to its own test.
    loaderResult.promise = new Promise(() => {});
});

describe('PaymentForm — Stripe.js load rejects', () => {
    // The deterministic signal. loadStripe() rejects when the script can't be
    // fetched, so we must report immediately rather than wait out the backstop.
    it('reports without waiting for the timeout backstop', async () => {
        loaderResult.promise = Promise.reject(new Error('Failed to load Stripe.js'));
        renderForm();

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalledTimes(1));
        const [err, label, context] = mockCaptureError.mock.calls[0];
        expect((err as Error).message).toBe('Failed to load Stripe.js');
        expect(label).toBe('Payment form failed to load');
        expect(context).toMatchObject({ tags: { page: 'checkout' }, extra: { reason: 'load-rejected' } });
        expect(screen.getByText(enCheckout.errorPaymentFormNotReady)).toBeInTheDocument();
    });

    it('reports when the loader resolves to null', async () => {
        loaderResult.promise = Promise.resolve(null);
        renderForm();

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalledTimes(1));
        expect(mockCaptureError.mock.calls[0][2]).toMatchObject({ extra: { reason: 'resolved-null' } });
    });

    it('reports only once — rejection must not double-fire with the backstop', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        loaderResult.promise = Promise.reject(new Error('Failed to load Stripe.js'));
        renderForm();

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalledTimes(1));
        await act(async () => { vi.advanceTimersByTime(GRACE_MS * 2); });

        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});

describe('PaymentForm — Stripe.js never loads', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('leaves the pay button disabled', () => {
        renderForm();
        expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled();
    });

    it('explains itself once the grace period lapses', async () => {
        renderForm();

        // Nothing said while the script still has time to arrive.
        expect(screen.queryByText(enCheckout.errorPaymentFormNotReady)).not.toBeInTheDocument();

        await act(async () => { vi.advanceTimersByTime(GRACE_MS); });

        expect(screen.getByText(enCheckout.errorPaymentFormNotReady)).toBeInTheDocument();
    });

    it('reports the dead form to Sentry so support can see it', async () => {
        renderForm();
        await act(async () => { vi.advanceTimersByTime(GRACE_MS); });

        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        const [err, label, context] = mockCaptureError.mock.calls[0];
        expect((err as Error).message).toContain('Stripe.js unavailable');
        expect(label).toBe('Payment form failed to load');
        expect(context).toMatchObject({
            tags: { page: 'checkout', type: 'payment' },
            extra: { reason: 'timeout' },
        });
    });

    // Regression: the banner used to be sticky. A merchant on a slow connection
    // would see "the form failed to load" sitting above a working, enabled pay
    // button — telling them their payment is broken when it is fine.
    it('retracts the banner when Stripe.js arrives late', async () => {
        loaderResult.promise = Promise.resolve(null);
        const { rerender } = renderForm();

        await waitFor(() => {
            expect(screen.getByText(enCheckout.errorPaymentFormNotReady)).toBeInTheDocument();
        });

        stripeState.stripe = { confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup };
        stripeState.elements = {};
        rerender(<PaymentForm type="payment" submitLabel="Pay" trustNote="secure" />);

        await waitFor(() => {
            expect(screen.queryByText(enCheckout.errorPaymentFormNotReady)).not.toBeInTheDocument();
        });
    });

    // A missing publishable key is a deployment fault, knowable instantly.
    // Reporting it as `timeout` would send whoever reads Sentry after the network.
    it('reports a missing publishable key immediately, not as a timeout', async () => {
        loaderResult.promise = null;
        renderForm();

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalledTimes(1));
        expect(mockCaptureError.mock.calls[0][2]).toMatchObject({
            extra: { reason: 'no-publishable-key' },
        });
    });

    it('announces the failure to assistive tech', async () => {
        loaderResult.promise = Promise.resolve(null);
        renderForm();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(enCheckout.errorPaymentFormNotReady);
        });
    });

    it('stays quiet when Stripe.js arrives within the grace period', async () => {
        const { rerender } = renderForm();

        stripeState.stripe = { confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup };
        stripeState.elements = {};
        rerender(<PaymentForm type="payment" submitLabel="Pay" trustNote="secure" />);

        await act(async () => { vi.advanceTimersByTime(GRACE_MS); });

        expect(mockCaptureError).not.toHaveBeenCalled();
        expect(screen.queryByText(enCheckout.errorPaymentFormNotReady)).not.toBeInTheDocument();
    });
});

describe('PaymentForm — submit with elements missing', () => {
    // `stripe` present but `elements` null: the button is live, so the click
    // reaches handleSubmit. This is the branch the bare `return` swallowed.
    beforeEach(() => {
        stripeState.stripe = { confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup };
        stripeState.elements = null;
    });

    it('shows a real message instead of swallowing the click', async () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Pay' }));

        await waitFor(() => {
            expect(screen.getByText(enCheckout.errorPaymentFormNotReady)).toBeInTheDocument();
        });
    });

    it('does not attempt a charge', async () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Pay' }));

        await waitFor(() => expect(mockCaptureError).toHaveBeenCalled());
        expect(mockConfirmPayment).not.toHaveBeenCalled();
        expect(mockConfirmSetup).not.toHaveBeenCalled();
    });
});

describe('PaymentForm — happy path', () => {
    beforeEach(() => {
        mockConfirmPayment.mockResolvedValue({ error: undefined });
        stripeState.stripe = { confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup };
        stripeState.elements = {};
    });

    it('confirms the payment and says nothing about loading', async () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Pay' }));

        await waitFor(() => expect(mockConfirmPayment).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(enCheckout.errorPaymentFormNotReady)).not.toBeInTheDocument();
        expect(mockCaptureError).not.toHaveBeenCalled();
    });
});
