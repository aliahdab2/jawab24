import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { useAuthStore, useUIStore } from '@/lib/store';

vi.mock('@sentry/nextjs', () => ({
    captureMessage: vi.fn(),
    captureException: vi.fn(),
    addBreadcrumb: vi.fn(),
}));

describe('useAuthStore - setAuth validation', () => {
    beforeEach(() => {
        // Clear store before each test
        useAuthStore.setState({ user: null, token: null, fbToken: null, isAuthenticated: false });
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('should store valid auth data correctly', () => {
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };
        const mockToken = 'valid-token-123';
        const mockFbToken = 'fb-token-456';

        useAuthStore.getState().setAuth(mockUser, mockToken, mockFbToken);

        const state = useAuthStore.getState();
        expect(state.user).toEqual(mockUser);
        expect(state.token).toBe(mockToken);
        expect(state.fbToken).toBe(mockFbToken);
        expect(state.isAuthenticated).toBe(true);
        // On Web, we do NOT store the token in localStorage anymore (HttpOnly cookies)
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('should reject auth data with empty token', () => {
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        useAuthStore.getState().setAuth(mockUser, '', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.token).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
            'Invalid auth data provided to setAuth',
            expect.objectContaining({ level: 'error', extra: expect.objectContaining({ hasToken: false }) })
        );
    });

    it('should reject auth data with whitespace-only token', () => {
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        useAuthStore.getState().setAuth(mockUser, '   ', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(Sentry.captureMessage).toHaveBeenCalled();
    });

    it('should reject auth data with missing user ID', () => {
        const mockUser = { id: '', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' } as any;

        useAuthStore.getState().setAuth(mockUser, 'valid-token', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
            'Invalid auth data provided to setAuth',
            expect.objectContaining({ level: 'error', extra: expect.objectContaining({ hasUserId: false }) })
        );
    });

    it('should reject null user', () => {
        useAuthStore.getState().setAuth(null as any, 'valid-token', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
            'Invalid auth data provided to setAuth',
            expect.objectContaining({ level: 'error', extra: expect.objectContaining({ hasUser: false, hasUserId: false }) })
        );
    });

    it('should reject undefined token', () => {
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        useAuthStore.getState().setAuth(mockUser, undefined as any, 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(Sentry.captureMessage).toHaveBeenCalled();
    });

    it('should not modify localStorage when validation fails', () => {
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        // Set initial valid token
        localStorage.setItem('token', 'existing-token');

        // Try to set invalid auth
        useAuthStore.getState().setAuth(mockUser, '', 'fb-token');

        // Token should remain unchanged
        expect(localStorage.getItem('token')).toBe('existing-token');
    });
});

describe('useAuthStore - state management', () => {
    beforeEach(() => {
        useAuthStore.setState({
            user: null,
            token: null,
            fbToken: null,
            isAuthenticated: false,
            _hasHydrated: false,
        });
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('should have correct initial state', () => {
        const state = useAuthStore.getState();

        expect(state.user).toBeNull();
        expect(state.token).toBeNull();
        expect(state.fbToken).toBeNull();
        expect(state.isAuthenticated).toBe(false);
    });

    it('should set isAuthenticated=true after valid setAuth', () => {
        const user = { id: 'u1', name: 'Test', facebookId: 'fb1' };

        useAuthStore.getState().setAuth(user, 'tok123', 'fbtok');

        expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('should clear state via setState (simulating logout)', () => {
        // First set auth
        const user = { id: 'u1', name: 'Test', facebookId: 'fb1' };
        useAuthStore.getState().setAuth(user, 'tok123', 'fbtok');
        expect(useAuthStore.getState().isAuthenticated).toBe(true);

        // Clear (what authManager.logout does)
        useAuthStore.setState({
            user: null,
            token: null,
            fbToken: null,
            isAuthenticated: false,
        });

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.token).toBeNull();
        expect(state.fbToken).toBeNull();
        expect(state.isAuthenticated).toBe(false);
    });

    it('should update user and token independently via setState', () => {
        const user = { id: 'u1', name: 'Test', facebookId: 'fb1' };
        useAuthStore.getState().setAuth(user, 'tok123', 'fbtok');

        // Update just the user name
        useAuthStore.setState({
            user: { ...user, name: 'Updated Name' },
        });

        expect(useAuthStore.getState().user?.name).toBe('Updated Name');
        expect(useAuthStore.getState().token).toBe('tok123');
    });

    it('should handle setHasHydrated', () => {
        expect(useAuthStore.getState()._hasHydrated).toBe(false);

        useAuthStore.getState().setHasHydrated(true);

        expect(useAuthStore.getState()._hasHydrated).toBe(true);
    });

    it('should store fbToken alongside regular token', () => {
        const user = { id: 'u1', name: 'Test', facebookId: 'fb1' };

        useAuthStore.getState().setAuth(user, 'backend-token', 'facebook-access-token');

        expect(useAuthStore.getState().token).toBe('backend-token');
        expect(useAuthStore.getState().fbToken).toBe('facebook-access-token');
    });

    it('should preserve other state when updating partial fields', () => {
        const user = { id: 'u1', name: 'Test', facebookId: 'fb1' };
        useAuthStore.getState().setAuth(user, 'tok', 'fb');
        useAuthStore.getState().setHasHydrated(true);

        // Verify all fields intact
        const state = useAuthStore.getState();
        expect(state.user?.id).toBe('u1');
        expect(state.isAuthenticated).toBe(true);
        expect(state._hasHydrated).toBe(true);
    });
});

describe('useUIStore', () => {
    beforeEach(() => {
        useUIStore.setState({
            sidebarOpen: true,
            language: 'ar',
            _hasHydrated: false,
            isOnboardingVisible: false,
        });
    });

    it('should have correct default language', () => {
        expect(useUIStore.getState().language).toBe('ar');
    });

    it('should toggle sidebar', () => {
        expect(useUIStore.getState().sidebarOpen).toBe(true);

        useUIStore.getState().toggleSidebar();
        expect(useUIStore.getState().sidebarOpen).toBe(false);

        useUIStore.getState().toggleSidebar();
        expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('should set sidebar explicitly', () => {
        useUIStore.getState().setSidebarOpen(false);
        expect(useUIStore.getState().sidebarOpen).toBe(false);

        useUIStore.getState().setSidebarOpen(true);
        expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('should set language', () => {
        useUIStore.getState().setLanguage('en');
        expect(useUIStore.getState().language).toBe('en');

        useUIStore.getState().setLanguage('ar');
        expect(useUIStore.getState().language).toBe('ar');
    });

    it('should set onboarding visibility', () => {
        useUIStore.getState().setOnboardingVisible(true);
        expect(useUIStore.getState().isOnboardingVisible).toBe(true);

        useUIStore.getState().setOnboardingVisible(false);
        expect(useUIStore.getState().isOnboardingVisible).toBe(false);
    });

    it('should handle setHasHydrated', () => {
        expect(useUIStore.getState()._hasHydrated).toBe(false);

        useUIStore.getState().setHasHydrated(true);
        expect(useUIStore.getState()._hasHydrated).toBe(true);
    });
});
