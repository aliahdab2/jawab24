import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plan } from '@jawab24/shared';

// --- Router ---------------------------------------------------------------
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/router', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, asPath: '/pricing/scale', locale: 'en' }),
}));

// next/head renders nothing in the test DOM.
vi.mock('next/head', () => ({ __esModule: true, default: () => null }));

// --- API ------------------------------------------------------------------
const mockChangePlan = vi.fn().mockResolvedValue({ data: {} });
const mockGetUsage = vi.fn();
vi.mock('@/lib/api', () => ({
    subscriptionApi: {
        getUsage: (...a: unknown[]) => mockGetUsage(...a),
        changePlan: (...a: unknown[]) => mockChangePlan(...a),
    },
}));
vi.mock('@/lib/api-utils', () => ({ extractObjectData: (d: unknown) => d }));

// --- Auth / ownership -----------------------------------------------------
const authState = { isAuthenticated: true };
vi.mock('@/lib/store', () => ({ useAuthStore: () => ({ isAuthenticated: authState.isAuthenticated }) }));
vi.mock('@/hooks', () => ({ useOwnerGate: () => false }));

// --- Sanctions / platform -------------------------------------------------
const geo = { sanctioned: false };
vi.mock('@/utils/geoCheck', () => ({
    isUserSanctioned: () => Promise.resolve(geo.sanctioned),
    isUserSanctionedNonBlocking: () => Promise.resolve({ sanctioned: geo.sanctioned, cached: false, timedOut: false }),
}));
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false, isIOSNative: () => false }));
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/webUrl', () => ({ buildWebUrl: (p: string) => p }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

// Render the page body directly (getLayout is applied at the _app level).
vi.mock('@/components/layout/DashboardLayout', () => ({
    DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ScalePage from '@/pages/pricing/scale';

function makeScalePlan(overrides: Partial<Plan> = {}): Plan {
    return {
        id: 'plan-scale-30k',
        name: 'Scale 30K',
        slug: 'scale-30k',
        description: 'High volume',
        price: 19900,
        yearlyPrice: null,
        currency: 'USD',
        interval: 'month',
        maxPages: 5,
        maxAiRepliesPerMonth: 30000,
        maxProducts: null,
        facebookEnabled: true,
        instagramEnabled: true,
        ecommerceEnabled: true,
        whatsappEnabled: false,
        showBranding: false,
        prioritySupport: true,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isPublic: false,
        isDefault: false,
        sortOrder: 5,
        ...overrides,
    };
}

const proUsage = {
    subscription: { plan: { slug: 'pro', price: 7900 }, hasStripeCustomer: true, status: 'active' },
};

describe('ScalePage (/pricing/scale)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authState.isAuthenticated = true;
        geo.sanctioned = false;
        mockChangePlan.mockResolvedValue({ data: {} });
        mockGetUsage.mockResolvedValue({ data: proUsage });
    });

    it('upgrades an existing Pro subscriber in place via changePlan (never a second checkout)', async () => {
        render(<ScalePage plans={[makeScalePlan()]} />);

        // Wait for usage to load — the CTA flips from "Subscribe" to "Upgrade".
        const btn = await screen.findByRole('button', { name: /upgrade/i });
        fireEvent.click(btn);

        await waitFor(() => expect(mockChangePlan).toHaveBeenCalledWith('plan-scale-30k', 'month'));
        // In-place upgrade refreshes via replace(), and must NOT route to checkout.
        expect(mockReplace).toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('routes an unauthenticated visitor to login→checkout, not changePlan', async () => {
        authState.isAuthenticated = false;
        render(<ScalePage plans={[makeScalePlan()]} />);

        const btn = await screen.findByRole('button', { name: /subscribe/i });
        fireEvent.click(btn);

        await waitFor(() => expect(mockPush).toHaveBeenCalled());
        const target = mockPush.mock.calls[0][0] as string;
        expect(target).toContain('/login');
        expect(target).toContain('checkout');
        expect(mockChangePlan).not.toHaveBeenCalled();
    });

    it('hides the payment CTA and shows a WhatsApp fallback for sanctioned regions', async () => {
        geo.sanctioned = true;
        render(<ScalePage plans={[makeScalePlan()]} />);

        // Once the geo check resolves, no purchase button is rendered…
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /upgrade|subscribe|downgrade/i })).not.toBeInTheDocument();
        });
        // …and a WhatsApp support link is offered instead.
        const links = screen.getAllByRole('link');
        expect(links.some((l) => l.getAttribute('href')?.includes('wa.me'))).toBe(true);
        expect(mockChangePlan).not.toHaveBeenCalled();
        // The one-time top-up CTA is also withheld from sanctioned regions.
        expect(screen.queryByRole('button', { name: /add replies/i })).not.toBeInTheDocument();
    });

    it('offers a secondary one-time top-up CTA to a signed-in subscriber', async () => {
        render(<ScalePage plans={[makeScalePlan()]} />);
        // Surfaces once usage confirms an active (non-free) subscription.
        expect(await screen.findByRole('button', { name: /add replies/i })).toBeInTheDocument();
    });
});
