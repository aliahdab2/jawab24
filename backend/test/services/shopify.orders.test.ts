import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockGetStoreById, mockDecrypt } = vi.hoisted(() => ({
    mockGetStoreById: vi.fn(),
    mockDecrypt: vi.fn(),
}));

// --- vi.mock() calls ---

vi.mock('../../src/config', () => ({
    config: {
        shopify: {
            apiKey: 'test_api_key',
            apiSecret: 'test_api_secret',
            scopes: 'read_products,read_content',
            hostName: 'jawab24.com',
        },
    },
}));

vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: vi.fn((_service, _op, fn) => fn()),
}));

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    PRODUCT_SAFETY_CAP: 5000,
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    decrypt: (...args: unknown[]) => mockDecrypt(...args),
    encryptOptional: vi.fn(() => ({})),
    decryptOptional: (...args: unknown[]) => (args[0] && args[1] ? mockDecrypt(...args) : undefined),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { scan: vi.fn(), del: vi.fn(), get: vi.fn(), set: vi.fn() },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// --- Import after mocks ---

import { lookupOrder, getShipmentTracking, checkInventory, getOrderNotificationTarget } from '../../src/services/shopify';

// --- Helpers ---

function makeStore(overrides: Record<string, unknown> = {}) {
    return {
        id: 'store-1',
        platform: 'shopify',
        storeDomain: 'test-store.myshopify.com',
        accessToken: 'enc_access_token',
        accessTokenIv: 'access_iv',
        isActive: true,
        storeCurrency: 'SAR',
        ...overrides,
    };
}

describe('Shopify — lookupOrder / getShipmentTracking / checkInventory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetStoreById.mockResolvedValue(makeStore());
        mockDecrypt.mockReturnValue('shpat_test_token');
    });

    // ============================================================
    // lookupOrder
    // ============================================================

    describe('lookupOrder', () => {
        it('returns mapped order info when order is found', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: {
                        orders: {
                            edges: [{
                                node: {
                                    name: '#1234',
                                    createdAt: '2026-01-15T10:00:00Z',
                                    displayFinancialStatus: 'PAID',
                                    displayFulfillmentStatus: 'FULFILLED',
                                    totalPriceSet: { shopMoney: { amount: '199.00', currencyCode: 'SAR' } },
                                    lineItems: {
                                        edges: [{
                                            node: {
                                                title: 'Widget',
                                                quantity: 2,
                                                originalUnitPriceSet: { shopMoney: { amount: '99.50', currencyCode: 'SAR' } },
                                            },
                                        }],
                                    },
                                    shippingAddress: { city: 'Riyadh', province: 'Riyadh Province' },
                                    customer: { firstName: 'Ahmed', phone: '+966512345678' },
                                    refunds: [],
                                },
                            }],
                        },
                    },
                }),
            });

            const result = await lookupOrder('store-1', '1234');

            expect(result).not.toBeNull();
            expect(result?.orderNumber).toBe('1234'); // '#' stripped
            expect(result?.customerFirstName).toBe('Ahmed');
            expect(result?.status).toBe('shipped'); // FULFILLED → shipped
            expect(result?.paymentStatus).toBe('paid');
            expect(result?.totalAmount).toBe('199.00');
            expect(result?.currency).toBe('SAR');
            expect(result?.shippingCity).toBe('Riyadh');
            expect(result?.items).toHaveLength(1);
            expect(result?.items[0].name).toBe('Widget');
        });

        it('returns null when order is not found', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: { orders: { edges: [] } },
                }),
            });

            const result = await lookupOrder('store-1', '99999');

            expect(result).toBeNull();
        });
    });

    // ============================================================
    // getShipmentTracking
    // ============================================================

    describe('getShipmentTracking', () => {
        it('returns shipment tracking info when order has a fulfillment', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: {
                        orders: {
                            edges: [{
                                node: {
                                    name: '#1234',
                                    displayFulfillmentStatus: 'FULFILLED',
                                    shippingAddress: { city: 'Jeddah' },
                                    customer: { firstName: 'Ahmed', phone: '+966512345678' },
                                    fulfillments: [{
                                        status: 'success',
                                        estimatedDeliveryAt: '2026-01-20T00:00:00Z',
                                        trackingInfo: [{
                                            number: 'TRK-SHP-001',
                                            url: 'https://track.aramex.com/TRK-SHP-001',
                                            company: 'Aramex',
                                        }],
                                    }],
                                },
                            }],
                        },
                    },
                }),
            });

            const result = await getShipmentTracking('store-1', '1234');

            expect(result).not.toBeNull();
            expect(result?.orderNumber).toBe('1234');
            expect(result?.trackingNumber).toBe('TRK-SHP-001');
            expect(result?.courierName).toBe('Aramex');
            expect(result?.trackingUrl).toBe('https://track.aramex.com/TRK-SHP-001');
            expect(result?.status).toBe('shipped'); // FULFILLED → shipped
            expect(result?.shippingCity).toBe('Jeddah');
        });
    });

    // ============================================================
    // checkInventory
    // ============================================================

    describe('checkInventory', () => {
        it('returns inventory info for a matching product', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: {
                        products: {
                            edges: [{
                                node: {
                                    title: 'Phone Case',
                                    handle: 'phone-case',
                                    totalInventory: 25,
                                    priceRangeV2: { minVariantPrice: { amount: '49.00', currencyCode: 'SAR' } },
                                    variants: {
                                        edges: [{
                                            node: {
                                                title: 'Default Title',
                                                inventoryQuantity: 25,
                                                selectedOptions: [{ name: 'Title', value: 'Default Title' }],
                                            },
                                        }],
                                    },
                                },
                            }],
                        },
                    },
                }),
            });

            const result = await checkInventory('store-1', 'Phone Case');

            expect(result).not.toBeNull();
            expect(result?.productName).toBe('Phone Case');
            expect(result?.available).toBe(true);
            expect(result?.quantity).toBe(25);
            expect(result?.price).toBe('49.00 SAR');
            expect(result?.currency).toBe('SAR');
            expect(result?.productUrl).toBe('https://test-store.myshopify.com/products/phone-case');
        });
    });

    // ============================================================
    // getOrderNotificationTarget (used by the fulfillments/update delivery webhook)
    // ============================================================

    describe('getOrderNotificationTarget', () => {
        it('resolves order number + customer phone + first name from the order id', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: { order: { name: '#1234', phone: null, customer: { firstName: 'Ahmed', phone: '+966512345678' } } },
                }),
            });

            const result = await getOrderNotificationTarget('store-1', 964176593);

            expect(result).toEqual({ orderNumber: '1234', phone: '+966512345678', firstName: 'Ahmed' });
            // The numeric id is interpolated into the GraphQL global id.
            const sentQuery = (mockFetch.mock.calls[0][1] as { body: string }).body;
            expect(sentQuery).toContain('gid://shopify/Order/964176593');
        });

        it('falls back to the order-level phone when the customer has none', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: { order: { name: '#77', phone: '+966500000000', customer: { firstName: 'Sara', phone: null } } },
                }),
            });

            const result = await getOrderNotificationTarget('store-1', 42);
            expect(result?.phone).toBe('+966500000000');
        });

        it('returns null when the order is not found', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { order: null } }) });
            expect(await getOrderNotificationTarget('store-1', 42)).toBeNull();
        });
    });

    // ============================================================
    // GraphQL cost-based throttling (HTTP 200 + errors[].extensions.code === 'THROTTLED')
    // ============================================================

    describe('THROTTLED handling', () => {
        it('backs off and retries on a THROTTLED response, then succeeds', async () => {
            vi.useFakeTimers();
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
                        extensions: { cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } },
                    }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ data: { order: { name: '#1234', phone: null, customer: { firstName: 'Ahmed', phone: '+966512345678' } } } }),
                });

            const promise = getOrderNotificationTarget('store-1', 964176593);
            await vi.runAllTimersAsync();
            const result = await promise;

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(result?.orderNumber).toBe('1234');
            vi.useRealTimers();
        });

        it('throws after exhausting retries when THROTTLED never clears', async () => {
            vi.useFakeTimers();
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }),
            });

            const promise = getOrderNotificationTarget('store-1', 964176593);
            const expectation = expect(promise).rejects.toThrow(/THROTTLED after 3 retries/);
            await vi.runAllTimersAsync();
            await expectation;

            expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
            vi.useRealTimers();
        });
    });
});
