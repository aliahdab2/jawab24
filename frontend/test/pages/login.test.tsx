import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRouter } from 'next/router';
import LoginPage from '@/pages/login';

// Mock Next.js router
vi.mock('next/router', () => ({
    useRouter: vi.fn(),
}));

// Mock translation hook
vi.mock('@/i18n', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        language: 'en',
        setLanguage: vi.fn(),
    }),
}));

// Mock version hook
vi.mock('@/lib/useVersion', () => ({
    useVersion: () => ({
        displayVersion: '1.0.0',
    }),
}));

describe('LoginPage - error handling', () => {
    let mockPush: ReturnType<typeof vi.fn>;
    let originalLocation: Location;
    let alertSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
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
        alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        window.location = originalLocation;
        alertSpy.mockRestore();
        vi.clearAllMocks();
    });

    it('should show error when FB_APP_ID is missing', () => {
        const originalEnv = process.env.NEXT_PUBLIC_FB_APP_ID;
        delete process.env.NEXT_PUBLIC_FB_APP_ID;

        render(<LoginPage />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        expect(alertSpy).toHaveBeenCalledWith('Login is not configured. Please contact support.');
        expect(window.location.href).toBe(''); // Should not redirect

        process.env.NEXT_PUBLIC_FB_APP_ID = originalEnv;
    });

    it('should construct OAuth URL correctly with all parameters', () => {
        process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

        render(<LoginPage />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        expect(window.location.href).toContain('https://www.facebook.com/v18.0/dialog/oauth');
        expect(window.location.href).toContain('client_id=test-app-id-123');
        expect(window.location.href).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback');
        expect(window.location.href).toContain('scope=');
        expect(window.location.href).toContain('response_type=code');
    });

    it('should preserve redirect parameter in state', () => {
        process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: { redirect: '/pricing' },
            push: mockPush,
        });

        render(<LoginPage />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        expect(window.location.href).toContain(`state=${encodeURIComponent('/pricing')}`);
    });

    it('should use dashboard as default redirect if no redirect param', () => {
        process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

        render(<LoginPage />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        expect(window.location.href).toContain(`state=${encodeURIComponent('/dashboard')}`);
    });

    it('should handle errors during OAuth URL construction', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

        // Mock encodeURIComponent to throw
        const originalEncode = global.encodeURIComponent;
        global.encodeURIComponent = vi.fn(() => {
            throw new Error('Encoding error');
        });

        render(<LoginPage />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        expect(consoleSpy).toHaveBeenCalledWith('Error initiating Facebook login:', expect.any(Error));
        expect(alertSpy).toHaveBeenCalledWith('Failed to start login. Please try again.');

        global.encodeURIComponent = originalEncode;
        consoleSpy.mockRestore();
    });

    it('should include required OAuth scopes', () => {
        process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

        render(<LoginPage />);

        const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
        fireEvent.click(loginButton);

        const href = window.location.href;
        const scopeMatch = href.match(/scope=([^&]+)/);
        expect(scopeMatch).toBeTruthy();

        const decodedScope = decodeURIComponent(scopeMatch![1]);
        expect(decodedScope).toContain('email');
        expect(decodedScope).toContain('pages_show_list');
        expect(decodedScope).toContain('pages_read_engagement');
        expect(decodedScope).toContain('pages_messaging');
    });
});
