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
vi.mock('@/lib/api', () => ({
    plansApi: {
        getAll: vi.fn().mockResolvedValue({
            data: [
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
                    showBranding: true
                },
            ]
        }),
    },
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
    },
}));

// Mock API Utils
vi.mock('@/lib/api-utils', () => ({
    extractArrayData: (data: any) => data,
    extractObjectData: (data: any) => data,
}));

// Mock Translation
vi.mock('@/i18n', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        language: 'en',
    }),
}));

// Mock geo check to allow payments (not sanctioned)
vi.mock('@/utils/geoCheck', () => ({
    isUserSanctioned: vi.fn().mockResolvedValue(false),
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

        render(<PricingPage />);

        // Wait for geo check and plans to load
        await waitFor(() => {
            expect(screen.queryByText('pricing.subscribe')).toBeInTheDocument();
        });

        const upgradeButton = screen.getByText('pricing.subscribe');

        // Action: Click upgrade
        fireEvent.click(upgradeButton);

        // Verify: Redirects to Login with correct return URL
        expect(mockPush).toHaveBeenCalledWith(
            expect.stringContaining('/login?redirect=')
        );
        expect(mockPush).toHaveBeenCalledWith(
            expect.stringContaining(encodeURIComponent('/checkout?planId=plan-1'))
        );

        // Regression test: Ensure "Current Plan" badge is NOT shown
        const currentPlanBadge = screen.queryByText('pricing.currentPlan');
        expect(currentPlanBadge).toBeNull();
    });

    it('redirects to CHECKOUT when authenticated', async () => {
        // Setup: Authenticated
        useAuthStore.setState({
            isAuthenticated: true,
            _hasHydrated: true
        });

        render(<PricingPage />);

        // Wait for geo check and plans to load
        await waitFor(() => {
            expect(screen.queryByText('pricing.upgrade')).toBeInTheDocument();
        });

        const upgradeButton = screen.getByText('pricing.upgrade');

        // Action: Click upgrade
        fireEvent.click(upgradeButton);

        // Verify: Redirects directly to Checkout
        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan-1');
    });
});
