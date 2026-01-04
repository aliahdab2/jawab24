import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '@/lib/store';

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
        expect(localStorage.getItem('token')).toBe(mockToken);
    });

    it('should reject auth data with empty token', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        useAuthStore.getState().setAuth(mockUser, '', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.token).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
            'Invalid auth data provided to setAuth:',
            expect.objectContaining({ hasToken: false })
        );

        consoleSpy.mockRestore();
    });

    it('should reject auth data with whitespace-only token', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        useAuthStore.getState().setAuth(mockUser, '   ', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    it('should reject auth data with missing user ID', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const mockUser = { id: '', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' } as any;

        useAuthStore.getState().setAuth(mockUser, 'valid-token', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
            'Invalid auth data provided to setAuth:',
            expect.objectContaining({ hasUserId: false })
        );

        consoleSpy.mockRestore();
    });

    it('should reject null user', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        useAuthStore.getState().setAuth(null as any, 'valid-token', 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
            'Invalid auth data provided to setAuth:',
            expect.objectContaining({ hasUser: false, hasUserId: false })
        );

        consoleSpy.mockRestore();
    });

    it('should reject undefined token', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        useAuthStore.getState().setAuth(mockUser, undefined as any, 'fb-token');

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    it('should not modify localStorage when validation fails', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const mockUser = { id: 'user123', name: 'Test User', email: 'test@example.com', facebookId: 'fb123' };

        // Set initial valid token
        localStorage.setItem('token', 'existing-token');

        // Try to set invalid auth
        useAuthStore.getState().setAuth(mockUser, '', 'fb-token');

        // Token should remain unchanged
        expect(localStorage.getItem('token')).toBe('existing-token');

        consoleSpy.mockRestore();
    });
});
