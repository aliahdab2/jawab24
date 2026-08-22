import { tracedExternalCall } from './tracing';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
// 30 s — same ceiling used across all e-commerce API calls (also imported by the
// Shopify GraphQL client, which has its own retry loop for GraphQL cost throttling).
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Options for `ecommerceApiGet`.
 */
export interface EcommerceApiGetOptions {
    /** Platform label used for tracing spans (e.g. "salla", "zid"). */
    platform: string;
    /**
     * Auth header value — the *entire* header value string, e.g.:
     * - Salla: `"Bearer <token>"`
     * - Zid:   `"Bearer <authorization token>"` (its second credential rides in
     *   `extraHeaders` as `X-Manager-Token` — dual-header auth)
     */
    authHeaderValue: string;
    /**
     * Which HTTP header name carries the auth token.
     * Defaults to `"Authorization"`.
     */
    authHeaderName?: string;
    /**
     * Additional headers merged into the request AFTER the auth header. Zid's
     * Merchant API needs two credentials at once (`Authorization: Bearer` +
     * `X-Manager-Token`, plus a `Store-Id` header on the non-`/managers/` store
     * API) — a single auth header cannot express that.
     */
    extraHeaders?: Record<string, string>;
}

/**
 * Perform a GET request against an e-commerce REST API with exponential-backoff
 * retry on 429 / 5xx responses.
 *
 * Both Salla and Zid share the same retry loop — the only difference is the auth
 * header name/value, which is supplied via `options`.
 *
 * @throws When all retries are exhausted or the response is a non-retriable error.
 */
export async function ecommerceApiGet<T = unknown>(
    url: string,
    options: EcommerceApiGetOptions,
): Promise<T> {
    const { platform, authHeaderValue, authHeaderName = 'Authorization', extraHeaders } = options;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
            response = await tracedExternalCall(platform, 'apiGet', () =>
                fetch(url, {
                    method: 'GET',
                    headers: {
                        [authHeaderName]: authHeaderValue,
                        'Accept': 'application/json',
                        ...extraHeaders,
                    },
                    signal: controller.signal,
                }),
            );
        } finally {
            clearTimeout(timeoutId);
        }

        // Retry on 429 (rate limit) or 5xx (server error)
        if (response.status === 429 || response.status >= 500) {
            const retryAfter = response.headers.get('retry-after');
            const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
            const delayMs = Number.isFinite(parsed) && parsed > 0
                ? parsed * 1000
                : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, delayMs));
                continue;
            }
            lastError = new Error(`${platform} API ${response.status} after ${MAX_RETRIES} retries`);
            break;
        }

        if (!response.ok) {
            throw new Error(`${platform} API HTTP error: ${response.status}`);
        }

        return await response.json() as T;
    }

    throw lastError || new Error(`${platform} API request failed`);
}
