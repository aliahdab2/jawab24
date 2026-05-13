import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosHeaders, InternalAxiosRequestConfig, AxiosError, AxiosResponse } from 'axios';

// Mock dependencies that have side effects when api.ts loads
vi.mock('@/lib/authManager', () => ({
    authManager: { setupAuthInterceptor: vi.fn() },
}));

vi.mock('@/lib/axiosRetry', () => ({
    addRetryInterceptor: vi.fn(),
    addTimeoutConfig: vi.fn(),
}));

// Import the real api module — its request interceptor is registered at import time
import { api, publicApi } from '@/lib/api';
import { authManager } from '@/lib/authManager';
import { addRetryInterceptor, addTimeoutConfig } from '@/lib/axiosRetry';

// Extract the real request interceptor handler registered by api.ts (line 55)
function getRequestInterceptor(): (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (api.interceptors.request as any).handlers;
    for (const handler of handlers) {
        if (handler?.fulfilled) return handler.fulfilled;
    }
    throw new Error('No request interceptor found on api instance');
}

const interceptor = getRequestInterceptor();

// ============================================================================
// Module setup verification
// ============================================================================

describe('API module setup', () => {
    it('should enable withCredentials on both instances', () => {
        expect(api.defaults.withCredentials).toBe(true);
        expect(publicApi.defaults.withCredentials).toBe(true);
    });

    it('should call addRetryInterceptor for both instances', () => {
        expect(addRetryInterceptor).toHaveBeenCalledWith(api, { retries: 2, retryDelay: 500 });
        expect(addRetryInterceptor).toHaveBeenCalledWith(publicApi, { retries: 2, retryDelay: 500 });
    });

    it('should call addTimeoutConfig for both instances', () => {
        expect(addTimeoutConfig).toHaveBeenCalledWith(api, 15000);
        expect(addTimeoutConfig).toHaveBeenCalledWith(publicApi, 15000);
    });

    it('should set up auth interceptor via authManager', () => {
        expect(authManager.setupAuthInterceptor).toHaveBeenCalledWith(api);
    });
});

// ============================================================================
// Request interceptor — Bearer Token
// ============================================================================

describe('API Request Interceptor — Bearer Token', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('should add Bearer token from localStorage when present', () => {
        localStorage.setItem('token', 'test-token-123');

        const config = {
            headers: new AxiosHeaders(),
            method: 'get',
        } as InternalAxiosRequestConfig;

        const result = interceptor(config);

        expect(result.headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should not add Bearer token when localStorage is empty', () => {
        const config = {
            headers: new AxiosHeaders(),
            method: 'get',
        } as InternalAxiosRequestConfig;

        const result = interceptor(config);

        expect(result.headers.Authorization).toBeUndefined();
    });
});

// ============================================================================
// Request interceptor — CSRF Token
// ============================================================================

describe('API Request Interceptor — CSRF Token', () => {
    const originalCookie = Object.getOwnPropertyDescriptor(document, 'cookie');

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        if (originalCookie) {
            Object.defineProperty(document, 'cookie', originalCookie);
        }
    });

    it('should add CSRF token for POST requests when cookie exists', () => {
        Object.defineProperty(document, 'cookie', {
            get: () => 'csrfToken=abc123; other=value',
            configurable: true,
        });

        const config = {
            headers: new AxiosHeaders(),
            method: 'post',
        } as InternalAxiosRequestConfig;

        const result = interceptor(config);

        expect(result.headers['X-CSRF-Token']).toBe('abc123');
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

        const result = interceptor(config);

        expect(result.headers['X-CSRF-Token']).toBe('xyz789');
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

        const result = interceptor(config);

        expect(result.headers['X-CSRF-Token']).toBeUndefined();
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

        const result = interceptor(config);

        expect(result.headers['X-CSRF-Token']).toBeUndefined();
    });
});

// ============================================================================
// axiosRetry utility functions — imported from the real module
// ============================================================================

describe('Retry Logic — utility functions', () => {
    it('should identify network errors', async () => {
        const { isNetworkError } = await vi.importActual<typeof import('@/lib/axiosRetry')>('@/lib/axiosRetry');

        const networkError = new Error('Network Error') as AxiosError;
        (networkError as AxiosError).code = undefined;
        (networkError as AxiosError).response = undefined;

        expect(isNetworkError(networkError)).toBe(true);
    });

    it('should not classify timeout as network error', async () => {
        const { isNetworkError } = await vi.importActual<typeof import('@/lib/axiosRetry')>('@/lib/axiosRetry');

        const timeoutError = new Error('timeout') as AxiosError;
        (timeoutError as AxiosError).code = 'ECONNABORTED';
        (timeoutError as AxiosError).response = undefined;

        expect(isNetworkError(timeoutError)).toBe(false);
    });

    it('should identify timeout errors', async () => {
        const { isTimeoutError } = await vi.importActual<typeof import('@/lib/axiosRetry')>('@/lib/axiosRetry');

        const timeoutError = new Error('timeout of 30000ms exceeded') as AxiosError;
        (timeoutError as AxiosError).code = 'ECONNABORTED';

        expect(isTimeoutError(timeoutError)).toBe(true);
    });

    it('should not classify regular errors as timeout', async () => {
        const { isTimeoutError } = await vi.importActual<typeof import('@/lib/axiosRetry')>('@/lib/axiosRetry');

        const regularError = new Error('some error');
        expect(isTimeoutError(regularError)).toBe(false);
    });

    it('should handle non-Error values', async () => {
        const { isNetworkError, isTimeoutError } = await vi.importActual<typeof import('@/lib/axiosRetry')>('@/lib/axiosRetry');

        expect(isNetworkError('string error')).toBe(false);
        expect(isTimeoutError(null)).toBe(false);
        expect(isNetworkError(42)).toBe(false);
    });
});

describe('Error message formatting', () => {
    it('should return timeout message for timeout errors', async () => {
        const { getErrorMessage } = await vi.importActual<typeof import('@/lib/axiosRetry')>('@/lib/axiosRetry');

        const timeoutError = new Error('timeout of 30000ms exceeded') as AxiosError;
        timeoutError.code = 'ECONNABORTED';

        const message = getErrorMessage(timeoutError, 'en');
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
    });

    it('should return rate limit message for 429 errors', async () => {
        const { getErrorMessage } = await vi.importActual<typeof import('@/lib/axiosRetry')>('@/lib/axiosRetry');

        const rateLimitError = new Error('Too Many Requests') as AxiosError;
        rateLimitError.response = { status: 429 } as AxiosResponse;

        const message = getErrorMessage(rateLimitError, 'en');
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
    });
});
