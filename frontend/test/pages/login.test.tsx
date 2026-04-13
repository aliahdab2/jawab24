import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useRouter } from 'next/router';
import LoginPage from '@/pages/login';

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

// Mock language hook
vi.mock('@/i18n/hooks', () => ({
    useLanguage: () => ({
        language: 'en',
        setLanguage: vi.fn(),
        dateLocale: {},
        intlLocale: 'en-US',
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

// Mock Facebook Login Plugin (no longer used for login, but still imported at module level)
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
const mockBrowserAddListener = vi.fn().mockResolvedValue({ remove: vi.fn() });
vi.mock('@capacitor/browser', () => ({
    Browser: {
        open: (...args: unknown[]) => mockBrowserOpen(...args),
        addListener: (...args: unknown[]) => mockBrowserAddListener(...args),
    }
}));

// Mock Store — use mutable object so tests can override isAuthenticated
const mockSetAuth = vi.fn();
const mockSetLanguage = vi.fn();
const mockAuthState = { isAuthenticated: false, _hasHydrated: true };
vi.mock('@/lib/store', () => ({
    useAuthStore: (selector?: any) => {
        const store = { setAuth: mockSetAuth, ...mockAuthState };
        return selector ? selector(store) : store;
    },
    useUIStore: vi.fn((selector?: any) => {
        const store = { theme: 'light', setTheme: vi.fn(), setLanguage: mockSetLanguage };
        return selector ? selector(store) : store;
    })
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
        mockAuthState.isAuthenticated = false;
        mockAuthState._hasHydrated = true;

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
    
            const loginButton = screen.getByRole('button', { name: /Login with Facebook/i });
            await act(async () => {
                loginButton.click();
            });
    
            expect(toastErrorSpy).toHaveBeenCalledWith('Login failed. Please try again.');
            expect(window.location.href).toBe(''); // Should not redirect
    
            process.env.NEXT_PUBLIC_FB_APP_ID = originalEnv;
        });

        // NOTE: Error handling for web construction removed because login.tsx now uses a direct redirect 
        // without a try-catch block for visual minimalism (as requested by user).
    
        it('should include required OAuth scopes', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';
    
            render(<LoginPage />);
    
            const loginButton = screen.getByRole('button', { name: /Login with Facebook/i });
            await act(async () => {
                loginButton.click();
            });
    
            const href = window.location.href;
            expect(href).toContain('scope=');
    
            const decodedScope = decodeURIComponent(href.match(/scope=([^&]+)/)![1]);
            expect(decodedScope).toContain('email');
            expect(decodedScope).toContain('pages_show_list');
            expect(decodedScope).toContain('pages_read_engagement');
            expect(decodedScope).toContain('pages_read_user_content');
            expect(decodedScope).toContain('pages_manage_engagement');
            expect(decodedScope).toContain('pages_messaging');
        });
    });

    describe('Mobile Login (Web OAuth via System Browser)', () => {
        beforeEach(async () => {
            // Mock Capacitor for mobile platform
            const { Capacitor } = await import('@capacitor/core');
            (Capacitor.isNativePlatform as any).mockReturnValue(true);
            (Capacitor.getPlatform as any).mockReturnValue('android');
        });

        it('should use Browser.open for OAuth on Android', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

            await act(async () => {
                render(<LoginPage />);
            });

            const loginButton = screen.getByRole('button', { name: /Login with Facebook/i });
            await act(async () => {
                loginButton.click();
            });

            await vi.waitFor(() => {
                expect(mockBrowserOpen).toHaveBeenCalled();
            });

            const openUrl = mockBrowserOpen.mock.calls[0][0]?.url as string;
            expect(openUrl).toContain('facebook.com');
            expect(openUrl).toContain('client_id=test-app-id-123');
            expect(openUrl).toContain('state=');

            // State should include mobile marker
            const stateMatch = openUrl.match(/state=([^&]+)/);
            expect(stateMatch).toBeTruthy();
            const decodedState = decodeURIComponent(stateMatch![1]);
            expect(decodedState).toContain('|mobile|');
        });

        it('should use Browser.open for OAuth on iOS', async () => {
            const { Capacitor } = await import('@capacitor/core');
            (Capacitor.getPlatform as any).mockReturnValue('ios');

            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

            await act(async () => {
                render(<LoginPage />);
            });

            const loginButton = screen.getByRole('button', { name: /Login with Facebook/i });
            await act(async () => {
                loginButton.click();
            });

            await vi.waitFor(() => {
                expect(mockBrowserOpen).toHaveBeenCalled();
            });

            const openUrl = mockBrowserOpen.mock.calls[0][0]?.url as string;
            expect(openUrl).toContain('facebook.com');
        });

        it('should show error toast when Browser.open fails', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';
            mockBrowserOpen.mockRejectedValueOnce(new Error('Browser unavailable'));

            await act(async () => {
                render(<LoginPage />);
            });

            const loginButton = screen.getByRole('button', { name: /Login with Facebook/i });
            await act(async () => {
                loginButton.click();
            });

            await vi.waitFor(() => {
                expect(toastErrorSpy).toHaveBeenCalledWith('Login failed. Please try again.');
            });

            // Should NOT navigate
            expect(mockPush).not.toHaveBeenCalled();
        });

        it('should include required OAuth scopes in mobile flow', async () => {
            process.env.NEXT_PUBLIC_FB_APP_ID = 'test-app-id-123';

            await act(async () => {
                render(<LoginPage />);
            });

            const loginButton = screen.getByRole('button', { name: /Login with Facebook/i });
            await act(async () => {
                loginButton.click();
            });

            await vi.waitFor(() => {
                expect(mockBrowserOpen).toHaveBeenCalled();
            });

            const openUrl = mockBrowserOpen.mock.calls[0][0]?.url as string;
            const decodedScope = decodeURIComponent(openUrl.match(/scope=([^&]+)/)![1]);
            expect(decodedScope).toContain('email');
            expect(decodedScope).toContain('pages_show_list');
            expect(decodedScope).toContain('pages_read_engagement');
            expect(decodedScope).toContain('pages_read_user_content');
            expect(decodedScope).toContain('pages_manage_engagement');
            expect(decodedScope).toContain('pages_messaging');
            expect(decodedScope).toContain('instagram_basic');
            expect(decodedScope).toContain('instagram_manage_messages');
            expect(decodedScope).toContain('instagram_manage_comments');
        });
    });

    describe('Auth Guard', () => {
        it('should redirect authenticated users to dashboard', async () => {
            mockAuthState.isAuthenticated = true;
            const mockReplace = vi.fn();
            (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
                query: {},
                push: vi.fn(),
                replace: mockReplace,
                pathname: '/login',
                asPath: '/login',
                events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
            });

            await act(async () => {
                render(<LoginPage />);
            });

            expect(mockReplace).toHaveBeenCalledWith('/dashboard');
        });

        it('should redirect authenticated users to custom redirect path', async () => {
            mockAuthState.isAuthenticated = true;
            const mockReplace = vi.fn();
            (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
                query: { redirect: '/settings' },
                push: vi.fn(),
                replace: mockReplace,
                pathname: '/login',
                asPath: '/login?redirect=/settings',
                events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
            });

            await act(async () => {
                render(<LoginPage />);
            });

            expect(mockReplace).toHaveBeenCalledWith('/settings');
        });

        it('should not redirect when store has not hydrated yet', async () => {
            mockAuthState.isAuthenticated = true;
            mockAuthState._hasHydrated = false;
            const mockReplace = vi.fn();
            (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
                query: {},
                push: vi.fn(),
                replace: mockReplace,
                pathname: '/login',
                asPath: '/login',
                events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
            });

            await act(async () => {
                render(<LoginPage />);
            });

            expect(mockReplace).not.toHaveBeenCalled();
        });

        it('should not redirect unauthenticated users', async () => {
            mockAuthState.isAuthenticated = false;
            const mockReplace = vi.fn();
            (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
                query: {},
                push: vi.fn(),
                replace: mockReplace,
                pathname: '/login',
                asPath: '/login',
                events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
            });

            await act(async () => {
                render(<LoginPage />);
            });

            expect(mockReplace).not.toHaveBeenCalled();
        });

        it('should ignore non-relative redirect paths (open redirect protection)', async () => {
            mockAuthState.isAuthenticated = true;
            const mockReplace = vi.fn();
            (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
                query: { redirect: 'https://evil.com' },
                push: vi.fn(),
                replace: mockReplace,
                pathname: '/login',
                asPath: '/login?redirect=https://evil.com',
                events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
            });

            await act(async () => {
                render(<LoginPage />);
            });

            // Should fall back to /dashboard, not follow the external URL
            expect(mockReplace).toHaveBeenCalledWith('/dashboard');
        });
    });
});
