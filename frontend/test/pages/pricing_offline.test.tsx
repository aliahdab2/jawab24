
import { render, screen, waitFor } from '@testing-library/react';
import PricingPage from '@/pages/pricing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FALLBACK_PLANS } from '@/data/fallbackPlans';

// Mock dependencies
vi.mock('@/lib/api', () => ({
    subscriptionApi: {
        getUsage: vi.fn(),
    },
}));

vi.mock('@/utils/geoCheck', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/geoCheck')>()),
    isUserSanctionedNonBlocking: vi.fn().mockResolvedValue({ sanctioned: false, cached: false, timedOut: true }),
    isUserSanctioned: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
    useAuthStore: vi.fn(() => ({
        isAuthenticated: false,
        _hasHydrated: true,
    })),
    useUIStore: vi.fn(() => ({
        sidebarOpen: false,
        setSidebarOpen: vi.fn(),
        mobileMenuOpen: false,
        setMobileMenuOpen: vi.fn(),
    })),
}));

// next-intl is mocked globally in test/setup.ts — no local @/i18n mock needed

vi.mock('next/router', () => ({
    useRouter: () => ({
        push: vi.fn(),
        query: {},
    }),
}));

describe('PricingPage Offline Mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render fallback plans passed via getStaticProps', async () => {
        // With ISR, getStaticProps passes fallback plans when API is unreachable.
        // The component renders whatever plans it receives as props.
        render(<PricingPage plans={FALLBACK_PLANS} />);

        // Wait for async effects (geo check, usage fetch) to settle
        await waitFor(() => {
            expect(screen.getAllByText(/Starter/i).length).toBeGreaterThan(0);
        });
    });
});
