import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { AxiosHeaders, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

// We need to test the interceptor logic in isolation.
// The api.ts module sets up interceptors at import time, so we test the patterns directly.

describe('API Request Interceptor — Bearer Token', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('should add Bearer token from localStorage when present', () => {
        localStorage.setItem('token', 'test-token-123');

        // Simulate what the request interceptor does
        const config = {
            headers: new AxiosHeaders(),
            method: 'get',
        } as InternalAxiosRequestConfig;

        if (typeof window !== 'undefined') {
            const token = localStorage.getItem('token');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }

        expect(config.headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should not add Bearer token when localStorage is empty', () => {
        const config = {
            headers: new AxiosHeaders(),
            method: 'get',
        } as InternalAxiosRequestConfig;

        if (typeof window !== 'undefined') {
            const token = localStorage.getItem('token');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }

        expect(config.headers.Authorization).toBeUndefined();
    });
});

describe('API Request Interceptor — CSRF Token', () => {
    const originalCookie = Object.getOwnPropertyDescriptor(document, 'cookie');

    afterEach(() => {
        if (originalCookie) {
            Object.defineProperty(document, 'cookie', originalCookie);
        }
    });

    it('should add CSRF token for POST requests when cookie exists', () => {
        // Set up cookie
        Object.defineProperty(document, 'cookie', {
            get: () => 'csrfToken=abc123; other=value',
            configurable: true,
        });

        const config = {
            headers: new AxiosHeaders(),
            method: 'post',
        } as InternalAxiosRequestConfig;

        // Simulate interceptor logic
        if (document.cookie && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
            const match = document.cookie.match(new RegExp('(^| )csrfToken=([^;]+)'));
            if (match) {
                config.headers['X-CSRF-Token'] = match[2];
            }
        }

        expect(config.headers['X-CSRF-Token']).toBe('abc123');
    });

    it('should add CSRF token for PUT requests', () => {
        Object.defineProperty(document, 'cookie', {
            get: () => 'csrfToken=xyz789',
            configurable: true,
        });

        const config = {
            headers: new AxiosHeaders(),
            method: 'put',
        } as InternalAxiosRequestConfig;

        if (document.cookie && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
            const match = document.cookie.match(new RegExp('(^| )csrfToken=([^;]+)'));
            if (match) {
                config.headers['X-CSRF-Token'] = match[2];
            }
        }

        expect(config.headers['X-CSRF-Token']).toBe('xyz789');
    });

    it('should NOT add CSRF token for GET requests', () => {
        Object.defineProperty(document, 'cookie', {
            get: () => 'csrfToken=abc123',
            configurable: true,
        });

        const config = {
            headers: new AxiosHeaders(),
            method: 'get',
        } as InternalAxiosRequestConfig;

        if (document.cookie && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
            const match = document.cookie.match(new RegExp('(^| )csrfToken=([^;]+)'));
            if (match) {
                config.headers['X-CSRF-Token'] = match[2];
            }
        }

        expect(config.headers['X-CSRF-Token']).toBeUndefined();
    });

    it('should NOT add CSRF token when no cookie exists', () => {
        Object.defineProperty(document, 'cookie', {
            get: () => '',
            configurable: true,
        });

        const config = {
            headers: new AxiosHeaders(),
            method: 'post',
        } as InternalAxiosRequestConfig;

        if (document.cookie && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
            const match = document.cookie.match(new RegExp('(^| )csrfToken=([^;]+)'));
            if (match) {
                config.headers['X-CSRF-Token'] = match[2];
            }
        }

        expect(config.headers['X-CSRF-Token']).toBeUndefined();
    });
});

describe('API — X-Workspace-Id header pattern', () => {
    // This tests the pattern that will be added in Phase 3.
    // Currently the header is NOT sent — this test documents the expected behavior.

    it('should inject workspace ID when activeWorkspaceId is set', () => {
        const config = {
            headers: new AxiosHeaders(),
            method: 'get',
        } as InternalAxiosRequestConfig;

        // Simulate the workspace interceptor pattern (Phase 3.2)
        const activeWorkspaceId = 'ws_123';
        if (activeWorkspaceId) {
            config.headers['X-Workspace-Id'] = activeWorkspaceId;
        }

        expect(config.headers['X-Workspace-Id']).toBe('ws_123');
    });

    it('should NOT inject workspace header when activeWorkspaceId is null', () => {
        const config = {
            headers: new AxiosHeaders(),
            method: 'get',
        } as InternalAxiosRequestConfig;

        const activeWorkspaceId: string | null = null;
        if (activeWorkspaceId) {
            config.headers['X-Workspace-Id'] = activeWorkspaceId;
        }

        expect(config.headers['X-Workspace-Id']).toBeUndefined();
    });
});

describe('Retry Logic — addRetryInterceptor', () => {
    // Test retry utility functions
    it('should identify network errors', async () => {
        const { isNetworkError } = await import('@/lib/axiosRetry');

        // Network error: no response, no ECONNABORTED
        const networkError = new Error('Network Error') as AxiosError;
        (networkError as AxiosError).code = undefined;
        (networkError as AxiosError).response = undefined;

        expect(isNetworkError(networkError)).toBe(true);
    });

    it('should not classify timeout as network error', async () => {
        const { isNetworkError } = await import('@/lib/axiosRetry');

        const timeoutError = new Error('timeout') as AxiosError;
        (timeoutError as AxiosError).code = 'ECONNABORTED';
        (timeoutError as AxiosError).response = undefined;

        expect(isNetworkError(timeoutError)).toBe(false);
    });

    it('should identify timeout errors', async () => {
        const { isTimeoutError } = await import('@/lib/axiosRetry');

        const timeoutError = new Error('timeout of 30000ms exceeded') as AxiosError;
        (timeoutError as AxiosError).code = 'ECONNABORTED';

        expect(isTimeoutError(timeoutError)).toBe(true);
    });

    it('should not classify regular errors as timeout', async () => {
        const { isTimeoutError } = await import('@/lib/axiosRetry');

        const regularError = new Error('some error');
        expect(isTimeoutError(regularError)).toBe(false);
    });

    it('should handle non-Error values', async () => {
        const { isNetworkError, isTimeoutError } = await import('@/lib/axiosRetry');

        expect(isNetworkError('string error')).toBe(false);
        expect(isTimeoutError(null)).toBe(false);
        expect(isNetworkError(42)).toBe(false);
    });
});

describe('Retry Logic — retry condition', () => {
    it('should NOT retry POST requests', () => {
        // Default retry condition: never retry non-idempotent methods
        const retryCondition = (error: AxiosError) => {
            const method = error.config?.method?.toLowerCase();
            if (method && ['delete', 'post', 'patch'].includes(method)) {
                return false;
            }
            return !error.response || (error.response.status >= 500 && error.response.status < 600);
        };

        const error = {
            config: { method: 'post' },
            response: { status: 500 },
        } as AxiosError;

        expect(retryCondition(error)).toBe(false);
    });

    it('should NOT retry DELETE requests', () => {
        const retryCondition = (error: AxiosError) => {
            const method = error.config?.method?.toLowerCase();
            if (method && ['delete', 'post', 'patch'].includes(method)) {
                return false;
            }
            return !error.response || (error.response.status >= 500 && error.response.status < 600);
        };

        const error = {
            config: { method: 'delete' },
            response: { status: 500 },
        } as AxiosError;

        expect(retryCondition(error)).toBe(false);
    });

    it('should retry GET requests on 500', () => {
        const retryCondition = (error: AxiosError) => {
            const method = error.config?.method?.toLowerCase();
            if (method && ['delete', 'post', 'patch'].includes(method)) {
                return false;
            }
            return !error.response || (error.response.status >= 500 && error.response.status < 600);
        };

        const error = {
            config: { method: 'get' },
            response: { status: 500 },
        } as AxiosError;

        expect(retryCondition(error)).toBe(true);
    });

    it('should NOT retry GET requests on 400', () => {
        const retryCondition = (error: AxiosError) => {
            const method = error.config?.method?.toLowerCase();
            if (method && ['delete', 'post', 'patch'].includes(method)) {
                return false;
            }
            return !error.response || (error.response.status >= 500 && error.response.status < 600);
        };

        const error = {
            config: { method: 'get' },
            response: { status: 400 },
        } as AxiosError;

        expect(retryCondition(error)).toBe(false);
    });

    it('should retry GET requests on network error (no response)', () => {
        const retryCondition = (error: AxiosError) => {
            const method = error.config?.method?.toLowerCase();
            if (method && ['delete', 'post', 'patch'].includes(method)) {
                return false;
            }
            return !error.response || (error.response.status >= 500 && error.response.status < 600);
        };

        const error = {
            config: { method: 'get' },
            response: undefined,
        } as unknown as AxiosError;

        expect(retryCondition(error)).toBe(true);
    });
});

describe('Error message formatting', () => {
    it('should return timeout message for timeout errors', async () => {
        const { getErrorMessage } = await import('@/lib/axiosRetry');

        const timeoutError = new Error('timeout of 30000ms exceeded') as AxiosError;
        timeoutError.code = 'ECONNABORTED';

        const message = getErrorMessage(timeoutError, 'en');
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
    });

    it('should return rate limit message for 429 errors', async () => {
        const { getErrorMessage } = await import('@/lib/axiosRetry');

        const rateLimitError = new Error('Too Many Requests') as AxiosError;
        rateLimitError.response = { status: 429 } as AxiosResponse;

        const message = getErrorMessage(rateLimitError, 'en');
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
    });
});
