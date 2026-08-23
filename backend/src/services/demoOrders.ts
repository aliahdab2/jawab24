/**
 * Demo orders — what the order tools answer on a demo-seeded store.
 *
 * Demo stores (plugins/demo/seedData.ts, `platformData.demo: true`) hold placeholder
 * tokens that are not real ciphertext, so they can never reach a platform API.
 * `check_inventory` already answers them locally (readStock, D-092); until this
 * module existed the ORDER tools had no local answer at all, so every demo-store
 * order question failed inside decrypt() — and the eval could not exercise
 * lookup_order / track_shipment / verify_and_get_* (Rule 19 needs a fixture the
 * harness can hit). Nothing here is persisted: the rows are constants keyed by
 * order number, shared by every demo store regardless of platform.
 *
 * Identity for the verification step: first name «أحمد», phone +966500000001 —
 * the same synthetic range the demo conversations use.
 */
import type { OrderInfoFull, ShipmentInfoFull } from '@jawab24/shared';

export const DEMO_ORDER_CUSTOMER = { firstName: 'أحمد', phone: '+966500000001' } as const;

interface DemoOrder {
    order: OrderInfoFull;
    shipment: ShipmentInfoFull | null;
}

const identity = { customerFirstName: DEMO_ORDER_CUSTOMER.firstName, customerPhone: DEMO_ORDER_CUSTOMER.phone };

/** Keyed by the sanitized order number (digits only, no '#'). */
export const DEMO_ORDERS: Readonly<Record<string, DemoOrder>> = {
    // Shipped and on its way — the tracking case.
    '1001': {
        order: {
            ...identity,
            orderNumber: '1001',
            status: 'shipped',
            orderDate: '2026-08-20T09:15:00.000Z',
            items: [{ name: 'عباية كلاسيك سوداء — M', quantity: 1, price: '450' }],
            totalAmount: '450',
            currency: 'SAR',
            paymentStatus: 'paid',
            shippingCity: 'الرياض',
        },
        shipment: {
            ...identity,
            orderNumber: '1001',
            status: 'in_transit',
            trackingNumber: 'DEMO-SMSA-784512',
            courierName: 'SMSA Express',
            trackingUrl: 'https://www.smsaexpress.com/track/DEMO-SMSA-784512',
            estimatedDelivery: '2026-08-25',
            shippingCity: 'الرياض',
        },
    },
    // Paid, not yet shipped — the "no tracking yet" case.
    '1002': {
        order: {
            ...identity,
            orderNumber: '1002',
            status: 'paid',
            orderDate: '2026-08-22T18:40:00.000Z',
            items: [{ name: 'عطر عود ملكي 100ml', quantity: 2, price: '350' }],
            totalAmount: '700',
            currency: 'SAR',
            paymentStatus: 'paid',
            shippingCity: 'جدة',
        },
        shipment: null,
    },
};

/** The PlatformModule shape the tool executor expects, served from the constants above. */
export const demoOrderModule = {
    async lookupOrder(_storeId: string, orderNumber: string): Promise<OrderInfoFull | null> {
        return DEMO_ORDERS[orderNumber]?.order ?? null;
    },
    async getShipmentTracking(_storeId: string, orderNumber: string): Promise<ShipmentInfoFull | null> {
        return DEMO_ORDERS[orderNumber]?.shipment ?? null;
    },
    // Product reads never reach here: readStock returns before the platform on a demo store.
    async getProductById(): Promise<null> {
        return null;
    },
};
