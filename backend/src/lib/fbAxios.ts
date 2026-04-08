/**
 * Facebook Graph API — Axios instance with automatic retry
 *
 * Retries on:
 * - HTTP 429 (rate limit) — waits Retry-After header or 60s default
 * - Facebook app-level rate limits (error code 4 or 32)
 * - 5xx server errors and network failures — 2s retry
 *
 * Max 2 retries per request. After that, the error propagates to the caller
 * and BullMQ job-level retry (3 attempts, exponential backoff) takes over.
 *
 * Used by facebook.ts, instagram.ts, sender.ts — anything that calls the
 * Facebook/Instagram Graph API. NOT used for cosmetic calls (typing indicators).
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const MAX_RETRIES = 2;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const TRANSIENT_RETRY_WAIT_MS = 2_000;

interface RetryConfig extends InternalAxiosRequestConfig {
    _retryCount?: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine how long to wait before retrying a failed Facebook API call.
 * Returns ms to wait, or 0 to not retry.
 */
function getRetryDelay(error: AxiosError): number {
    const status = error.response?.status;

    // HTTP 429 — use Retry-After header or default
    if (status === 429) {
        const header = error.response?.headers?.['retry-after'];
        if (header) {
            const seconds = Number(header);
            if (!isNaN(seconds)) return seconds * 1000;
        }
        return DEFAULT_RATE_LIMIT_WAIT_MS;
    }

    // Facebook app-level rate limit: error code 4 (app limit) or 32 (page limit)
    const fbError = (error.response?.data as { error?: { code?: number } })?.error;
    if (fbError && (fbError.code === 4 || fbError.code === 32)) {
        return DEFAULT_RATE_LIMIT_WAIT_MS;
    }

    // 5xx server errors — short retry
    if (status && status >= 500) return TRANSIENT_RETRY_WAIT_MS;

    // Network errors — short retry
    if (!error.response && error.code) {
        const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND'];
        if (retryableCodes.includes(error.code)) return TRANSIENT_RETRY_WAIT_MS;
    }

    return 0;
}

const instance = axios.create();

// Guard: when axios is auto-mocked in tests, create() returns undefined
export const fbAxios = instance ?? axios;

if (instance?.interceptors) {
    instance.interceptors.response.use(undefined, async (error: AxiosError) => {
    const cfg = error.config as RetryConfig | undefined;
    if (!cfg) return Promise.reject(error);

    const retryCount = cfg._retryCount ?? 0;
    if (retryCount >= MAX_RETRIES) return Promise.reject(error);

    const waitMs = getRetryDelay(error);
    if (waitMs <= 0) return Promise.reject(error);

    cfg._retryCount = retryCount + 1;
    await sleep(waitMs);
    return instance(cfg);
});
}
