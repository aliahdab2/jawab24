import { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

/**
 * Configuration for retry logic
 */
interface RetryConfig {
    retries: number;
    retryDelay: number;
    retryCondition?: (error: AxiosError) => boolean;
}

/**
 * Default retry configuration
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
        // Retry on network errors or 5xx server errors (GET/PUT only)
        return !error.response || (error.response.status >= 500 && error.response.status < 600);
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
export function getErrorMessage(error: unknown, language: 'en' | 'ar' = 'en'): string {
    if (isTimeoutError(error)) {
        return language === 'ar'
            ? 'انتهت مهلة الطلب. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.'
            : 'Request timed out. Please check your internet connection and try again.';
    }

    if (isNetworkError(error)) {
        return language === 'ar'
            ? 'لا يمكن الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت.'
            : 'Cannot connect to server. Please check your internet connection.';
    }

    const e = error as AxiosError;
    if (e?.response?.status === 429) {
        return language === 'ar'
            ? 'تم تجاوز الحد المسموح من الطلبات. يرجى المحاولة لاحقاً.'
            : 'Too many requests. Please try again later.';
    }

    if (e?.response?.status && e.response.status >= 500) {
        return language === 'ar'
            ? 'حدث خطأ في الخادم. يرجى المحاولة لاحقاً.'
            : 'Server error. Please try again later.';
    }

    return language === 'ar'
        ? 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.'
        : 'An unexpected error occurred. Please try again.';
}
