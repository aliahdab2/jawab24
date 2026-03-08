import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useRouter } from 'next/router';
import LoginPage from '@/pages/login';
import { authApi } from '@/lib/api';
// We need to import the mocked module to verify calls (for Capacitor only)
import { FacebookLogin } from '@capacitor-community/facebook-login';

// Mock Next.js Link (prevents ForwardRef(LinkComponent) act warnings)
vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

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

// Mock Capacitor Core
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false),
        getPlatform: vi.fn().mockReturnValue('web')
    }
}));

// Mock Facebook Login Plugin (Global Mock for External Module)
vi.mock('@capacitor-community/facebook-login', () => ({
    FacebookLogin: {
        initialize: vi.fn().mockResolvedValue(undefined),
        login: vi.fn(),
        logout: vi.fn().mockResolvedValue(undefined),
        getCurrentAccessToken: vi.fn().mockResolvedValue(null)
    }
}));

// Mock Capacitor Browser (used as web OAuth fallback on Android)
const mockBrowserOpen = vi.fn().mockResolvedValue(undefined);
vi.mock('@capacitor/browser', () => ({
    Browser: {
        open: (...args: unknown[]) => mockBrowserOpen(...args),
    }
}));

// Mock Store
const mockSetAuth = vi.fn();
const mockSetLanguage = vi.fn();
vi.mock('@/lib/store', () => ({
    useAuthStore: (selector: any) => {
        const store = { setAuth: mockSetAuth };
        return selector(store);
    },
    useUIStore: {
        getState: () => ({
            setLanguage: mockSetLanguage
        })
    }
}));

// Mock sonner
vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        info: vi.fn()
    }
}));

describe('LoginPage', () => {
    let mockPush: ReturnType<typeof vi.fn>;
    let originalLocation: Location;
    let toastErrorSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        mockPush = vi.fn().mockResolvedValue(true);
        (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
            query: {},
            push: mockPush,
            replace: vi.fn(),
            pathname: '/login',
            asPath: '/login',
            events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
        });

        // Spy on toast
        const { toast } = await import('sonner');
        toastErrorSpy = vi.mocked(toast.error);
        toastErrorSpy.mockClear();

        // Mock window.location
        originalLocation = window.location;
        delete (window as any).location;
        window.location = { ...originalLocation, href: '', origin: 'http://localhost:3000', hostname: 'localhost' } as any;

        // Reset mocks
        vi.clearAllMocks();
        mockSetAuth.mockClear();
        mockSetLanguage.mockClear();

        // Reset Capacitor mock to default (web)
        const { Capacitor } = await import('@capacitor/core');
        (Capacitor.isNativePlatform as any).mockReturnValue(false);
    });

    afterEach(() => {
        window.location = originalLocation as any;
        vi.restoreAllMocks(); // Important for spies on authApi
    });

    describe('Web Login', () => {
        it('should show error when FB_APP_ID is missing', async () => {
            const originalEnv = process.env.NEXT_PUBLIC_FB_APP_ID;
            delete process.env.NEXT_PUBLIC_FB_APP_ID;
    
            render(<LoginPage />);
    
            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            await act(async () => {
                loginButton.click();
            });
    
            expect(toastErrorSpy).toHaveBeenCalledWith('auth.loginError');
            expect(window.location.href).toBe(''); // Should not redirect
    
            process.env.NEXT_PUBLIC_FB_APP_ID = originalEnv;
        });

        // NOTE: Error handling for web construction removed because login.tsx now uses a direct redirect 
        // without a try-catch block for visual minimalism (as requested by user).
    
        it('should include required OAuth scopes', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';
    
            render(<LoginPage />);
    
            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            await act(async () => {
                loginButton.click();
            });
    
            const href = window.location.href;
            expect(href).toContain('scope=');
    
            const decodedScope = decodeURIComponent(href.match(/scope=([^&]+)/)![1]);
            expect(decodedScope).toContain('email');
            expect(decodedScope).toContain('pages_show_list');
            expect(decodedScope).toContain('pages_read_engagement');
            expect(decodedScope).toContain('pages_messaging');
        });
    });

    describe('Native Mobile Login', () => {
        beforeEach(async () => {
            // Mock Capacitor for Android Mobile
            const { Capacitor } = await import('@capacitor/core');
            (Capacitor.isNativePlatform as any).mockReturnValue(true);
            (Capacitor.getPlatform as any).mockReturnValue('android');

            // Setup Facebook Login mock BEFORE rendering (component pre-initializes SDK on mount)
            (FacebookLogin.login as any).mockResolvedValue({ accessToken: { token: 'native-fb-token' } });
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

            await act(async () => {
                render(<LoginPage />);
            });

            // Wait for pre-initialization to complete
            await vi.waitFor(() => {
                expect(FacebookLogin.initialize).toHaveBeenCalled();
            });

            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            await act(async () => {
                loginButton.click();
            });

            // Verify Native Login called
            await vi.waitFor(() => {
                expect(FacebookLogin.login).toHaveBeenCalled();
                expect(nativeLoginSpy).toHaveBeenCalledWith('native-fb-token');
                expect(mockSetAuth).toHaveBeenCalledWith({ id: 'user-1' }, 'session-token', 'native-fb-token');
                // Expect explicit language preservation
                expect(mockSetLanguage).toHaveBeenCalledWith('en');
                expect(mockPush).toHaveBeenCalledWith('/dashboard', '/dashboard', { locale: 'en' });
            });
            
            // Verify isProcessing logic (blank screen after success)
            expect(screen.queryByRole('button')).toBeNull();
        });

        it('should show info message when user cancels login (no token returned)', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

            // Mock SDK returning null (user cancelled)
            (FacebookLogin.login as any).mockResolvedValue({ accessToken: null });

            // Get toast.info mock
            const { toast } = await import('sonner');
            const toastInfoSpy = vi.mocked(toast.info);
            toastInfoSpy.mockClear();

            await act(async () => {
                render(<LoginPage />);
            });

            await vi.waitFor(() => {
                expect(FacebookLogin.initialize).toHaveBeenCalled();
            });

            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            await act(async () => {
                loginButton.click();
            });

            await vi.waitFor(() => {
                // User cancellation shows info, not error
                expect(toastInfoSpy).toHaveBeenCalledWith('auth.loginCancelled');
            });
            
            // Should NOT navigate
            expect(mockPush).not.toHaveBeenCalled();
            // Should NOT set auth
            expect(mockSetAuth).not.toHaveBeenCalled();
        });

        it('should fall back to web OAuth when SDK login throws an error', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

            // Mock SDK throwing error
            (FacebookLogin.login as any).mockRejectedValue(new Error('SDK Error'));

            await act(async () => {
                render(<LoginPage />);
            });

            await vi.waitFor(() => {
                expect(FacebookLogin.initialize).toHaveBeenCalled();
            });

            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            await act(async () => {
                loginButton.click();
            });

            // Should fall back to web OAuth (Browser.open) instead of showing error
            await vi.waitFor(() => {
                expect(mockBrowserOpen).toHaveBeenCalled();
            });
            const openUrl = mockBrowserOpen.mock.calls[0][0]?.url as string;
            expect(openUrl).toContain('facebook.com');

            // Should NOT navigate or set auth
            expect(mockPush).not.toHaveBeenCalled();
            expect(mockSetAuth).not.toHaveBeenCalled();
        });

        it('should fall back to web OAuth when backend API fails after successful SDK login', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

            // SDK succeeds
            (FacebookLogin.login as any).mockResolvedValue({ accessToken: { token: 'native-fb-token' } });

            // But backend fails
            vi.spyOn(authApi, 'nativeFacebookLogin').mockRejectedValue(new Error('Backend Error'));

            await act(async () => {
                render(<LoginPage />);
            });

            await vi.waitFor(() => {
                expect(FacebookLogin.initialize).toHaveBeenCalled();
            });

            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            await act(async () => {
                loginButton.click();
            });

            // Should fall back to web OAuth
            await vi.waitFor(() => {
                expect(mockBrowserOpen).toHaveBeenCalled();
            });

            // Should NOT navigate or set auth
            expect(mockPush).not.toHaveBeenCalled();
            expect(mockSetAuth).not.toHaveBeenCalled();
        });

        it('should fall back to web OAuth on login timeout', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

            // Mock SDK that never resolves (simulates hanging)
            (FacebookLogin.login as any).mockImplementation(() => new Promise(() => {}));

            // Use fake timers for timeout testing
            vi.useFakeTimers();

            await act(async () => {
                render(<LoginPage />);
            });

            await vi.waitFor(() => {
                expect(FacebookLogin.initialize).toHaveBeenCalled();
            });

            const loginButton = screen.getByRole('button', { name: /auth.loginWithFacebook/i });
            await act(async () => {
                loginButton.click();
            });

            // Fast forward 31 seconds (past the 30 second timeout)
            await act(async () => {
                await vi.advanceTimersByTimeAsync(31000);
            });

            // Should fall back to web OAuth instead of showing timeout toast
            await vi.waitFor(() => {
                expect(mockBrowserOpen).toHaveBeenCalled();
            });

            vi.useRealTimers();
        });

        it('should clear stale tokens on page load', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';
            
            // Mock having a stale token
            (FacebookLogin.getCurrentAccessToken as any).mockResolvedValue({ 
                accessToken: { token: 'stale-token' } 
            });

            await act(async () => {
                render(<LoginPage />);
            });

            // Wait for initialization and stale token cleanup
            await vi.waitFor(() => {
                expect(FacebookLogin.getCurrentAccessToken).toHaveBeenCalled();
                expect(FacebookLogin.logout).toHaveBeenCalled();
            });
        });
    });
});
