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

describe('PricingPage Navigation Logic', () => {
    const mockPush = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useRouter as any).mockReturnValue({
            push: mockPush,
            route: '/pricing',
            query: {},
        });
    });

    it('redirects to LOGIN when NOT authenticated', async () => {
        // Setup: Not authenticated
        useAuthStore.setState({ isAuthenticated: false });

        render(<PricingPage />);

        // Wait for plans to load. 
        // Since price is 1000, logic renders 'pricing.upgrade'
        const upgradeButton = await screen.findByText('pricing.upgrade');

        // Action: Click upgrade
        fireEvent.click(upgradeButton);

        // Verify: Redirects to Login with correct return URL
        expect(mockPush).toHaveBeenCalledWith(
            expect.stringContaining('/login?redirect=')
        );
        expect(mockPush).toHaveBeenCalledWith(
            expect.stringContaining(encodeURIComponent('/checkout?planId=plan-1'))
        );
    });

    it('redirects to CHECKOUT when authenticated', async () => {
        // Setup: Authenticated
        useAuthStore.setState({ isAuthenticated: true });

        render(<PricingPage />);

        // Wait for plans to load and find button
        const upgradeButton = await screen.findByText('pricing.upgrade');

        // Action: Click upgrade
        fireEvent.click(upgradeButton);

        // Verify: Redirects directly to Checkout
        expect(mockPush).toHaveBeenCalledWith('/checkout?planId=plan-1');
    });
});
