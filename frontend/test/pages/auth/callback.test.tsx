import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import AuthCallback from '@/pages/auth/callback';
import { useAuthStore } from '@/lib/store';

// Mock Next.js router
vi.mock('next/router', () => ({
    useRouter: vi.fn(),
}));

// Mock auth store
vi.mock('@/lib/store', () => ({
    useAuthStore: vi.fn(() => ({
        setAuth: vi.fn(),
    })),
}));

describe('AuthCallback - OAuth edge cases', () => {
    let mockPush: ReturnType<typeof vi.fn>;
    let mockSetAuth: ReturnType<typeof vi.fn>;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        mockPush = vi.fn();
        mockSetAuth = vi.fn();

        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: {},
            isReady: true,
            push: mockPush,
        });

        (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            setAuth: mockSetAuth,
        });

        // Mock global fetch
        fetchMock = vi.fn();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('should handle successful authentication', async () => {
        const mockUser = { id: '123', name: 'Test', email: 'test@test.com', facebookId: 'fb123' };
        const mockToken = 'valid-token';
        const mockFbToken = 'fb-token';

        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: true,
            push: mockPush,
        });

        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ user: mockUser, token: mockToken, fbAccessToken: mockFbToken }),
        });

        render(<AuthCallback />);

        await waitFor(() => {
            expect(mockSetAuth).toHaveBeenCalledWith(mockUser, mockToken, mockFbToken);
        });

        expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });

    it('should timeout after 15 seconds and show error', async () => {
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: true,
            push: mockPush,
        });

        // Mock fetch to never resolve
        fetchMock.mockImplementationOnce(() => new Promise(() => { }));

        render(<AuthCallback />);

        // Fast-forward 15 seconds
        vi.advanceTimersByTime(15000);

        await waitFor(() => {
            expect(screen.getByText(/Login request timed out/i)).toBeInTheDocument();
        });

        // Should redirect to login after 3 seconds
        vi.advanceTimersByTime(3000);
        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/login');
        });
    });

    it('should abort request on component unmount', async () => {
        const abortSpy = vi.fn();
        const mockAbortController = {
            signal: { aborted: false },
            abort: abortSpy,
        };

        global.AbortController = vi.fn(() => mockAbortController as any);

        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: true,
            push: mockPush,
        });

        fetchMock.mockImplementationOnce(() => new Promise(() => { }));

        const { unmount } = render(<AuthCallback />);

        // Unmount component
        unmount();

        // Abort should have been called
        expect(abortSpy).toHaveBeenCalled();
    });

    it('should handle Facebook error parameter', async () => {
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { error: 'access_denied' },
            isReady: true,
            push: mockPush,
        });

        render(<AuthCallback />);

        await waitFor(() => {
            expect(screen.getByText(/Facebook login was cancelled/i)).toBeInTheDocument();
        });

        vi.advanceTimersByTime(3000);
        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/login');
        });
    });

    it('should handle missing code parameter', () => {
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: {},
            isReady: true,
            push: mockPush,
        });

        render(<AuthCallback />);

        // Should show loading spinner
        expect(screen.getByText(/جاري تسجيل الدخول/i)).toBeInTheDocument();

        // Should not make API call
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should handle backend 4xx/5xx errors', async () => {
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: true,
            push: mockPush,
        });

        fetchMock.mockResolvedValueOnce({
            ok: false,
            json: async () => ({ message: 'Invalid authorization code' }),
        });

        render(<AuthCallback />);

        await waitFor(() => {
            expect(screen.getByText(/Invalid authorization code/i)).toBeInTheDocument();
        });

        vi.advanceTimersByTime(3000);
        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/login');
        });
    });

    it('should handle invalid auth data from backend', async () => {
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: true,
            push: mockPush,
        });

        // Backend returns user without ID (invalid)
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                user: { name: 'Test', email: 'test@test.com' }, // Missing 'id'
                token: 'token',
                fbAccessToken: 'fb-token'
            }),
        });

        render(<AuthCallback />);

        await waitFor(() => {
            // setAuth should be called, but it will reject the invalid data
            expect(mockSetAuth).toHaveBeenCalled();
        });
    });

    it('should redirect to complete-profile if user has no email', async () => {
        const mockUser = { id: '123', name: 'Test', facebookId: 'fb123' }; // No email
        const mockToken = 'valid-token';
        const mockFbToken = 'fb-token';

        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: true,
            push: mockPush,
        });

        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ user: mockUser, token: mockToken, fbAccessToken: mockFbToken }),
        });

        render(<AuthCallback />);

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/complete-profile?redirect=%2Fdashboard');
        });
    });

    it('should preserve state parameter for redirect', async () => {
        const mockUser = { id: '123', name: 'Test', email: 'test@test.com', facebookId: 'fb123' };
        const mockToken = 'valid-token';
        const mockFbToken = 'fb-token';

        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123', state: encodeURIComponent('/pricing') },
            isReady: true,
            push: mockPush,
        });

        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ user: mockUser, token: mockToken, fbAccessToken: mockFbToken }),
        });

        render(<AuthCallback />);

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/pricing');
        });
    });

    it('should not show error for aborted requests', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: true,
            push: mockPush,
        });

        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        fetchMock.mockRejectedValueOnce(abortError);

        render(<AuthCallback />);

        await waitFor(() => {
            // Should not redirect to login for abort errors
            expect(mockPush).not.toHaveBeenCalled();
        });

        consoleErrorSpy.mockRestore();
    });
});
