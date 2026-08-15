import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PricingPage from '@/pages/pricing';
import { useAuthStore } from '@/lib/store';
import { useRouter } from 'next/router';

// Mocks
vi.mock('next/router', () => ({
    useRouter: vi.fn(),
}));

// Mock the API calls
const mockBillingPortal = vi.fn().mockResolvedValue({ data: { url: 'https://billing.stripe.com/session/test' } });
vi.mock('@/lib/api', () => ({
    subscriptionApi: {
        getUsage: vi.fn().mockResolvedValue({
            data: {
                subscription: {
                    plan: { id: 'plan-free', slug: 'free', name: 'Free' },
                    trialDaysRemaining: 0
                },
                aiReplies: { used: 0, limit: 10 }
            }
        }),
        billingPortal: (...args: unknown[]) => mockBillingPortal(...args),
    },
}));

const TEST_PLANS = [
    {
        id: 'plan-1',
        slug: 'starter',
        name: 'Starter',
        price: 1000,
        isActive: true,
        trialDays: 0,
        maxAiRepliesPerMonth: 100,
        maxPages: 1,
        maxTemplates: 5,
        maxRules: 5,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: false,
        prioritySupport: false,
        currency: 'USD',
        interval: 'month' as const,
        regionalPricing: {},
        isDefault: true,
        sortOrder: 0,
    },
];

// Mock API Utils
vi.mock('@/lib/api-utils', () => ({
    extractArrayData: (data: any) => data,
    extractObjectData: (data: any) => data,
}));

// next-intl is mocked globally in test/setup.ts — real English translations are used

// Mock geo check to allow payments (not sanctioned)
vi.mock('@/utils/geoCheck', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/geoCheck')>()),
    isUserSanctioned: vi.fn().mockResolvedValue(false),
    isUserSanctionedNonBlocking: vi.fn().mockResolvedValue({
        sanctioned: false,
        cached: false,
        timedOut: false,
    }),
}));

// Mock fallback plans
vi.mock('@/data/fallbackPlans', () => ({
    FALLBACK_PLANS: [],
}));

describe('PricingPage Navigation Logic', () => {
    const mockPush = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useRouter as any).mockReturnValue({
            push: mockPush,
            route: '/pricing',
            pathname: '/pricing',
            query: {},
            asPath: '/pricing',
        });
    });

    it('redirects to LOGIN when NOT authenticated', async () => {
        // Setup: Not authenticated
        useAuthStore.setState({
            isAuthenticated: false,
            _hasHydrated: true
        });

        render(<PricingPage plans={TEST_PLANS} />);

        // Plans are passed as props (SSR via getStaticProps), so they render immediately
        expect(screen.getAllByText('Starter').length).toBeGreaterThan(0);

        const subscribeButton = screen.getByText('Subscribe');
        expect(subscribeButton).toBeInTheDocument();

        // Action: Click subscribe
        fireEvent.click(subscribeButton);

        // Wait for navigation
        await waitFor(() => {
            expect(mockPush).toHaveBeenCalled();
        }, { timeout: 1000 });

        // Verify: Redirects to Login with correct return URL
        expect(mockPush).toHaveBeenCalledWith(
            expect.stringContaining('/login?redirect=')
        );
        expect(mockPush).toHaveBeenCalledWith(
            expect.stringContaining(encodeURIComponent('/checkout?planId=plan-1'))
        );
    });

    it('routes to checkout when subscriber has no Stripe customer', async () => {
        // Setup: Authenticated, subscription WITHOUT Stripe customer (trial/manual)
        useAuthStore.setState({
            isAuthenticated: true,
            _hasHydrated: true
        });

        render(<PricingPage plans={TEST_PLANS} />);

        expect(screen.getAllByText('Starter').length).toBeGreaterThan(0);

        const upgradeButton = await screen.findByText('Upgrade', {}, { timeout: 3000 });
        fireEvent.click(upgradeButton);

        // Verify: Routes to checkout (not billing portal) since no Stripe customer
        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith(
                expect.stringContaining('/checkout?planId=plan-1')
            );
        }, { timeout: 1000 });
        expect(mockBillingPortal).not.toHaveBeenCalled();
    });
});
