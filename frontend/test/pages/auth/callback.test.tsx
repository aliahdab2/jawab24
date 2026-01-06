import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    useUIStore: vi.fn(() => ({
        language: 'ar',
        setLanguage: vi.fn(),
    })),
}));

// Mock translations
vi.mock('@/i18n', () => ({
    useTranslation: () => ({
        t: (key: string) => key, // Return the key itself as translation
        language: 'ar',
    }),
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

    it('should handle missing code parameter', () => {
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: {},
            isReady: true,
            push: mockPush,
        });

        render(<AuthCallback />);

        // Should show loading spinner
        expect(screen.getByText('auth.loggingIn')).toBeInTheDocument();

        // Should not make API call
        expect(fetchMock).not.toHaveBeenCalled();
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

    it('should not make API call when router is not ready', () => {
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { code: 'auth-code-123' },
            isReady: false, // Not ready
            push: mockPush,
        });

        render(<AuthCallback />);

        // Should not call fetch when router isn't ready
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
