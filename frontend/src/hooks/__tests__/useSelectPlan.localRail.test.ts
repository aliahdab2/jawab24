/**
 * The local-rail branch of the plan-select flow (D-110).
 *
 * A blocked CARD is not a blocked customer: when the strict sanctions
 * re-check says "blocked" but the visitor resolved to a country with a local
 * rail (inside Syria → Sham Cash), a paid-plan click must go to /checkout —
 * whose sanctioned branch renders the offline panel and never mounts Stripe —
 * instead of the dead-end "not available in your region" toast. Everyone
 * else on the blocked path keeps the toast.
 *
 * `@/utils/geoCheck` is spread from the real module so the pure predicate
 * (`hasLocalPaymentAlternative`) stays real: only the two lookups are stubbed.
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
vi.mock('sonner', () => ({
    toast: { error: (...a: unknown[]) => mockToastError(...a), info: (...a: unknown[]) => mockToastInfo(...a), success: vi.fn() },
}));

const authState = { isAuthenticated: true };
vi.mock('@/lib/store', () => ({ useAuthStore: () => ({ isAuthenticated: authState.isAuthenticated }) }));
vi.mock('@/hooks/useOwnerGate', () => ({ useOwnerGate: () => false }));

const mockApiPost = vi.fn();
vi.mock('@/lib/api', () => ({
    api: { post: (...a: unknown[]) => mockApiPost(...a) },
    subscriptionApi: { changePlan: vi.fn(), billingPortal: vi.fn() },
}));

const geo = { sanctioned: true, country: undefined as string | undefined };
const mockIsUserSanctioned = vi.fn(() => Promise.resolve(geo.sanctioned));
vi.mock('@/utils/geoCheck', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/geoCheck')>()),
    isUserSanctioned: () => mockIsUserSanctioned(),
    getCachedGeoCountry: () => geo.country,
}));

vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false }));
const mockOpenExternalUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: (...a: unknown[]) => mockOpenExternalUrl(...a) }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

import { useSelectPlan } from '../useSelectPlan';

const PAID = { id: 'plan_biz', price: 3900, slug: 'business', yearlyAvailable: false } as unknown as Plan;
const FREE = { id: 'plan_free', price: 0, slug: 'free' } as unknown as Plan;

const render = (usage: UsageSummary | null = null, interval: 'month' | 'year' = 'month') =>
    renderHook(() => useSelectPlan({ plans: [PAID, FREE], usage, billingInterval: interval }));

beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    geo.sanctioned = true;
    geo.country = undefined;
});

describe('useSelectPlan — blocked visitor with a local rail', () => {
    it('sends a signed-in merchant in Syria to /checkout for a paid plan, with no toast', async () => {
        geo.country = 'SY';
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan_biz&interval=month');
        expect(mockToastError).not.toHaveBeenCalled();
        expect(mockApiPost).not.toHaveBeenCalled();
        expect(result.current.changingPlan).toBeNull();
    });

    it('routes a logged-out merchant in Syria through login, carrying the checkout path', async () => {
        geo.country = 'SY';
        authState.isAuthenticated = false;
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockPush).toHaveBeenCalledWith(
            `/login?redirect=${encodeURIComponent('/checkout?planId=plan_biz&interval=month')}`,
        );
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('keeps the toast for a FREE plan in Syria — there is nothing to transfer for', async () => {
        geo.country = 'SY';
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_free'));

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalledTimes(1);
    });

    it('keeps the toast for a blocked region with no rail', async () => {
        geo.country = 'IR';
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalledTimes(1);
    });

    it('keeps the toast when the country never resolved (fail-closed block)', async () => {
        geo.country = undefined;
        const { result } = render();

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalledTimes(1);
    });

    it('lets the marketplace-billing guard win before any geo check runs', async () => {
        // A Shopify/Salla/Zid-billed account manages its plan on the
        // marketplace; the rail must not offer a second way to pay.
        geo.country = 'SY';
        const usage = {
            subscription: {
                plan: { slug: 'business' },
                status: 'active',
                marketplaceBilling: { marketplace: 'shopify', manageUrl: 'https://admin.shopify.com/store/x/charges' },
            },
        } as unknown as UsageSummary;
        const { result } = render(usage);

        await act(() => result.current.handleSelectPlan('plan_biz'));

        expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://admin.shopify.com/store/x/charges');
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockIsUserSanctioned).not.toHaveBeenCalled();
    });
});
