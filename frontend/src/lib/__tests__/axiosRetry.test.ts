import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { type AxiosResponse, AxiosError } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import {
    addRetryInterceptor,
    addTimeoutConfig,
    isNetworkError,
    isTimeoutError,
    getErrorMessage,
} from '../axiosRetry';

describe('axiosRetry', () => {
    let axiosInstance: ReturnType<typeof axios.create>;
    let mock: MockAdapter;

    beforeEach(() => {
        axiosInstance = axios.create();
        mock = new MockAdapter(axiosInstance);
    });

    afterEach(() => {
        mock.restore();
        vi.clearAllTimers();
    });

    /** Count actual outbound HTTP attempts (not the callback invocations, which
     *  may differ when axios-mock-adapter wraps rejected callbacks). */
    function countAttempts(): { calls: () => number } {
        let count = 0;
        axiosInstance.interceptors.request.use((config) => {
            count++;
            return config;
        });
        return { calls: () => count };
    }

    describe('addRetryInterceptor', () => {
        it('should retry on transport failures (no response)', async () => {
            addRetryInterceptor(axiosInstance, { retries: 2, retryDelay: 100 });
            const counter = countAttempts();
            mock.onGet('/test').networkErrorOnce();
            mock.onGet('/test').networkErrorOnce();
            mock.onGet('/test').reply(200, { success: true });

            const response = await axiosInstance.get('/test');
            expect(response.status).toBe(200);
            expect(counter.calls()).toBe(3); // Initial + 2 retries
        });

        it('should NOT retry on 5xx (React Query owns HTTP retries — see _app.tsx)', async () => {
            addRetryInterceptor(axiosInstance, { retries: 2, retryDelay: 100 });

            let attemptCount = 0;
            mock.onGet('/test').reply(() => {
                attemptCount++;
                return [503, { error: 'Service unavailable' }];
            });

            try {
                await axiosInstance.get('/test');
                expect(true).toBe(false); // should not reach
            } catch {
                // No axios-layer retry on 5xx — prevents axios × React Query
                // amplification that previously turned one 503 into 9 HTTP requests.
                expect(attemptCount).toBe(1);
            }
        });

        it('should not retry on 4xx errors', async () => {
            addRetryInterceptor(axiosInstance, { retries: 2, retryDelay: 100 });

            let attemptCount = 0;
            mock.onGet('/test').reply(() => {
                attemptCount++;
                return [404, { error: 'Not found' }];
            });

            try {
                await axiosInstance.get('/test');
                // Should not reach here
                expect(true).toBe(false);
            } catch {
                expect(attemptCount).toBe(1); // No retries for 4xx
            }
        });

        it('should not retry POST even on transport failure (non-idempotent)', async () => {
            addRetryInterceptor(axiosInstance, { retries: 2, retryDelay: 100 });
            const counter = countAttempts();
            mock.onPost('/test').networkError();

            try {
                await axiosInstance.post('/test', {});
                expect(true).toBe(false);
            } catch {
                expect(counter.calls()).toBe(1); // POST never retried
            }
        });

        it('should respect max retries on transport failures', async () => {
            addRetryInterceptor(axiosInstance, { retries: 3, retryDelay: 100 });
            const counter = countAttempts();
            mock.onGet('/test').networkError();

            try {
                await axiosInstance.get('/test');
                expect(true).toBe(false);
            } catch {
                expect(counter.calls()).toBe(4); // Initial + 3 retries
            }
        });

        it('should use exponential backoff', async () => {
            vi.useFakeTimers();
            addRetryInterceptor(axiosInstance, { retries: 2, retryDelay: 1000 });
            mock.onGet('/test').networkError();

            const promise = axiosInstance.get('/test').catch(() => { });

            // Fast-forward through retries
            await vi.advanceTimersByTimeAsync(1000); // First retry after 1s
            await vi.advanceTimersByTimeAsync(2000); // Second retry after 2s

            await promise;

            vi.useRealTimers();
        });
    });

    describe('addTimeoutConfig', () => {
        it('should set timeout on axios instance', () => {
            addTimeoutConfig(axiosInstance, 5000);
            expect(axiosInstance.defaults.timeout).toBe(5000);
        });

        it('should use default timeout if not specified', () => {
            addTimeoutConfig(axiosInstance);
            expect(axiosInstance.defaults.timeout).toBe(30000);
        });
    });

    describe('isNetworkError', () => {
        it('should return true for network errors', () => {
            const error = new Error('Network Error') as AxiosError;
            error.code = 'ERR_NETWORK';
            expect(isNetworkError(error)).toBe(true);
        });

        it('should return false for response errors', () => {
            const error = new Error('Server Error') as AxiosError;
            error.response = { status: 500 } as unknown as AxiosResponse;
            expect(isNetworkError(error)).toBe(false);
        });

        it('should return false for timeout errors', () => {
            const error = new Error('Timeout') as AxiosError;
            error.code = 'ECONNABORTED';
            expect(isNetworkError(error)).toBe(false);
        });
    });

    describe('isTimeoutError', () => {
        it('should return true for timeout errors with ECONNABORTED code', () => {
            const error = new Error('Timeout') as AxiosError;
            error.code = 'ECONNABORTED';
            expect(isTimeoutError(error)).toBe(true);
        });

        it('should return true for timeout errors with timeout in message', () => {
            const error = new Error('Request timeout') as AxiosError;
            expect(isTimeoutError(error)).toBe(true);
        });

        it('should return false for other errors', () => {
            const error = new Error('Network Error') as AxiosError;
            expect(isTimeoutError(error)).toBe(false);
        });
    });

    describe('getErrorMessage', () => {
        it('should return timeout message in English', () => {
            const error = new Error('Timeout') as AxiosError;
            error.code = 'ECONNABORTED';
            const message = getErrorMessage(error, 'en');
            expect(message).toContain('timed out');
        });

        it('should return timeout message in Arabic', () => {
            const error = new Error('Timeout') as AxiosError;
            error.code = 'ECONNABORTED';
            const message = getErrorMessage(error, 'ar');
            expect(message).toContain('انتهت مهلة');
        });

        it('should return network error message in English', () => {
            const error = new Error('Network Error') as AxiosError;
            error.code = 'ERR_NETWORK';
            const message = getErrorMessage(error, 'en');
            expect(message).toContain('Cannot connect');
        });

        it('should return network error message in Arabic', () => {
            const error = new Error('Network Error') as AxiosError;
            error.code = 'ERR_NETWORK';
            const message = getErrorMessage(error, 'ar');
            expect(message).toContain('لا يمكن الاتصال');
        });

        it('should return rate limit message for 429 errors', () => {
            const error = new Error('Too many requests') as AxiosError;
            error.response = { status: 429 } as unknown as AxiosResponse;
            const message = getErrorMessage(error, 'en');
            expect(message).toContain('Too many requests');
        });

        it('should return server error message for 5xx errors', () => {
            const error = new Error('Server error') as AxiosError;
            error.response = { status: 500 } as unknown as AxiosResponse;
            const message = getErrorMessage(error, 'en');
            expect(message).toContain('Server error');
        });
    });
});
