import { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type { Language } from '../i18n';
import enErrors from '../i18n/en/errors.json';
import arErrors from '../i18n/ar/errors.json';

const ERROR_MESSAGES: Record<string, Record<string, string>> = { en: enErrors, ar: arErrors };

/**
 * Configuration for retry logic
 */
interface RetryConfig {
    retries: number;
    retryDelay: number;
    retryCondition?: (error: AxiosError) => boolean;
}

/**
 * Default retry configuration.
 *
 * Axios retries are restricted to *transport-level* failures (no response received).
 * HTTP status retries (5xx, etc.) are owned by React Query so the two layers cannot
 * multiply each other. A previous double-retry setup (axios 3× × React Query 3×)
 * amplified a single 503 into 9 HTTP requests per query and triggered nginx
 * rate-limit storms that looked like server outages.
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
    retries: 3,
    retryDelay: 1000, // Start with 1 second
    retryCondition: (error: AxiosError) => {
        // Never retry non-idempotent methods (DELETE, POST, PATCH) — they can cause duplicate operations
        const method = error.config?.method?.toLowerCase();
        if (method && ['delete', 'post', 'patch'].includes(method)) {
            return false;
        }
        // Retry only on transport failures (no HTTP response). HTTP-level errors
        // (5xx, 429, etc.) are React Query's responsibility — see _app.tsx queryClient.
        return !error.response;
    },
};

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(retryCount: number, baseDelay: number): number {
    return Math.min(baseDelay * Math.pow(2, retryCount), 10000); // Max 10 seconds
}

/**
 * Add retry logic to an axios instance
 */
export function addRetryInterceptor(
    axiosInstance: AxiosInstance,
    config: Partial<RetryConfig> = {}
): void {
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

    axiosInstance.interceptors.response.use(
        (response) => response,
        async (error: AxiosError) => {
            const originalRequest = error.config as InternalAxiosRequestConfig & {
                _retryCount?: number;
            };

            // If no config or already retried max times, reject
            if (!originalRequest || (originalRequest._retryCount ?? 0) >= retryConfig.retries) {
                return Promise.reject(error);
            }

            // Check if we should retry this error
            const shouldRetry = retryConfig.retryCondition
                ? retryConfig.retryCondition(error)
                : true;

            if (!shouldRetry) {
                return Promise.reject(error);
            }

            // Initialize retry count
            originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;

            // Calculate delay with exponential backoff
            const delay = getRetryDelay(originalRequest._retryCount - 1, retryConfig.retryDelay);

            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, delay));

            // Retry the request
            return axiosInstance(originalRequest);
        }
    );
}

/**
 * Add timeout configuration to an axios instance
 */
export function addTimeoutConfig(
    axiosInstance: AxiosInstance,
    timeout: number = 30000 // 30 seconds default
): void {
    axiosInstance.defaults.timeout = timeout;
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const e = error as AxiosError;
    return !e.response && e.code !== 'ECONNABORTED';
}

/**
 * Check if error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const e = error as AxiosError;
    return e.code === 'ECONNABORTED' || e.message.includes('timeout');
}

/**
 * Get user-friendly error message
 */
export function getErrorMessage(error: unknown, language: Language = 'en'): string {
    const msgs = ERROR_MESSAGES[language] ?? ERROR_MESSAGES.en;
    const t = (key: string) => msgs[key] ?? key;

    if (isTimeoutError(error)) {
        return t('timeout');
    }

    if (isNetworkError(error)) {
        return t('cannotConnect');
    }

    const e = error as AxiosError;
    if (e?.response?.status === 429) {
        return t('tooManyRequests');
    }

    if (e?.response?.status && e.response.status >= 500) {
        return t('serverErrorRetry');
    }

    return t('unexpectedError');
}
