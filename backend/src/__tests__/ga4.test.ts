/**
 * Tests: GA4 Measurement Protocol client (services/ga4.ts).
 * Verifies:
 *   - missing credentials and a missing client id both SKIP without a network call
 *     (analytics must never fire a half-formed beacon, and MP rejects a payload
 *     with no client_id anyway)
 *   - the happy path posts the documented MP shape to the documented URL
 *   - a non-2xx is contained: reported as a Sentry WARNING, returned as a result,
 *     never thrown into the caller
 *   - a thrown fetch (timeout / DNS) is contained the same way
 *   - debug mode targets the /debug endpoint and surfaces validationMessages —
 *     the ONLY way to learn a payload was malformed, since MP answers 204 for
 *     bad events just as it does for good ones
 *   - sendGa4EventForUser resolves users.ga_client_id, and sends nothing when
 *     the user has none
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { captureErrorMock, selectQueue, ga4Config } = vi.hoisted(() => ({
    captureErrorMock: vi.fn(),
    /** One entry per SELECT issued; shifted in call order. */
    selectQueue: { value: [] as unknown[][] },
    ga4Config: { measurementId: 'G-TEST', apiSecret: 'secret-abc' },
}));

vi.mock('../db', () => {
    const makeSelect = () => {
        const rows = selectQueue.value.shift() ?? [];
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve(rows));
        return chain;
    };
    return { db: { select: vi.fn(() => makeSelect()) } };
});

vi.mock('../db/schema', () => ({ users: { id: 'users.id', gaClientId: 'users.ga_client_id' } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: captureErrorMock }));
vi.mock('../config', () => ({ config: { get ga4() { return ga4Config; } } }));

import {
    sendGa4Event,
    sendGa4EventForUser,
    sendPurchaseConversion,
    isGa4Configured,
} from '../services/ga4';

const fetchMock = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.value = [];
    ga4Config.measurementId = 'G-TEST';
    ga4Config.apiSecret = 'secret-abc';
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
});

describe('sendGa4Event — guards', () => {
    it('skips entirely when credentials are absent', async () => {
        ga4Config.measurementId = '';
        const result = await sendGa4Event('123.456', 'sign_up');
        expect(result).toEqual({ sent: false, reason: 'not_configured' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips when the api secret alone is absent', async () => {
        ga4Config.apiSecret = '';
        expect(isGa4Configured()).toBe(false);
        expect((await sendGa4Event('123.456', 'sign_up')).reason).toBe('not_configured');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips without a client id — MP would reject the payload', async () => {
        for (const missing of [null, undefined, '']) {
            const result = await sendGa4Event(missing, 'sign_up');
            expect(result).toEqual({ sent: false, reason: 'no_client_id' });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('sendGa4Event — transport', () => {
    it('posts the MP payload shape to the collect endpoint', async () => {
        const result = await sendGa4Event('111.222', 'purchase', { value: 8, currency: 'USD' });

        expect(result).toEqual({ sent: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
            'https://www.google-analytics.com/mp/collect?measurement_id=G-TEST&api_secret=secret-abc',
        );
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            client_id: '111.222',
            non_personalized_ads: false,
            events: [{ name: 'purchase', params: { value: 8, currency: 'USD' } }],
        });
    });

    it('contains a non-2xx as a warning and never throws', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

        const result = await sendGa4Event('111.222', 'sign_up');

        expect(result).toEqual({ sent: false, reason: 'http_error' });
        expect(captureErrorMock).toHaveBeenCalledTimes(1);
        expect(captureErrorMock.mock.calls[0][2]).toMatchObject({ level: 'warning' });
    });

    it('contains a thrown fetch (timeout / DNS) and never throws', async () => {
        fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));

        const result = await sendGa4Event('111.222', 'sign_up');

        expect(result).toEqual({ sent: false, reason: 'exception' });
        expect(captureErrorMock.mock.calls[0][2]).toMatchObject({ level: 'warning' });
    });

    it('debug mode hits /debug and returns GA4 validationMessages', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ validationMessages: [{ description: 'bad event name' }] }),
        });

        const result = await sendGa4Event('111.222', 'Bad Name', {}, { debug: true });

        expect(fetchMock.mock.calls[0][0]).toContain('/debug/mp/collect');
        expect(result.validationMessages).toEqual([{ description: 'bad event name' }]);
    });
});

describe('sendGa4EventForUser', () => {
    it('resolves the stored client id and sends with it', async () => {
        selectQueue.value = [[{ gaClientId: '999.888' }]];

        const result = await sendGa4EventForUser('user-1', 'page_connected');

        expect(result).toEqual({ sent: true });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).client_id).toBe('999.888');
    });

    it('sends nothing for a user with no stored client id', async () => {
        selectQueue.value = [[{ gaClientId: null }]];

        expect((await sendGa4EventForUser('user-1', 'page_connected')).reason).toBe('no_client_id');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips the users lookup entirely when GA4 is not configured', async () => {
        ga4Config.apiSecret = '';
        const { db } = await import('../db');

        expect((await sendGa4EventForUser('user-1', 'sign_up')).reason).toBe('not_configured');
        expect(db.select).not.toHaveBeenCalled();
    });
});

describe('sendPurchaseConversion', () => {
    const paid = {
        userId: 'user-1',
        transactionId: 'cs_test_123',
        amountMinorUnits: 800,
        currency: 'usd',
        planId: 'basic',
    };

    it('sends value in MAJOR units with an upper-cased currency and the dedup key', async () => {
        selectQueue.value = [[{ gaClientId: '999.888' }]];

        const result = await sendPurchaseConversion(paid);

        expect(result).toEqual({ sent: true });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.events[0]).toEqual({
            name: 'purchase',
            params: {
                // 800 cents is $8 — the Basic plan. Reporting 800 would tell
                // Smart Bidding this signup was worth a hundred times its price.
                transaction_id: 'cs_test_123',
                value: 8,
                currency: 'USD',
                items: [{ item_id: 'basic', item_name: 'basic', quantity: 1 }],
            },
        });
    });

    // A trial checkout completes with a total of 0. Sending it would inflate the
    // conversion count AND drag value-per-conversion toward zero — the exact
    // input Smart Bidding optimises against.
    it('sends nothing for a zero-amount (free trial) checkout', async () => {
        for (const amountMinorUnits of [0, null, undefined]) {
            const result = await sendPurchaseConversion({ ...paid, amountMinorUnits });
            expect(result).toEqual({ sent: false, reason: 'zero_amount' });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends nothing for a negative amount', async () => {
        const result = await sendPurchaseConversion({ ...paid, amountMinorUnits: -500 });
        expect(result).toEqual({ sent: false, reason: 'zero_amount' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to USD when Stripe reports no currency', async () => {
        selectQueue.value = [[{ gaClientId: '999.888' }]];

        await sendPurchaseConversion({ ...paid, currency: null });

        expect(JSON.parse(fetchMock.mock.calls[0][1].body).events[0].params.currency).toBe('USD');
    });

    it('converts a non-round minor-unit amount without losing cents', async () => {
        selectQueue.value = [[{ gaClientId: '999.888' }]];

        await sendPurchaseConversion({ ...paid, amountMinorUnits: 7999 });

        expect(JSON.parse(fetchMock.mock.calls[0][1].body).events[0].params.value).toBe(79.99);
    });
});
