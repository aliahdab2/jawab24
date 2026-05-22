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
    paymentStatus: string;     // paid, pending, refunded, partially_refunded
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
    quantity: number;
    variants?: Array<{ name: string; available: boolean; quantity: number }>;
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

// ===========================================================================
// Catalog Tools (Stage 2.3 of KB restructure)
// ===========================================================================
//
// Entity-centric tools over the merchant-maintained `catalog_items` table.
// Unlike the e-commerce tools above, these do NOT require a linked store —
// they read structured data the merchant entered themselves (courses,
// services, packages, branches, events, products without a Shopify/Salla
// link).
//
// `list_active_entities` bakes in the freshness filter (endsAt > now)
// automatically, so the LLM cannot accidentally recommend expired courses
// (the catalyst incident that drove this whole restructure).
// ===========================================================================

export type CatalogToolName =
    | 'search_entities'
    | 'get_entity_details'
    | 'list_active_entities';

export const VALID_CATALOG_TOOL_NAMES: readonly CatalogToolName[] = [
    'search_entities',
    'get_entity_details',
    'list_active_entities',
];

/** All valid tool names across both pipelines — for one-shot whitelist checks. */
export const ALL_VALID_TOOL_NAMES: readonly (EcommerceToolName | CatalogToolName)[] = [
    ...VALID_TOOL_NAMES,
    ...VALID_CATALOG_TOOL_NAMES,
];

/**
 * Canonical type for a catalog item's category. Mirrors the `type` column on
 * the `catalog_items` table. Adding a new type requires:
 *   1. Extending this union here
 *   2. Adding it to CATALOG_ITEM_TYPES below (for runtime iteration / Zod)
 *   3. Whatever vertical UX the new type implies (Stage 2.6+)
 */
export type CatalogItemType = 'course' | 'product' | 'service' | 'event' | 'branch' | 'package';

/** Runtime-iterable list of the canonical types — for Zod enums, type tab UIs, etc. */
export const CATALOG_ITEM_TYPES: readonly CatalogItemType[] = [
    'course', 'product', 'service', 'event', 'branch', 'package',
] as const;

/**
 * Alias preserved because the AI tool surface names items as "entities"
 * (search_entities, list_active_entities). Prefer `CatalogItemType` in
 * non-tool code.
 */
export type CatalogEntityType = CatalogItemType;

/**
 * Status filter accepted by the catalog list endpoint
 * (GET /catalog-items?status=...). NOT the same as CatalogEntityStatus, which
 * is the per-item computed display state — distinct domains, distinct types.
 */
export type CatalogStatusFilter = 'active' | 'expired' | 'archived' | 'all';

export interface SearchEntitiesArgs {
    query: string;
    type?: CatalogEntityType;
    price_min_minor?: number;
    price_max_minor?: number;
}

export interface GetEntityDetailsArgs {
    id: string;
}

export interface ListActiveEntitiesArgs {
    type?: CatalogEntityType;
    limit?: number;
}

export interface CatalogToolCall {
    name: CatalogToolName;
    arguments: Record<string, string | number | undefined>;
}

/** Status computed at read time from endsAt / archivedAt. */
export type CatalogEntityStatus = 'active' | 'expiring_soon' | 'expired' | 'archived';

/**
 * Window in which a date-bound item is considered "expiring soon" rather than
 * fully active. Shared between backend (tool result `status` field) and
 * frontend (badge variant) — if these drift, the AI and the merchant UI
 * disagree about whether something is expiring.
 */
export const EXPIRING_SOON_DAYS = 7;

/**
 * Single source of truth for catalog-item status derivation. Accepts both
 * Date objects (backend Drizzle rows) and ISO strings (frontend JSON).
 * Pure function, no IO. Tested via the parity test in
 * `packages/shared/src/__tests__/catalog-status.test.ts`.
 */
export function computeCatalogStatus(
    item: { archivedAt?: Date | string | null; endsAt?: Date | string | null },
    now: Date = new Date(),
): CatalogEntityStatus {
    if (item.archivedAt) return 'archived';
    if (!item.endsAt) return 'active';
    const endsAt = item.endsAt instanceof Date ? item.endsAt : new Date(item.endsAt);
    if (endsAt.getTime() <= now.getTime()) return 'expired';
    const msUntilEnd = endsAt.getTime() - now.getTime();
    if (msUntilEnd <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) return 'expiring_soon';
    return 'active';
}

/** Shape returned to the LLM for one catalog item. */
export interface CatalogEntitySummary {
    id: string;
    type: CatalogEntityType;
    name: string;
    description?: string | null;
    priceMinor?: number | null;
    currency?: string | null;
    startsAt?: string | null;          // ISO
    endsAt?: string | null;            // ISO
    enrollmentClosesAt?: string | null; // ISO
    status: CatalogEntityStatus;
}

export interface CatalogEntityDetails extends CatalogEntitySummary {
    metadata?: Record<string, unknown>;
}

/** Same result envelope as e-commerce tools — keeps the tool-loop uniform. */
export type CatalogToolResult = EcommerceToolResult;
