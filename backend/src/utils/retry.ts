/**
 * Retry Utility with Exponential Backoff
 * Use this for external API calls (Facebook, OpenAI) to handle transient failures
 */

import { RetryOptions } from '../types';

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'signal'>> = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableErrors: (error: unknown) => {
        // Retry on network errors and 5xx server errors
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            if (message.includes('network') || 
                message.includes('timeout') || 
                message.includes('econnreset') ||
                message.includes('econnrefused') ||
                message.includes('socket hang up')) {
                return true;
            }
        }
        
        // Check for axios-like error responses
        const axiosError = error as { response?: { status?: number }; code?: string };
        if (axiosError?.response?.status) {
            const status = axiosError.response.status;
            // Retry on 429 (rate limit) and 5xx errors
            return status === 429 || (status >= 500 && status < 600);
        }
        
        // Check for common error codes
        if (axiosError?.code) {
            const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND'];
            return retryableCodes.includes(axiosError.code);
        }
        
        return false;
    },
    onRetry: () => {},
};

/**
 * Sleep for a specified duration with optional abort support
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Retry aborted'));
            return;
        }
        
        const timeout = setTimeout(resolve, ms);
        
        signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Retry aborted'));
        }, { once: true });
    });
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    // Exponential backoff: base * 2^attempt
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    
    // Add jitter (±25%) to prevent thundering herd
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    
    // Clamp to max delay
    return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Execute a function with retry logic and exponential backoff
 * 
 * @example
 * const result = await withRetry(
 *   () => axios.get('https://api.example.com/data'),
 *   { maxAttempts: 3, baseDelayMs: 1000 }
 * );
 * 
 * @example with AbortController
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 5000); // Abort after 5 seconds
 * const result = await withRetry(fn, { signal: controller.signal });
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const { signal, ...restOptions } = options;
    const opts = { ...DEFAULT_OPTIONS, ...restOptions };
    let lastError: unknown;
    
    for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
        // Check if aborted before attempting
        if (signal?.aborted) {
            throw new Error('Retry aborted');
        }
        
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Check if this is the last attempt
            if (attempt >= opts.maxAttempts - 1) {
                throw error;
            }
            
            // Check if error is retryable
            if (!opts.retryableErrors(error)) {
                throw error;
            }
            
            // Calculate delay and wait
            const delayMs = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
            opts.onRetry(attempt + 1, error, delayMs);
            await sleep(delayMs, signal);
        }
    }
    
    // Should not reach here, but TypeScript needs this
    throw lastError;
}

/**
 * Create a retryable version of an async function
 * 
 * @example
 * const retryableFetch = createRetryable(fetchData, { maxAttempts: 3 });
 * const result = await retryableFetch(arg1, arg2);
 */
export function createRetryable<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => Promise<TReturn>,
    options: RetryOptions = {}
): (...args: TArgs) => Promise<TReturn> {
    return (...args: TArgs) => withRetry(() => fn(...args), options);
}
