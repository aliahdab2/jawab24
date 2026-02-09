
import { render, screen, waitFor } from '@testing-library/react';
import PricingPage from '@/pages/pricing';
import { plansApi } from '@/lib/api';
import { isUserSanctionedNonBlocking } from '@/utils/geoCheck';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/api', () => ({
    plansApi: {
        getAll: vi.fn(),
    },
    subscriptionApi: {
        getUsage: vi.fn(),
    },
}));

vi.mock('@/utils/geoCheck', () => ({
    isUserSanctionedNonBlocking: vi.fn(),
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

vi.mock('@/i18n', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

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

    it('should display fallback plans when geo check and API both fail/timeout', async () => {
        // Simulating geo check failing/timeout (returning logic from catch)
        (isUserSanctionedNonBlocking as any).mockResolvedValue({
            sanctioned: false,
            cached: false,
            timedOut: true
        });

        // Simulating API failure (offline)
        (plansApi.getAll as any).mockRejectedValue(new Error('Network Error'));

        render(<PricingPage />);

        // Wait for loading to complete and fallback plans to render
        await waitFor(() => {
            expect(screen.getByText(/Starter/i)).toBeInTheDocument();
        }, { timeout: 3000 });

        // Verify fallback banner is present
        await waitFor(() => {
            // expect the HARDCODED fallback text because mocks return key==value
            expect(screen.getByText(/Displaying Cached Pricing/i)).toBeInTheDocument();
        });
    });
});
