import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import { createMockAxios } from '@/__tests__/testUtils/mockAxios';

// Mock Sentry
vi.mock('@sentry/nextjs', () => ({
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
}));

// Mock sentryHelpers
vi.mock('@/lib/sentryHelpers', () => ({
    captureError: vi.fn(),
    addErrorBreadcrumb: vi.fn(),
}));

// We test the AuthManager class by importing it fresh.
// Since it's a singleton, we need to handle that carefully.

describe('AuthManager', () => {
    let AuthManagerModule: typeof import('@/lib/authManager');

    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset the module to get a fresh singleton
        vi.resetModules();
        AuthManagerModule = await import('@/lib/authManager');
    });

    describe('getInstance', () => {
        it('should return the same instance (singleton)', () => {
            const instance1 = AuthManagerModule.authManager;
            const instance2 = AuthManagerModule.authManager;
            expect(instance1).toBe(instance2);
        });
    });

    describe('onAuthStateChange', () => {
        it('should register a listener and return unsubscribe function', () => {
            const callback = vi.fn();
            const unsubscribe = AuthManagerModule.authManager.onAuthStateChange(callback);

            expect(typeof unsubscribe).toBe('function');
        });

        it('should not call listener after unsubscribe', async () => {
            const callback = vi.fn();
            const unsubscribe = AuthManagerModule.authManager.onAuthStateChange(callback);

            unsubscribe();

            // Trigger a logout which calls notifyAuthStateChange(false) internally.
            // doMock registrations LEAK into the tests that follow in this file, so
            // every store stub here must expose all of what authManager touches, not
            // just what logout() needs. A setState-only stub made a SUCCESSFUL
            // /auth/refresh report failure in the refreshToken suite below, because
            // adopting the rotated access token calls getState().setToken.
            vi.doMock('@/lib/store', () => ({
                useAuthStore: { setState: vi.fn(), getState: vi.fn(() => ({ setToken: vi.fn() })) },
            }));
            vi.doMock('@/lib/api', () => ({
                publicApi: { post: vi.fn().mockResolvedValue({}) },
            }));
            vi.doMock('@capacitor/core', () => ({
                Capacitor: { isNativePlatform: () => false },
            }));

            await AuthManagerModule.authManager.logout({ redirect: false });

            // Callback should NOT have been called since we unsubscribed
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('refreshToken', () => {
        it('should return true when refresh succeeds', async () => {
            const mockAxiosInstance = {
                post: vi.fn().mockResolvedValue({
                    data: { success: true, token: 'new-token-123' },
                }),
            } as unknown as AxiosInstance;

            const result = await AuthManagerModule.authManager.refreshToken(mockAxiosInstance);

            expect(result).toBe(true);
            expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/refresh');
        });

        it('should return false when refresh returns success=false', async () => {
            const mockAxiosInstance = {
                post: vi.fn().mockResolvedValue({
                    data: { success: false },
                }),
            } as unknown as AxiosInstance;

            const result = await AuthManagerModule.authManager.refreshToken(mockAxiosInstance);

            expect(result).toBe(false);
        });

        it('should return false when refresh throws', async () => {
            const mockAxiosInstance = {
                post: vi.fn().mockRejectedValue(new Error('Network error')),
            } as unknown as AxiosInstance;

            const result = await AuthManagerModule.authManager.refreshToken(mockAxiosInstance);

            expect(result).toBe(false);
        });
    });

    describe('logout', () => {
        it('should clear localStorage', async () => {
            localStorage.setItem('token', 'test-token');
            localStorage.setItem('user', '{"id":"1"}');

            // Mock the dynamic imports that logout uses
            vi.doMock('@/lib/store', () => ({
                useAuthStore: {
                    setState: vi.fn(),
                    getState: vi.fn(() => ({ setToken: vi.fn() })),
                },
            }));

            vi.doMock('@/lib/api', () => ({
                publicApi: {
                    post: vi.fn().mockResolvedValue({}),
                },
            }));

            vi.doMock('@capacitor/core', () => ({
                Capacitor: {
                    isNativePlatform: () => false,
                },
            }));

            await AuthManagerModule.authManager.logout({ redirect: false });

            expect(localStorage.getItem('token')).toBeNull();
            expect(localStorage.getItem('user')).toBeNull();
        });

        it('should prevent multiple simultaneous logouts', async () => {
            vi.doMock('@/lib/store', () => ({
                useAuthStore: {
                    setState: vi.fn(),
                    getState: vi.fn(() => ({ setToken: vi.fn() })),
                },
            }));

            vi.doMock('@/lib/api', () => ({
                publicApi: {
                    post: vi.fn().mockImplementation(() =>
                        new Promise(resolve => setTimeout(() => resolve({}), 100))
                    ),
                },
            }));

            vi.doMock('@capacitor/core', () => ({
                Capacitor: {
                    isNativePlatform: () => false,
                },
            }));

            // Start two logouts simultaneously
            const logout1 = AuthManagerModule.authManager.logout({ redirect: false });
            const logout2 = AuthManagerModule.authManager.logout({ redirect: false });

            await Promise.all([logout1, logout2]);

            // Should complete without error — the second logout is no-op
        });

        it('should not redirect when redirect=false', async () => {
            vi.doMock('@/lib/store', () => ({
                useAuthStore: {
                    setState: vi.fn(),
                    getState: vi.fn(() => ({ setToken: vi.fn() })),
                },
            }));

            vi.doMock('@/lib/api', () => ({
                publicApi: {
                    post: vi.fn().mockResolvedValue({}),
                },
            }));

            vi.doMock('@capacitor/core', () => ({
                Capacitor: {
                    isNativePlatform: () => false,
                },
            }));

            // Spy on the href *setter* — `value: { href: '/' }` would record an
            // assignment as a plain property write and prove nothing, which is why
            // this test asserted nothing at all until 2026-08-04.
            const hrefSetter = vi.fn();
            Object.defineProperty(window, 'location', {
                value: {
                    get href() { return '/'; },
                    set href(next: string) { hrefSetter(next); },
                    pathname: '/dashboard',
                },
                writable: true,
                configurable: true,
            });

            await AuthManagerModule.authManager.logout({ redirect: false });

            // redirect:false must never navigate
            expect(hrefSetter).not.toHaveBeenCalled();
        });
    });

    describe('setupAuthInterceptor', () => {
        it('should register a response interceptor', () => {
            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: {
                    response: {
                        use: mockUse,
                    },
                },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            expect(mockUse).toHaveBeenCalledTimes(1);
            // First arg is success handler, second is error handler
            expect(typeof mockUse.mock.calls[0][0]).toBe('function');
            expect(typeof mockUse.mock.calls[0][1]).toBe('function');
        });

        it('success handler should pass through responses', () => {
            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: {
                    response: {
                        use: mockUse,
                    },
                },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const successHandler = mockUse.mock.calls[0][0];
            const mockResponse = { status: 200, data: { ok: true } };
            expect(successHandler(mockResponse)).toBe(mockResponse);
        });

        it('error handler should pass through non-401 errors', async () => {
            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: {
                    response: {
                        use: mockUse,
                    },
                },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const errorHandler = mockUse.mock.calls[0][1];
            const error = {
                config: { url: '/some-endpoint' },
                response: { status: 403 },
            } as AxiosError;

            await expect(errorHandler(error)).rejects.toBe(error);
        });

        it('error handler should show translated toast and reject on 403 INSUFFICIENT_ROLE', async () => {
            const mockToastError = vi.fn();
            vi.doMock('sonner', () => ({ toast: { error: mockToastError } }));

            vi.resetModules();
            AuthManagerModule = await import('@/lib/authManager');

            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: { response: { use: mockUse } },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const errorHandler = mockUse.mock.calls[0][1];
            const error = {
                config: { url: '/settings/update' },
                response: { status: 403, data: { code: 'INSUFFICIENT_ROLE' } },
            } as unknown as AxiosError;

            await expect(errorHandler(error)).rejects.toBe(error);
            expect(mockToastError).toHaveBeenCalledTimes(1);
            // Should show a non-empty translated string, not a raw key
            const message = mockToastError.mock.calls[0][0] as string;
            expect(typeof message).toBe('string');
            expect(message).not.toBe('insufficientRole');
            expect(message.length).toBeGreaterThan(10);
        });

        it('error handler should NOT show permission toast for 403 without INSUFFICIENT_ROLE code', async () => {
            const mockToastError = vi.fn();
            vi.doMock('sonner', () => ({ toast: { error: mockToastError } }));

            vi.resetModules();
            AuthManagerModule = await import('@/lib/authManager');

            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: { response: { use: mockUse } },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const errorHandler = mockUse.mock.calls[0][1];
            const error = {
                config: { url: '/settings/update' },
                response: { status: 403, data: { code: 'WORKSPACE_ACCESS_DENIED' } },
            } as unknown as AxiosError;

            // WORKSPACE_ACCESS_DENIED tries to clear workspace and retry — just catch the rejection
            await expect(errorHandler(error)).rejects.toBeDefined();
            expect(mockToastError).not.toHaveBeenCalled();
        });

        it('error handler should skip auth endpoints', async () => {
            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: {
                    response: {
                        use: mockUse,
                    },
                },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const errorHandler = mockUse.mock.calls[0][1];

            // 401 on /auth/refresh should NOT trigger refresh logic
            const error = {
                config: { url: '/auth/refresh' },
                response: { status: 401 },
            } as AxiosError;

            await expect(errorHandler(error)).rejects.toBe(error);
        });

        it('error handler should skip when no config', async () => {
            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: {
                    response: {
                        use: mockUse,
                    },
                },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const errorHandler = mockUse.mock.calls[0][1];
            const error = {
                config: undefined,
                response: { status: 401 },
            } as unknown as AxiosError;

            await expect(errorHandler(error)).rejects.toBe(error);
        });

        it('error handler should skip already-retried requests', async () => {
            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: {
                    response: {
                        use: mockUse,
                    },
                },
            } as unknown as AxiosInstance;

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const errorHandler = mockUse.mock.calls[0][1];
            const error = {
                config: { url: '/some-endpoint', _retry: true },
                response: { status: 401 },
            } as unknown as AxiosError;

            await expect(errorHandler(error)).rejects.toBe(error);
        });

        it('should refresh token and retry original request on 401', async () => {
            const retryResponse = { status: 200, data: { ok: true } } as AxiosResponse;

            // post('/auth/refresh') succeeds, then calling the instance as a
            // function (the retry) succeeds. Never a real axios instance: the
            // retry would issue a live request — see testUtils/mockAxios.
            const mockAxios = createMockAxios();
            mockAxios.post.mockResolvedValue({ data: { success: true } });
            mockAxios.retry.mockResolvedValue(retryResponse);

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxios.instance);

            const error = {
                config: { url: '/some-endpoint' },
                response: { status: 401 },
            } as unknown as AxiosError;

            const result = await mockAxios.response.onRejected(error);

            // Should have retried the original request
            expect(result).toBe(retryResponse);
            // Config should be marked as _retry
            expect(error.config).toHaveProperty('_retry', true);
            // refreshToken should have been called
            expect(mockAxios.post).toHaveBeenCalledWith('/auth/refresh');
        });

        // Transient auth-bridge pages (/auth/app-sync, /auth/sync) navigate away
        // within milliseconds; a refresh started there can lose its Set-Cookie
        // mid-teardown and leave the jar holding a revoked token (prod 2026-07-30).
        // A 401 there must neither refresh nor logout.
        it.each(['/auth/app-sync', '/auth/sync', '/en/auth/sync'])(
            'error handler should not refresh or logout for 401 on bridge page %s',
            async (pathname) => {
                const originalLocation = window.location;
                Object.defineProperty(window, 'location', {
                    value: { ...originalLocation, pathname, href: `https://jawab24.com${pathname}` },
                    writable: true,
                    configurable: true,
                });

                try {
                    const mockUse = vi.fn();
                    const mockPost = vi.fn();
                    const mockAxiosInstance = {
                        interceptors: { response: { use: mockUse } },
                        post: mockPost,
                    } as unknown as AxiosInstance;

                    AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

                    const errorHandler = mockUse.mock.calls[0][1];
                    const error = {
                        config: { url: '/sse/events' },
                        response: { status: 401 },
                    } as unknown as AxiosError;

                    // Rejects with the ORIGINAL error — no refresh attempt, no logout redirect
                    await expect(errorHandler(error)).rejects.toBe(error);
                    expect(mockPost).not.toHaveBeenCalled();
                } finally {
                    Object.defineProperty(window, 'location', {
                        value: originalLocation,
                        writable: true,
                        configurable: true,
                    });
                }
            },
        );

        it('error handler still refreshes on non-bridge pages (guard is scoped)', async () => {
            const originalLocation = window.location;
            Object.defineProperty(window, 'location', {
                value: { ...originalLocation, pathname: '/dashboard' },
                writable: true,
                configurable: true,
            });

            try {
                const retryResponse = { status: 200, data: { ok: true } } as AxiosResponse;
                const mockAxios = createMockAxios();
                mockAxios.post.mockResolvedValue({ data: { success: true } });
                mockAxios.retry.mockResolvedValue(retryResponse);

                AuthManagerModule.authManager.setupAuthInterceptor(mockAxios.instance);

                const error = {
                    config: { url: '/sse/events' },
                    response: { status: 401 },
                } as unknown as AxiosError;

                const result = await mockAxios.response.onRejected(error);
                expect(result).toBe(retryResponse);
                expect(mockAxios.post).toHaveBeenCalledWith('/auth/refresh');
            } finally {
                Object.defineProperty(window, 'location', {
                    value: originalLocation,
                    writable: true,
                    configurable: true,
                });
            }
        });

        it('should logout when refresh fails', async () => {
            const mockUse = vi.fn();
            const mockAxiosInstance = {
                interceptors: {
                    response: { use: mockUse },
                },
                post: vi.fn().mockResolvedValue({
                    data: { success: false },
                }),
            } as unknown as AxiosInstance;

            // Mock logout dependencies
            vi.doMock('@/lib/store', () => ({
                useAuthStore: { setState: vi.fn(), getState: vi.fn(() => ({ setToken: vi.fn() })) },
            }));
            vi.doMock('@/lib/api', () => ({
                publicApi: { post: vi.fn().mockResolvedValue({}) },
            }));
            vi.doMock('@capacitor/core', () => ({
                Capacitor: { isNativePlatform: () => false },
            }));

            AuthManagerModule.authManager.setupAuthInterceptor(mockAxiosInstance);

            const errorHandler = mockUse.mock.calls[0][1];
            const error = {
                config: { url: '/some-endpoint' },
                response: { status: 401 },
            } as unknown as AxiosError;

            await expect(errorHandler(error)).rejects.toThrow('Session expired');
        });
    });
});
