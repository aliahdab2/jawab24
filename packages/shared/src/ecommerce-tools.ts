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
 *
 * `find_order_by_phone` is the same model in ONE call for the customer who does
 * not have their order number (D-101): it REQUIRES phone AND name together, and
 * the backend re-verifies both against the order it found. The platform's own
 * phone search is never the gate — Zid's `search_term` also matches names and
 * order codes, so an unverified hit there is not proof of anything.
 */

// --- Tool Call Types ---

export type EcommerceToolName =
    | 'lookup_order'
    | 'track_shipment'
    | 'check_inventory'
    | 'verify_and_get_order'
    | 'verify_and_get_shipment'
    | 'find_order_by_phone';

/** Whitelist of valid tool names for validation */
export const VALID_TOOL_NAMES: readonly EcommerceToolName[] = [
    'lookup_order',
    'track_shipment',
    'check_inventory',
    'verify_and_get_order',
    'verify_and_get_shipment',
    'find_order_by_phone',
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
    /** The platform product id shown after `ID:` in a `[product: …]` entry. Preferred when listed. */
    product_id?: string;
    /** The customer's wording, when no id is available. Resolved in code (D-092), never by the model. */
    product_name?: string;
    variant?: string; // e.g. "medium", "black"
}

// --- Stock vocabulary (the ONE copy of the null-first ladder) ---

/**
 * Statuses a customer may hear about. Everything the model sees — the inline
 * catalog block, the KB product chunks, the resolver's candidates, the page's
 * re-ingest input — reads through this one list, so a sold-out product stays
 * VISIBLE as "out of stock" instead of vanishing into "we don't sell that"
 * (the pre-D-092 behaviour, when every reader filtered `status = 'active'`).
 * `hidden` / `draft` / `archived` stay invisible.
 */
export const SELLABLE_STATUSES: readonly string[] = ['active', 'out_of_stock'];

/** At or below this many tracked units a product reads as "low stock". */
export const LOW_STOCK_UNITS = 5;

export type StockAvailability = 'in_stock' | 'low_stock' | 'out_of_stock';

/**
 * The null-first stock ladder, in one place.
 *
 * `totalInventory === null` means untracked/unlimited (Zid `is_infinite`, Shopify
 * untracked) and is checked FIRST: `null <= 5` is true in JavaScript, and the
 * three hand-written copies this replaced (catalog block, KB chunker, card
 * builder) each had to remember that independently. A platform-level
 * `out_of_stock` status wins over any count — Salla reports `out` with the
 * quantity still on the row.
 */
export function availabilityOf(product: { totalInventory: number | null; status?: string | null }): StockAvailability {
    if (product.status === 'out_of_stock') return 'out_of_stock';
    if (product.totalInventory === null) return 'in_stock';
    if (product.totalInventory <= 0) return 'out_of_stock';
    if (product.totalInventory <= LOW_STOCK_UNITS) return 'low_stock';
    return 'in_stock';
}

/** One of the products a name could mean. Returned on `ambiguous_product` so the model can ask, never pick. */
export interface InventoryCandidate {
    platformProductId: string;
    title: string;
    availability: StockAvailability;
    price?: string;
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
    error?: string; // 'order_not_found', 'product_not_found', 'ambiguous_product', 'insufficient_permissions', 'api_error', 'verification_failed'
    /**
     * Present only with `error: 'ambiguous_product'` — the ≤3 products the
     * customer's words could mean. The model lists them and asks; it never
     * picks one (D-051: identity is decided in code).
     */
    candidates?: InventoryCandidate[];
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

/**
 * Inventory data returned by check_inventory. No verification needed.
 *
 * Identity travels with it (D-092): `platformProductId` is what the card
 * builder and any later call key on, so nothing downstream re-resolves the
 * product by name — a second, different matcher was how a card could show a
 * product the answer never named.
 */
export interface InventoryInfo {
    /** The platform's own product id — the key for cards, by-id follow-ups and the stock cache. */
    platformProductId: string;
    productName: string;
    available: boolean;
    /** Three-way stock state from the shared ladder; `available` is derived from it. */
    availability: StockAvailability;
    /**
     * Units in stock. OMITTED when the platform reports the product as
     * untracked/unlimited (Zid `is_infinite: true`) — an unlimited product has
     * no meaningful number, and `0` alongside `available: true` hands the AI a
     * contradiction it resolves as "out of stock".
     */
    quantity?: number;
    /** Per-variant stock — only a LIVE platform read knows it; a local answer carries `variantSummary` instead. */
    variants?: Array<{ name: string; available: boolean; quantity?: number }>;
    /** The catalog's variant line ("S, M, L in Black, White") when no per-variant stock is known. */
    variantSummary?: string;
    /** Display price as the catalog shows it, currency INCLUDED ("10000 SAR", "3,800 - 4,500 SAR"). Printed as-is; never append `currency` to it. */
    price?: string;
    currency?: string;
    productUrl?: string;
    imageUrl?: string;
    handle?: string;
    /**
     * `local` = answered from the synced catalog row; `live` = the platform was
     * asked by id because the local answer was risky (≤ LOW_STOCK_UNITS tracked
     * units and the sync is stale). A platform failure degrades to `local`,
     * never to a wrong product.
     */
    source: 'local' | 'live';
    /**
     * ISO timestamp the stock figure is as of: the row's last sync for `local`,
     * now for `live`. ABSENT when the store has never synced — never a
     * placeholder date, which the model would read out to the customer.
     */
    asOf?: string;
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

/**
 * The tools that consume a phone number the customer typed as an IDENTITY CLAIM,
 * not as a contact detail: the two Phase-2 verifiers and the D-101 one-call
 * lookup. A turn that executed any of them answered "prove the order is yours" —
 * the number in it belongs to an order the customer already placed.
 *
 * Lead capture reads this to stay out of that turn (see `maybeCaptureLead`):
 * someone verifying an existing order is not a prospect, and recording them as
 * one puts an existing buyer in the merchant's "potential customers" list with a
 * new-lead push behind it. `lookup_order` / `track_shipment` are deliberately
 * ABSENT — Phase 1 carries only an order number, so a phone in that same message
 * was volunteered for contact and must still become a lead.
 */
export const IDENTITY_VERIFICATION_TOOLS: readonly EcommerceToolName[] = [
    'verify_and_get_order',
    'verify_and_get_shipment',
    'find_order_by_phone',
];

/**
 * Did this reply's tool round consume the customer's phone as an identity claim?
 *
 * Reads the executed tool names, so it is same-turn and cannot mistake a phone
 * typed for any other reason. Outcome is deliberately ignored: a FAILED
 * verification (wrong number) still means the number was submitted to prove
 * ownership of an order, never as a lead's contact line.
 */
export function isIdentityVerificationTurn(
    toolOutcomes?: readonly { name: string }[],
): boolean {
    if (!toolOutcomes?.length) return false;
    return toolOutcomes.some(o => (IDENTITY_VERIFICATION_TOOLS as readonly string[]).includes(o.name));
}
