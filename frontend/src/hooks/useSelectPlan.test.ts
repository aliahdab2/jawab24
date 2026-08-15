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

/**
 * The yearly guard (2026-08-15). A "year" page toggle must never produce a
 * yearly billing request for a plan without a yearly Stripe price — the
 * backend would 400 (YEARLY_NOT_AVAILABLE); before the guard it silently
 * billed the MONTHLY price under the UI's "save ~17%" promise.
 */
describe('useSelectPlan — yearly interval coercion', () => {
    const YEARLY_PLAN = { id: 'plan_biz', price: 3900, slug: 'business', yearlyAvailable: true } as unknown as Plan;
    const MONTHLY_ONLY_PLAN = { id: 'plan_scale', price: 14900, slug: 'scale-20k', yearlyAvailable: false } as unknown as Plan;

    const renderYear = (plans: Plan[]) =>
        renderHook(() => useSelectPlan({ plans, usage: null, billingInterval: 'year' }));

    it('web: passes interval=year to checkout for a plan WITH a yearly price', async () => {
        nativeState.native = false;
        const { result } = renderYear([YEARLY_PLAN]);

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan_biz&interval=year');
    });

    it('web: coerces to interval=month for a plan WITHOUT a yearly price', async () => {
        nativeState.native = false;
        const { result } = renderYear([MONTHLY_ONLY_PLAN]);

        await act(() => result.current.handleSelectPlan('plan_scale'));

        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan_scale&interval=month');
    });

    it('native hosted checkout: sends billingInterval year only when the plan has a yearly price', async () => {
        nativeState.native = true;
        mockApiPost.mockResolvedValue({ data: { sessionId: 'cs_y', url: 'https://checkout.stripe.com/c/pay/cs_y' } });
        const { result } = renderYear([YEARLY_PLAN, MONTHLY_ONLY_PLAN]);

        await act(() => result.current.handleSelectPlan('plan_biz'));
        expect(mockApiPost).toHaveBeenCalledWith('/payment/create-checkout-session',
            expect.objectContaining({ billingInterval: 'year' }));

        mockApiPost.mockClear();
        await act(() => result.current.handleSelectPlan('plan_scale'));
        expect(mockApiPost).toHaveBeenCalledWith('/payment/create-checkout-session',
            expect.objectContaining({ billingInterval: 'month' }));
    });

    it('in-place plan change: coerces the interval per target plan', async () => {
        nativeState.native = false;
        const { subscriptionApi } = await import('@/lib/api');
        vi.mocked(subscriptionApi.changePlan).mockResolvedValue({} as never);
        const stripeUsage = {
            subscription: { plan: { slug: 'starter' }, status: 'active', hasStripeCustomer: true },
        } as unknown as UsageSummary;

        const { result } = renderHook(() =>
            useSelectPlan({ plans: [YEARLY_PLAN, MONTHLY_ONLY_PLAN], usage: stripeUsage, billingInterval: 'year' }));

        await act(() => result.current.handleSelectPlan('plan_biz'));
        expect(subscriptionApi.changePlan).toHaveBeenCalledWith('plan_biz', 'year');

        await act(() => result.current.handleSelectPlan('plan_scale'));
        expect(subscriptionApi.changePlan).toHaveBeenCalledWith('plan_scale', 'month');
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
            marketplaceBilling: {
                marketplace: 'shopify',
                manageUrl: 'https://admin.shopify.com/store/test/charges/jawab24/pricing_plans',
            },
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
        const { result } = render(shopifyUsage({
            shopifyManageUrl: undefined,
            marketplaceBilling: { marketplace: 'shopify' },
        }));

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

describe('useSelectPlan — Salla merchant (apps-policy Article 5)', () => {
    // Salla mandates that paid apps bill through Salla. We ship free-tier-only
    // there, so unlike Shopify there is nowhere to route a plan click: it must
    // stop at an informational toast and never touch a Stripe path.
    const sallaUsage = (over: Record<string, unknown> = {}) => ({
        subscription: {
            plan: { slug: 'free' },
            status: 'trialing',
            // The legacy `sallaBilled` boolean is deliberately NOT set here: the
            // hook no longer reads it (D-073), and leaving it in would suggest it
            // still drives this fixture. It stays on the wire only for older
            // bundled app builds — see its doc comment in packages/shared.
            //
            // Salla has no self-serve destination, so the verdict deliberately
            // carries no manageUrl — absent means "suppress, show no link".
            marketplaceBilling: { marketplace: 'salla' },
            ...over,
        },
    } as unknown as UsageSummary);

    it('stops plan clicks with a toast — no Stripe path runs', async () => {
        nativeState.native = false;
        const { result } = render(sallaUsage());

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockToastInfo).toHaveBeenCalled();
        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    it('guards the NATIVE hosted-checkout path too', async () => {
        nativeState.native = true;
        const { result } = render(sallaUsage());

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    // The exemption is resolved server-side (resolveMarketplaceBilling, D-073):
    // a merchant already paying through Stripe simply arrives with NO
    // marketplaceBilling verdict at all, and must keep the normal flow.
    it('does NOT guard when no marketplace verdict is present — normal Stripe flow proceeds', async () => {
        nativeState.native = false;
        const { result } = render({
            subscription: { plan: { slug: 'starter' }, status: 'trialing' },
        } as unknown as UsageSummary);

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockToastInfo).not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan_biz&interval=month');
    });

    // Both rails can apply to one account (a merchant with both stores). The
    // backend resolves the precedence at its one choke point and hands us a
    // single verdict — Shopify's, because it has somewhere to send them.
    it('prefers the Shopify deep link when both rails apply', async () => {
        nativeState.native = false;
        const { result } = render(sallaUsage({
            paymentMethod: 'shopify',
            shopifyManageUrl: 'https://admin.shopify.com/store/test/charges/jawab24/pricing_plans',
            marketplaceBilling: {
                marketplace: 'shopify',
                manageUrl: 'https://admin.shopify.com/store/test/charges/jawab24/pricing_plans',
            },
        }));

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://admin.shopify.com/store/test/charges/jawab24/pricing_plans');
        expect(mockToastInfo).not.toHaveBeenCalled();
    });
});

/**
 * The reason this change exists. Before it, the hook knew only
 * `paymentMethod === 'shopify'` and `sallaBilled`, so a Zid merchant fell
 * straight through both guards into the Stripe path and met a generic error
 * toast from the backend's 400 `ZID_BILLED` — no explanation, no destination.
 */
describe('useSelectPlan — Zid merchant (App Market, D-070/D-073)', () => {
    const zidUsage = (over: Record<string, unknown> = {}) => ({
        subscription: {
            plan: { slug: 'business' },
            status: 'active',
            paymentMethod: 'zid',
            // ZID_APP_MARKET_URL ships unset — the URL shape is undocumented and
            // a guessed link would send payers to a 404. Absent must still
            // suppress Stripe.
            marketplaceBilling: { marketplace: 'zid' },
            ...over,
        },
    } as unknown as UsageSummary);

    it('stops plan clicks with a toast instead of a generic error — no Stripe path runs', async () => {
        nativeState.native = false;
        const { result } = render(zidUsage());

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockToastInfo).toHaveBeenCalled();
        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    it('guards the NATIVE hosted-checkout path too', async () => {
        nativeState.native = true;
        const { result } = render(zidUsage());

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    /** Once the App Market URL is observed and configured, send them there. */
    it('routes to the App Market when a manage URL IS configured', async () => {
        nativeState.native = false;
        const { result } = render(zidUsage({
            marketplaceBilling: { marketplace: 'zid', manageUrl: 'https://zid.market/apps/jawab24' },
        }));

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://zid.market/apps/jawab24');
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    /** A canceled mirror is not marketplace-billed — the merchant uninstalled
     *  and must be free to come back through Stripe. The backend omits the
     *  field entirely in that case. */
    it('does NOT guard once the mirror is canceled — the Stripe rail reopens', async () => {
        nativeState.native = false;
        const { result } = render({
            subscription: { plan: { slug: 'starter' }, status: 'trialing', paymentMethod: 'zid' },
        } as unknown as UsageSummary);

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockToastInfo).not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan_biz&interval=month');
    });
});
