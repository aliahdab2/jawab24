import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ecommerceApiGet } from '../../src/utils/httpRetry';

// Mock tracing to be a pass-through
vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: vi.fn((_platform: string, _op: string, fn: () => unknown) => fn()),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
    const h = new Headers(headers);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: h,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

describe('ecommerceApiGet', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns parsed JSON on 200', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(200, { data: [1, 2] }));
        const result = await ecommerceApiGet('https://api.example.com/products', {
            platform: 'salla',
            authHeaderValue: 'Bearer token123',
        });
        expect(result).toEqual({ data: [1, 2] });
    });

    it('sends Authorization header by default', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(200, {}));
        await ecommerceApiGet('https://api.example.com/orders', {
            platform: 'salla',
            authHeaderValue: 'Bearer abc',
        });
        expect(mockFetch).toHaveBeenCalledWith(
            'https://api.example.com/orders',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer abc' }),
            }),
        );
    });

    it('sends Zid dual-header auth: default Authorization Bearer + extraHeaders (X-Manager-Token, Role)', async () => {
        // Zid's Merchant API needs two credentials at once — the `Authorization`
        // token via the default auth header, and the access token as X-Manager-Token
        // (plus a Store-Id header on the non-/managers/ store API) via extraHeaders.
        mockFetch.mockResolvedValueOnce(makeResponse(200, {}));
        await ecommerceApiGet('https://api.zid.sa/v1/products/?page_size=100&page=1', {
            platform: 'zid',
            authHeaderValue: 'Bearer zid-authorization-jwt',
            extraHeaders: {
                'X-Manager-Token': 'manager-token-xyz',
                'Store-Id': '3195980',
            },
        });
        expect(mockFetch).toHaveBeenCalledWith(
            'https://api.zid.sa/v1/products/?page_size=100&page=1',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer zid-authorization-jwt',
                    'X-Manager-Token': 'manager-token-xyz',
                    'Store-Id': '3195980',
                }),
            }),
        );
    });

    it('merges extraHeaders on top of the defaults without dropping Authorization or Accept', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(200, {}));
        await ecommerceApiGet('https://api.example.com/things', {
            platform: 'zid',
            authHeaderValue: 'Bearer abc',
            extraHeaders: { 'X-Custom': 'yes' },
        });
        const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
        expect(headers).toMatchObject({
            Authorization: 'Bearer abc',
            Accept: 'application/json',
            'X-Custom': 'yes',
        });
    });

    it('still supports a custom auth header name', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(200, {}));
        await ecommerceApiGet('https://api.example.com/custom', {
            platform: 'salla',
            authHeaderName: 'X-Api-Key',
            authHeaderValue: 'key-123',
        });
        expect(mockFetch).toHaveBeenCalledWith(
            'https://api.example.com/custom',
            expect.objectContaining({
                headers: expect.objectContaining({ 'X-Api-Key': 'key-123' }),
            }),
        );
    });

    it('throws immediately on non-retriable 4xx (not 429)', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(404, { error: 'not found' }));
        await expect(
            ecommerceApiGet('https://api.example.com/products', { platform: 'salla', authHeaderValue: 'Bearer t' }),
        ).rejects.toThrow('salla API HTTP error: 404');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 and succeeds', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(429, {}, { 'retry-after': '1' }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }));

        const promise = ecommerceApiGet('https://api.example.com/products', {
            platform: 'salla',
            authHeaderValue: 'Bearer t',
        });
        await vi.advanceTimersByTimeAsync(5000);
        const result = await promise;
        expect(result).toEqual({ ok: true });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 and succeeds', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(500))
            .mockResolvedValueOnce(makeResponse(200, { items: [] }));

        const promise = ecommerceApiGet('https://api.example.com/products', {
            platform: 'zid',
            authHeaderValue: 'token',
        });
        await vi.advanceTimersByTimeAsync(5000);
        const result = await promise;
        expect(result).toEqual({ items: [] });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retries on persistent 503', async () => {
        mockFetch.mockResolvedValue(makeResponse(503));

        // Chain the rejection handler immediately so Node never sees an unhandled rejection.
        // Then advance timers to drain the backoff delays.
        const assertion = expect(
            ecommerceApiGet('https://api.example.com/products', {
                platform: 'salla',
                authHeaderValue: 'Bearer t',
            }),
        ).rejects.toThrow('salla API 503 after 3 retries');

        // Advance past the max backoff: 3 retries × up to 4s each = 12s
        await vi.advanceTimersByTimeAsync(15000);
        await assertion;

        // 1 initial + 3 retries = 4 calls
        expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('uses retry-after header delay on 429', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(429, {}, { 'retry-after': '3' }))
            .mockResolvedValueOnce(makeResponse(200, { data: 'ok' }));

        const promise = ecommerceApiGet('https://api.example.com/test', {
            platform: 'salla',
            authHeaderValue: 'Bearer t',
        });
        // Should not resolve before 3000ms
        await vi.advanceTimersByTimeAsync(2999);
        // Still pending at 2999ms
        await vi.advanceTimersByTimeAsync(1);
        const result = await promise;
        expect(result).toEqual({ data: 'ok' });
    });
});
