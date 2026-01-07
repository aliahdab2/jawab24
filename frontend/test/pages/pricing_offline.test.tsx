
import { render, screen, waitFor } from '@testing-library/react';
import PricingPage from '@/pages/pricing';
import { plansApi, subscriptionApi } from '@/lib/api';
import { isUserSanctionedNonBlocking, isUserSanctioned } from '@/utils/geoCheck';
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

        // Expect loading state first
        expect(screen.getByRole('status')).toBeInTheDocument();

        // With API failure, it should switch to fallback plans
        await waitFor(() => {
            expect(screen.getByText(/Starter/i)).toBeInTheDocument();
        });

        // Verify fallback banner is present
        await waitFor(() => {
            expect(screen.getByText(/pricing.offlineTitle/i)).toBeInTheDocument();
        });
    });
});
