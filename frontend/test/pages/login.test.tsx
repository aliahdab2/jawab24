import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRouter } from 'next/router';
import LoginPage from '@/pages/login';
import { authApi } from '@/lib/api';
// We need to import the mocked module to verify calls (for Capacitor only)
import { FacebookLogin } from '@capacitor-community/facebook-login';

// Mock Next.js router
vi.mock('next/router', () => ({
    useRouter: vi.fn(() => ({
        query: {},
        push: vi.fn(),
        replace: vi.fn(),
        pathname: '/login',
    })),
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

// Mock Facebook Login Plugin (Global Mock for External Module)
vi.mock('@capacitor-community/facebook-login', () => ({
    FacebookLogin: {
        login: vi.fn()
    }
}));

// Mock Store
const mockSetAuth = vi.fn();
vi.mock('@/lib/store', () => ({
    useAuthStore: (selector: any) => {
        const store = { setAuth: mockSetAuth };
        return selector(store);
    }
}));

// Mock sonner
vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn()
    }
}));

// ... (existing mocks)

describe('LoginPage', () => {
    let mockPush: ReturnType<typeof vi.fn>;
    let originalLocation: Location;
    let toastErrorSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        mockPush = vi.fn();
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: {},
            push: mockPush,
            replace: vi.fn(),
            pathname: '/login',
            asPath: '/login',
            events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
        });
        // ...
        
        // Spy on toast
        const { toast } = await import('sonner');
        toastErrorSpy = vi.mocked(toast.error);
        toastErrorSpy.mockClear();

        // Mock window.location
        originalLocation = window.location;
        delete (window as any).location;
        window.location = { ...originalLocation, href: '', origin: 'http://localhost:3000' } as any;
        
        // Mock alert (just in case, though logically removed)
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        
        // Reset mocks
        vi.clearAllMocks();
        mockSetAuth.mockClear();
        
        // Default Capacitor mock (non-native)
        (window as any).Capacitor = {
            isNativePlatform: vi.fn().mockReturnValue(false)
        };
    });

    afterEach(() => {
        window.location = originalLocation as any;
        vi.restoreAllMocks(); // Important for spies on authApi
    });

    describe('Web Login', () => {
        it('should show error when FB_APP_ID is missing', () => {
            const originalEnv = process.env.NEXT_PUBLIC_FB_APP_ID;
            delete process.env.NEXT_PUBLIC_FB_APP_ID;
    
            render(<LoginPage />);
    
            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            fireEvent.click(loginButton);
    
            expect(toastErrorSpy).toHaveBeenCalledWith('auth.loginError');
            expect(window.location.href).toBe(''); // Should not redirect
    
            process.env.NEXT_PUBLIC_FB_APP_ID = originalEnv;
        });

        // ...

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
    
            expect(consoleSpy).toHaveBeenCalledWith('Facebook login error:', expect.any(Error));
            expect(toastErrorSpy).toHaveBeenCalledWith('Encoding error');
    
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

    describe('Native Mobile Login', () => {
        beforeEach(() => {
            // Mock Capacitor for Mobile
            (window as any).Capacitor = {
                isNativePlatform: vi.fn().mockReturnValue(true)
            };
        });

        it('should use native SDK when on mobile platform', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';
            
            // Setup API Spy
            const nativeLoginSpy = vi.spyOn(authApi, 'nativeFacebookLogin').mockResolvedValue({
                data: {
                    user: { id: 'user-1' },
                    token: 'session-token',
                    settings: {}
                }
            } as any);

            // Mock Facebook Login Plugin
            const mockLogin = vi.fn().mockResolvedValue({ accessToken: { token: 'native-fb-token' } });
            (FacebookLogin.login as any).mockImplementation(mockLogin);

            render(<LoginPage />);

            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            fireEvent.click(loginButton);

            // Verify Native Login called
            await import('@testing-library/react').then(({ waitFor }) => waitFor(() => {
                expect(mockLogin).toHaveBeenCalled();
                expect(nativeLoginSpy).toHaveBeenCalledWith('native-fb-token');
                expect(mockSetAuth).toHaveBeenCalledWith({ id: 'user-1' }, 'session-token', 'native-fb-token');
                expect(mockPush).toHaveBeenCalledWith('/dashboard');
            }));
        });
    });
});
