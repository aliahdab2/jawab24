import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Salla loads /salla/connected (the Easy-Mode "App URL") as a fresh full-page navigation,
// so the persisted auth store hasn't rehydrated on first paint. These tests pin the fix:
// the page must NOT decide auth (show "log in") until _hasHydrated flips true, otherwise a
// logged-in merchant flashes the needLogin screen on arrival. Regression for the hydration
// race found by the closed-loop browser QA on 2026-07-19.

const authState = { isAuthenticated: false, _hasHydrated: false };

vi.mock('@/lib/store', () => ({
    useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

// The global setup mocks next/router with no isReady; connected.tsx bails until isReady,
// so override with a ready router carrying an empty query (no merchant param).
vi.mock('next/router', () => ({
    useRouter: () => ({
        isReady: true,
        query: {},
        push: vi.fn(),
        replace: vi.fn(),
        prefetch: vi.fn(),
        pathname: '/salla/connected',
        locale: 'en',
    }),
}));

const getPendingInstalls = vi.fn();
vi.mock('@/lib/api', () => ({
    sallaApi: {
        getPendingInstalls: (...args: unknown[]) => getPendingInstalls(...args),
        claimInstall: vi.fn(),
    },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SallaConnected from './connected';

describe('SallaConnected — auth hydration gate', () => {
    beforeEach(() => {
        authState.isAuthenticated = false;
        authState._hasHydrated = false;
        getPendingInstalls.mockReset();
        window.sessionStorage.clear();
    });

    it('shows the checking spinner (NOT needLogin) while the store has not rehydrated', () => {
        // Cold load: not yet hydrated, isAuthenticated still false. Must not accuse the
        // merchant of being logged out.
        render(<SallaConnected />);
        expect(screen.getByText('Looking for your Salla store…')).toBeInTheDocument();
        expect(screen.queryByText('Log in to connect your store')).not.toBeInTheDocument();
    });

    it('shows needLogin only once hydrated and genuinely unauthenticated', () => {
        authState._hasHydrated = true;
        authState.isAuthenticated = false;
        render(<SallaConnected />);
        expect(screen.getByText('Log in to connect your store')).toBeInTheDocument();
    });

    it('does not check pending installs before hydration', () => {
        authState._hasHydrated = false;
        authState.isAuthenticated = true; // even if a stale true leaked in, the gate holds
        render(<SallaConnected />);
        expect(getPendingInstalls).not.toHaveBeenCalled();
    });

    it('once hydrated + authenticated with no merchant param, lands on the missing state', async () => {
        authState._hasHydrated = true;
        authState.isAuthenticated = true;
        render(<SallaConnected />);
        await waitFor(() =>
            expect(
                screen.getByText('Open this page from the Salla App Store after installing Jawab24.'),
            ).toBeInTheDocument(),
        );
        expect(getPendingInstalls).not.toHaveBeenCalled();
    });
});
