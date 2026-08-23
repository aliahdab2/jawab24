/**
 * Demo stores answer the ORDER tools from constants — they hold placeholder tokens
 * and can never reach a platform. Before demoOrders existed every demo-store order
 * question died inside decrypt(), so the eval could not exercise lookup_order /
 * track_shipment / verify_and_get_* at all (Rule 19).
 *
 * Mutation checks:
 *   - route demo stores to the real platform module → "never imports" fails
 *   - drop the shipment for 1001                     → the tracking test fails
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from '../../src/services/ecommerceActions';
import { DEMO_ORDERS, DEMO_ORDER_CUSTOMER, demoOrderModule } from '../../src/services/demoOrders';

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: (...args: unknown[]) => mockRedisGet(...args),
        set: (...args: unknown[]) => mockRedisSet(...args),
        incr: vi.fn().mockResolvedValue(1),
    },
}));

const mockGetStoreById = vi.fn();
vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    writeBackProductStock: vi.fn(),
    buildProductUrl: vi.fn(),
}));
vi.mock('../../src/services/reply/productResolver', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/reply/productResolver')>();
    return { ...actual, resolveProduct: vi.fn(), recordResolverOutcome: vi.fn() };
});
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/lib/dailyCap', () => ({ claimDailyOnce: vi.fn().mockResolvedValue(true) }));

// A demo store must never touch these — a placeholder token makes decrypt() throw.
const mockPlatformLookup = vi.fn(() => { throw new Error('demo store reached the platform'); });
vi.mock('../../src/services/salla', () => ({
    lookupOrder: (...a: unknown[]) => mockPlatformLookup(...a),
    getShipmentTracking: (...a: unknown[]) => mockPlatformLookup(...a),
    getProductById: vi.fn(),
}));

const STORE = 'demo-store';
const demoSalla = { id: STORE, platform: 'salla', isActive: true, platformData: { merchant_id: 'demo', demo: true } };

beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockGetStoreById.mockResolvedValue(demoSalla);
});

describe('demoOrderModule', () => {
    it('serves the seeded order and its shipment by order number, and nothing for unknown numbers', async () => {
        expect(await demoOrderModule.lookupOrder(STORE, '1001')).toMatchObject({ orderNumber: '1001', status: 'shipped' });
        expect(await demoOrderModule.getShipmentTracking(STORE, '1001')).toMatchObject({ trackingNumber: DEMO_ORDERS['1001'].shipment?.trackingNumber });
        expect(await demoOrderModule.getShipmentTracking(STORE, '1002')).toBeNull();
        expect(await demoOrderModule.lookupOrder(STORE, '9999')).toBeNull();
    });

    it('every seeded order carries the verification identity', () => {
        for (const { order, shipment } of Object.values(DEMO_ORDERS)) {
            expect(order.customerFirstName).toBe(DEMO_ORDER_CUSTOMER.firstName);
            expect(order.customerPhone).toBe(DEMO_ORDER_CUSTOMER.phone);
            if (shipment) expect(shipment.customerFirstName).toBe(DEMO_ORDER_CUSTOMER.firstName);
        }
    });
});

describe('executeToolCall on a demo store', () => {
    it('answers lookup_order from the constants and never imports the platform', async () => {
        const result = await executeToolCall(STORE, { name: 'lookup_order', arguments: { order_number: '#1001' } });

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('orderFound', true);
        expect(mockPlatformLookup).not.toHaveBeenCalled();
    });

    it('runs the full two-phase flow: the demo customer gets their tracking number', async () => {
        // Phase 1 parks the blob; this mock plays Redis back for Phase 2.
        const parked: Record<string, string> = {};
        mockRedisSet.mockImplementation(async (k: string, v: string) => { parked[k] = v; return 'OK'; });
        mockRedisGet.mockImplementation(async (k: string) => parked[k] ?? null);

        await executeToolCall(STORE, { name: 'lookup_order', arguments: { order_number: '1001' } });
        const result = await executeToolCall(STORE, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1001', provided_name: DEMO_ORDER_CUSTOMER.firstName },
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('trackingNumber', DEMO_ORDERS['1001'].shipment?.trackingNumber);
        expect(result.data).toHaveProperty('courierName');
        expect(result.data).not.toHaveProperty('customerPhone');
        expect(mockPlatformLookup).not.toHaveBeenCalled();
    });

    it('refuses a wrong name exactly as a real store would', async () => {
        const result = await executeToolCall(STORE, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1001', provided_name: 'فاطمة' },
        });
        expect(result.error).toBe('verification_failed');
    });
});
