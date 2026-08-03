/**
 * The native-app payment handoff (D-040).
 *
 * App-store policy forces payment into the system browser — which is whatever
 * the merchant's DEFAULT browser is. The old bounce sent them to our embedded
 * checkout there, and a privacy browser (Brave Shields) silently blocked the
 * PaymentElement's cross-origin card tokenisation: form rendered, pay did
 * nothing, no error anywhere (live incident, 2026-07-25 — the same card paid
 * instantly on a Stripe-hosted page).
 *
 * The fix: the app, being authenticated, creates a Stripe-HOSTED Checkout
 * Session itself and opens checkout.stripe.com directly — first-party on
 * Stripe's domain, nothing for a shield to block, and no second login.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plan, UsageSummary } from '@jawab24/shared';

const mockPush = vi.fn();
vi.mock('next/router', () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn(), asPath: '/pricing', locale: 'ar' }),
}));

const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), info: (...a: unknown[]) => mockToastInfo(...a), success: vi.fn() } }));

const authState = { isAuthenticated: true };
vi.mock('@/lib/store', () => ({ useAuthStore: () => ({ isAuthenticated: authState.isAuthenticated }) }));

const gateState = { blocked: false };
vi.mock('@/hooks', () => ({ useOwnerGate: () => gateState.blocked }));

const mockApiPost = vi.fn();
vi.mock('@/lib/api', () => ({
    api: { post: (...a: unknown[]) => mockApiPost(...a) },
    subscriptionApi: { changePlan: vi.fn(), billingPortal: vi.fn() },
}));

vi.mock('@/utils/geoCheck', () => ({ isUserSanctioned: () => Promise.resolve(false) }));

const nativeState = { native: true };
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => nativeState.native }));

const mockOpenExternalUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: (...a: unknown[]) => mockOpenExternalUrl(...a) }));
vi.mock('@/lib/webUrl', () => ({
  buildWebUrl: (p: string) => `https://jawab24.com${p}`,
  buildWebAuthedUrl: (p: string) => `https://jawab24.com/login?redirect=${encodeURIComponent(p)}`,
}));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

import { useSelectPlan } from './useSelectPlan';

const PLAN = { id: 'plan_biz', price: 3900, slug: 'business' } as unknown as Plan;

const render = (usage: UsageSummary | null = null) =>
    renderHook(() => useSelectPlan({ plans: [PLAN], usage, billingInterval: 'month' }));

beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    gateState.blocked = false;
    nativeState.native = true;
});

describe('useSelectPlan — native app', () => {
    it('opens Stripe-HOSTED checkout directly, never our embedded page', async () => {
        mockApiPost.mockResolvedValue({ data: { sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' } });
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockApiPost).toHaveBeenCalledWith('/payment/create-checkout-session', {
            planId: 'plan_biz',
            billingInterval: 'month',
            uiMode: 'hosted',
        });
        expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1');
        // The old flow — login-then-embedded-checkout in the default browser —
        // must be gone: it is the path Brave silently killed.
        expect(mockOpenExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('/checkout?planId='));
    });

    it('falls back to the web login flow when the app is not authenticated', async () => {
        authState.isAuthenticated = false;
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).toHaveBeenCalledWith(expect.stringContaining('/login?redirect='));
    });

    // The web checkout page's withOwnerOnly HOC used to enforce this for app
    // users; the app no longer passes through that page, so the hook must.
    it('blocks workspace members before any session is created', async () => {
        gateState.blocked = true;
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalled();
    });

    it('routes to complete-profile on EMAIL_REQUIRED instead of dying silently', async () => {
        mockApiPost.mockRejectedValue({ response: { data: { code: 'EMAIL_REQUIRED' } } });
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/complete-profile'));
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    it('shows the region message on a sanctions block', async () => {
        mockApiPost.mockRejectedValue({ response: { data: { code: 'SANCTIONED_GEO_BLOCK' } } });
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockToastError).toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    it('surfaces an error toast on any other failure — never a silent dead end', async () => {
        mockApiPost.mockRejectedValue(new Error('network down'));
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockToastError).toHaveBeenCalled();
        expect(result.current.changingPlan).toBeNull(); // spinner released
    });
});

describe('useSelectPlan — native app, free plan', () => {
    // A $0 plan has no stripePriceId; a hosted session for it would 400 and
    // toast a misleading error. It must take the shared free-plan path, which
    // works in-app.
    it('never creates a checkout session for a free plan', async () => {
        const FREE = { id: 'plan_free', price: 0, slug: 'free' } as unknown as Plan;
        const { result } = renderHook(() => useSelectPlan({ plans: [FREE], usage: null, billingInterval: 'month' }));

        await act(() => result.current.handleSelectPlan('plan_free'));

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
});

describe('useSelectPlan — web unchanged', () => {
    it('still routes to the embedded checkout page in an ordinary browser', async () => {
        nativeState.native = false;
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/checkout?planId=plan_biz'));
        expect(mockApiPost).not.toHaveBeenCalled();
    });
});

describe('useSelectPlan — Shopify-billed workspace (D-G)', () => {
    // Shopify forbids off-platform billing for App Store installs: every plan
    // click must route to the Shopify admin deep link, never into any Stripe
    // path (hosted checkout, /checkout, in-place changePlan).
    const shopifyUsage = (over: Record<string, unknown> = {}) => ({
        subscription: {
            plan: { slug: 'business' },
            status: 'active',
            paymentMethod: 'shopify',
            shopifyManageUrl: 'https://admin.shopify.com/store/test/charges/jawab24/pricing_plans',
            ...over,
        },
    } as unknown as UsageSummary);

    it('routes plan clicks to the Shopify admin deep link — no Stripe path runs', async () => {
        nativeState.native = false;
        const { result } = render(shopifyUsage());

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://admin.shopify.com/store/test/charges/jawab24/pricing_plans');
        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('guards the NATIVE hosted-checkout path too', async () => {
        nativeState.native = true;
        const { result } = render(shopifyUsage());

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://admin.shopify.com/store/test/charges/jawab24/pricing_plans');
    });

    it('falls back to an informational toast when no manage URL is configured', async () => {
        nativeState.native = false;
        const { result } = render(shopifyUsage({ shopifyManageUrl: undefined }));

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockToastInfo).toHaveBeenCalled();
        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('does NOT guard when paymentMethod is absent — normal Stripe flow proceeds', async () => {
        nativeState.native = false;
        const { result } = render({
            subscription: { plan: { slug: 'starter' }, status: 'trialing' },
        } as unknown as UsageSummary);

        await act(() => result.current.handleSelectPlan('plan_biz'));

        // trial (no Stripe customer) → routed to /checkout
        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan_biz&interval=month');
    });
});
