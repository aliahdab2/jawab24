import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRouter } from 'next/router';
import LoginPage from '@/pages/login';

// Mock Next.js router
vi.mock('next/router', () => ({
    useRouter: vi.fn(),
}));

// Mock version hook
vi.mock('@/lib/useVersion', () => ({
    useVersion: () => ({
        displayVersion: '1.0.0',
    }),
}));

describe('LoginPage - Locale Redirects', () => {
    let mockPush: ReturnType<typeof vi.fn>;
    let originalLocation: Location;
    let alertSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules(); // Reset modules to allow fresh mocks

        mockPush = vi.fn();
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: {},
            push: mockPush,
        });

        // Mock window.location
        originalLocation = window.location;
        delete (window as any).location;
        window.location = { ...originalLocation, href: '', origin: 'http://localhost:3000' } as any;

        // Mock alert
        alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { }) as any;

        process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';
    });

    afterEach(() => {
        window.location = originalLocation as any;
        alertSpy.mockRestore();
        vi.clearAllMocks();
    });

    it('should generate redirect URI without prefix for default locale (ar)', async () => {
        // Mock i18n for Arabic
        vi.doMock('@/i18n', () => ({
            useTranslation: () => ({
                t: (key: string) => key,
                language: 'ar',
                setLanguage: vi.fn(),
            }),
        }));

        // Re-import component to use new mock
        const { default: Login } = await import('@/pages/login');
        render(<Login />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        // Should NOT have /ar/ prefix
        expect(window.location.href).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback');
    });

    it('should generate redirect URI with prefix for non-default locale (en)', async () => {
        // Mock i18n for English
        vi.doMock('@/i18n', () => ({
            useTranslation: () => ({
                t: (key: string) => key,
                language: 'en',
                setLanguage: vi.fn(),
            }),
        }));

        // Re-import component to use new mock
        const { default: Login } = await import('@/pages/login');
        render(<Login />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        // Should HAVE /en/ prefix
        expect(window.location.href).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fen%2Fauth%2Fcallback');
    });
});
