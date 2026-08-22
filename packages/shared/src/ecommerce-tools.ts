/**
 * E-Commerce Agent Tool Types
 *
 * Shared types for the backend-orchestrated tool loop that lets the AI
 * call read-only e-commerce APIs (Shopify, Salla) during conversations.
 *
 * SECURITY MODEL (two-phase verification):
 *   Phase 1: AI calls lookup_order / track_shipment
 *            → Backend returns a verification challenge (NO sensitive data)
 *   Phase 2: Customer provides name/phone → AI calls verify_and_get_order / verify_and_get_shipment
 *            → Backend compares server-side → returns data only if match
 *
 * The AI never sees sensitive data until the backend confirms identity.
 */

// --- Tool Call Types ---

export type EcommerceToolName =
    | 'lookup_order'
    | 'track_shipment'
    | 'check_inventory'
    | 'verify_and_get_order'
    | 'verify_and_get_shipment';

/** Whitelist of valid tool names for validation */
export const VALID_TOOL_NAMES: readonly EcommerceToolName[] = [
    'lookup_order',
    'track_shipment',
    'check_inventory',
    'verify_and_get_order',
    'verify_and_get_shipment',
];

export interface EcommerceToolCall {
    name: EcommerceToolName;
    arguments: Record<string, string>;
}

export interface OrderLookupArgs {
    order_number?: string;
}

export interface ShipmentTrackArgs {
    order_number?: string;
}

export interface InventoryCheckArgs {
    product_name?: string;
    variant?: string; // e.g. "medium", "black"
}

export interface VerifyAndGetArgs {
    order_number: string;
    provided_name?: string;
    provided_phone?: string;
}

// --- Tool Result Types ---

export interface EcommerceToolResult {
    tool_name: string;
    success: boolean;
    data?: Record<string, unknown>;
    error?: string; // 'order_not_found', 'product_not_found', 'insufficient_permissions', 'api_error', 'verification_failed'
}

// --- Normalized Data Types (platform-agnostic) ---

/**
 * Phase 1 response for lookup_order / track_shipment.
 * Contains NO sensitive data — only confirms the order exists
 * and tells the AI to ask the customer for verification.
 */
export interface PendingVerification {
    orderFound: true;
    orderNumber: string;
    message: string; // "Order found. Ask the customer for the name on the order or the phone number used when ordering to verify their identity."
}

/** Order data returned by verify_and_get_order (Phase 2, AFTER server-side verification). */
export interface OrderInfo {
    orderNumber: string;
    status: string;            // pending, paid, shipped, delivered, cancelled, refunded
    orderDate: string;         // ISO string
    items: Array<{ name: string; quantity: number; price: string }>;
    totalAmount: string;
    currency: string;
    paymentStatus: string;     // paid, pending, refunded, partially_refunded; 'unknown' when the platform doesn't expose it (Zid, until its payment field is capture-confirmed)
    refundAmount?: string;
    shippingCity?: string;
    shippingDistrict?: string;
}

/** Shipment data returned by verify_and_get_shipment (Phase 2, AFTER server-side verification). */
export interface ShipmentInfo {
    orderNumber: string;
    status: string;            // in_transit, delivered, out_for_delivery, etc.
    trackingNumber?: string;
    courierName?: string;
    trackingUrl?: string;
    estimatedDelivery?: string; // ISO string or human-readable
    shippingCity?: string;
}

/** Inventory data returned by check_inventory tool. No verification needed. */
export interface InventoryInfo {
    productName: string;
    available: boolean;
    /**
     * Units in stock. OMITTED when the platform reports the product as
     * untracked/unlimited (Zid `is_infinite: true`) — an unlimited product has
     * no meaningful number, and `0` alongside `available: true` hands the AI a
     * contradiction it resolves as "out of stock".
     */
    quantity?: number;
    variants?: Array<{ name: string; available: boolean; quantity?: number }>;
    price?: string;
    currency?: string;
    productUrl?: string;
}

// --- Internal types (used by backend only, never sent to AI) ---

/** Full order data including PII — stored server-side for verification, never exposed to AI */
export interface OrderInfoFull extends OrderInfo {
    customerFirstName: string; // for server-side name comparison
    customerPhone?: string;    // for server-side phone comparison
}

/** Full shipment data including PII — stored server-side for verification, never exposed to AI */
export interface ShipmentInfoFull extends ShipmentInfo {
    customerFirstName: string; // for server-side name comparison
    customerPhone?: string;    // for server-side phone comparison
}
