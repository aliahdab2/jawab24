/**
 * Unified E-Commerce Tool Executor
 *
 * Platform-agnostic executor that routes AI tool calls to the correct
 * e-commerce platform service (Shopify, Salla). Handles caching, error
 * normalization, input sanitization, and graceful degradation.
 *
 * SECURITY:
 * - Two-phase verification: lookup_order/track_shipment return only a
 *   verification challenge. verify_and_get_* does server-side comparison
 *   and only then returns sensitive data. The comparison (namesMatch /
 *   phonesMatch) is the gate; the Phase-1 pending blob in Redis is only a
 *   saved platform call, never a precondition — see handleVerification.
 * - Input sanitization: order numbers must be numeric, product names are
 *   length-limited and special chars stripped.
 * - Store ownership checked by caller (ecommerceToolLoop.ts).
 */
import crypto from 'crypto';
import {
    VALID_TOOL_NAMES,
    LOW_STOCK_UNITS,
    availabilityOf,
    type EcommerceToolCall, type EcommerceToolResult,
    type OrderInfoFull, type ShipmentInfoFull, type PendingVerification,
    type InventoryInfo, type EcommerceProduct,
} from '@jawab24/shared';
import {
    getStoreById, writeBackProductStock, productUrlFor,
    type PlatformProductDetail,
} from './ecommerce';
import { isDemoStore } from './demoStore';
import { demoOrderModule } from './demoOrders';
import { resolveProduct, sanitizeProductId, recordResolverOutcome } from './reply/productResolver';
import { redis } from '../lib/redis';
import { claimDailyOnce } from '../lib/dailyCap';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types/logger';

const CACHE_TTL_SECONDS = 300; // 5 minutes
/**
 * How long a Phase-1 blob waits in Redis for the customer's identity answer.
 * Expiry is NOT customer-facing: a Phase-2 call that finds no blob re-reads the
 * order from the platform (handleVerification), so a reply that arrives after
 * this window costs one platform call instead of failing.
 */
const VERIFICATION_TTL_SECONDS = 600;
const PRODUCT_NAME_MAX_LENGTH = 200;
const VARIANT_MAX_LENGTH = 60;
/**
 * Minutes after which a synced stock figure counts as stale (D-092 decision 1).
 * A live platform read happens only for a TRACKED product at or below
 * LOW_STOCK_UNITS whose store synced longer ago than this — the one case where
 * a stale "3 left" can turn into "sold out" between syncs. Env-overridable.
 */
export const STOCK_REFRESH_MIN = Math.max(1, parseInt(process.env.STOCK_REFRESH_MIN || '10', 10) || 10);
const STOCK_CACHE_TTL_SECONDS = STOCK_REFRESH_MIN * 60;

/** What the tool loop knows about the reply it is serving — lets the resolver reuse its work. */
export interface ToolExecutionContext {
    pageId?: string | null;
    kbActiveVersion?: number | null;
    /** The customer's message's own embedding — never an enriched (history-laden) one; see ecommerceToolLoop. */
    queryEmbedding?: number[] | null;
    userId?: string | null;
    /** The reply's request logger, so a resolver decision can be read back from the logs. */
    logger?: Logger;
}

// --- Input Sanitization ---

/** Validate and sanitize order number: must be 1-20 digits, optional leading # */
export function sanitizeOrderNumber(raw: string): string | null {
    const cleaned = raw.trim().replace(/^#/, '');
    // Only allow digits (and optional hyphens for some platforms)
    if (!/^\d[\d-]{0,19}$/.test(cleaned)) return null;
    return cleaned;
}

/** Sanitize product name: alphanumeric + common chars, max 200 chars */
export function sanitizeProductName(raw: string): string | null {
    const cleaned = raw.trim().slice(0, PRODUCT_NAME_MAX_LENGTH);
    if (cleaned.length === 0) return null;
    // Strip control characters and obvious injection chars but allow
    // Arabic, Latin, digits, spaces, hyphens, parentheses
    return cleaned.replace(/[<>{}[\]\\"`]/g, '');
}

/** Sanitize phone: digits, optional leading + */
export function sanitizePhone(raw: string): string | null {
    const cleaned = raw.trim().replace(/[\s()-]/g, '');
    if (!/^\+?\d{7,15}$/.test(cleaned)) return null;
    return cleaned;
}

/** Sanitize a variant hint ("medium", "أسود"): same character policy as product names, shorter cap. Was passed through raw before D-092. */
export function sanitizeVariant(raw: string | undefined): string | undefined {
    const cleaned = (raw ?? '').trim().slice(0, VARIANT_MAX_LENGTH).replace(/[<>{}[\]\\"`]/g, '');
    return cleaned.length > 0 ? cleaned : undefined;
}

/** The arguments a tool call is actually executed with — what the cache key must be built from, not the model's raw text. */
function sanitizedArgsOf(toolCall: EcommerceToolCall): Record<string, string> {
    const a = toolCall.arguments;
    const out: Record<string, string> = {};
    const orderNumber = sanitizeOrderNumber(a.order_number || '');
    if (orderNumber) out.order_number = orderNumber;
    const productId = sanitizeProductId(a.product_id);
    if (productId) out.product_id = productId;
    const productName = sanitizeProductName(a.product_name || '');
    if (productName) out.product_name = productName;
    const variant = sanitizeVariant(a.variant);
    if (variant) out.variant = variant;
    if (a.provided_name?.trim()) out.provided_name = a.provided_name.trim();
    const phone = sanitizePhone(a.provided_phone || '');
    if (phone) out.provided_phone = phone;
    return out;
}

// --- Verification Helpers ---

/** Compare a stored name against a customer-provided name for identity verification.
 *  Matches on a full first-name TOKEN, not a prefix: "محمد العلي" matches "محمد", but
 *  "mo" does NOT match "mohammed". A prefix match let an attacker who knew an order
 *  number pass verification by guessing a 2-char prefix of a common first name and
 *  read another customer's order PII (name+order combine with OR, so name alone is a
 *  full bypass). Requires >=2 chars as a floor. */
export function namesMatch(stored: string, provided: string): boolean {
    const s = stored.toLowerCase().trim();
    const p = provided.toLowerCase().trim();
    if (!s || !p || p.length < 2) return false;
    // Exact match on the whole stored name.
    if (s === p) return true;
    // First-name match: the provided value equals the stored name's first token, or
    // vice versa (customer gives only their first name, or their full name).
    const firstToken = (name: string): string => name.split(/\s+/)[0];
    return firstToken(s) === p || firstToken(p) === s;
}

/** Normalize phone for comparison: strip country code prefix, compare last 9 digits */
export function phonesMatch(stored: string, provided: string): boolean {
    // Extract last 9+ digits from each
    const digits = (s: string) => s.replace(/\D/g, '').slice(-9);
    const s = digits(stored);
    const p = digits(provided);
    if (s.length < 7 || p.length < 7) return false;
    return s === p;
}

/**
 * The two shapes an order question can take. `lookup_order` / `verify_and_get_order`
 * work in the `order` family, `track_shipment` / `verify_and_get_shipment` in the
 * `shipment` family. The model does not reliably stay inside one family across the
 * two customer turns a verification spans (Phase 2 is a new request with only text
 * history), so every Phase-2 read must tolerate the other family's blob.
 */
type OrderFamily = 'order' | 'shipment';
type OrderBlob = OrderInfoFull | ShipmentInfoFull;

const SIBLING_FAMILY: Record<OrderFamily, OrderFamily> = { order: 'shipment', shipment: 'order' };
const VERIFY_TOOL_OF: Record<OrderFamily, EcommerceToolCall['name']> = {
    order: 'verify_and_get_order',
    shipment: 'verify_and_get_shipment',
};

function familyOfVerifyTool(toolName: EcommerceToolCall['name']): OrderFamily {
    return toolName === 'verify_and_get_order' ? 'order' : 'shipment';
}

/** Redis key for pending verification data */
function pendingVerificationKey(storeId: string, orderNumber: string, family: OrderFamily): string {
    return `ecom:pending:${storeId}:${family}:${orderNumber}`;
}

// --- Outcome counter ---

/**
 * Fire-and-forget diagnostic counter, one increment per tool execution:
 * `metrics:ecom:tool:{tool_name}:{outcome}` where outcome is `success`, `cached`
 * (answered from the 5-min result cache, no platform call), or the result's
 * error code. Same idiom as `metrics:product_card:mention:*` (§13c) — never
 * blocks, never fails a reply.
 *
 * Why it exists: the order tools had ZERO recorded invocations in production and
 * nothing could say whether that meant "never called" or "called and failed
 * before the API". With the first real Zid order this is the only signal that
 * `lookup_order` ran at all, and `invalid_order_number` vs `order_not_found`
 * tells apart "our sanitizer refused the code" from "the platform had no such
 * order" — two defects with opposite fixes.
 */
function recordToolOutcome(toolName: string, outcome: string): void {
    try {
        redis.incr(`metrics:ecom:tool:${toolName}:${outcome}`).catch(() => { });
    } catch {
        // A client that throws synchronously (disconnected, or a partial mock) is
        // still not allowed to touch the reply.
    }
}

/**
 * HOW a passed verification was satisfied — `metrics:ecom:verify:{source}`, next
 * to the tool counter the way `recordResolverOutcome` sits next to check_inventory.
 * `own`: the requesting family's Phase-1 blob was there. `sibling`: only the other
 * family's blob was, and the requested data was then read live. `live`: no blob at
 * all (cache-only Phase 1, or the customer answered after the TTL) — read live.
 *
 * The two sibling-fallback outcomes are counted SEPARATELY, because they are
 * different facts about the platform and the plan that reads these numbers
 * (SALLA_TEST_PLAN 3.8) turns on telling them apart:
 * `requested_empty`: the requested family was read and the platform answered
 * NOTHING — an order with no shipment yet. That is the ordinary case for a
 * tracking question on an unshipped order, NOT an error; the customer gets the
 * order summary. `requested_live_failed`: the read THREW (403, 5xx, timeout).
 * Folding the empty case into the failure counter would report the commonest
 * healthy path as a platform failure and hide the 403 that 3.8 exists to find.
 *
 * These are the numbers that say whether the cross-family repair is carrying
 * real traffic — in production before it existed, 4 of 4 Phase-2 calls expired.
 */
type VerificationSource = 'own' | 'sibling' | 'live' | 'requested_empty' | 'requested_live_failed';
function recordVerificationSource(source: VerificationSource): void {
    try {
        redis.incr(`metrics:ecom:verify:${source}`).catch(() => { });
    } catch {
        // never on the reply path
    }
}

// --- Main Executor ---

/**
 * Execute a single e-commerce tool call against the correct platform.
 *
 * Returns a normalized result regardless of platform (Shopify, Salla, etc.).
 * Caches successful results in Redis (5-min TTL) to avoid hammering APIs.
 * Every execution — including cache hits and early validation failures — is
 * counted once via `recordToolOutcome`.
 */
export async function executeToolCall(
    ecommerceStoreId: string,
    toolCall: EcommerceToolCall,
    ctx: ToolExecutionContext = {},
): Promise<EcommerceToolResult> {
    const { result, cached } = await runToolCall(ecommerceStoreId, toolCall, ctx);
    recordToolOutcome(
        toolCall.name,
        cached ? 'cached' : result.success ? 'success' : (result.error ?? 'unknown'),
    );
    return result;
}

async function runToolCall(
    ecommerceStoreId: string,
    toolCall: EcommerceToolCall,
    ctx: ToolExecutionContext,
): Promise<{ result: EcommerceToolResult; cached: boolean }> {
    const live = (result: EcommerceToolResult) => ({ result, cached: false });

    // 1. Validate tool name against shared whitelist
    if (!VALID_TOOL_NAMES.includes(toolCall.name)) {
        return live({ tool_name: toolCall.name, success: false, error: 'unknown_tool' });
    }

    // 2. Look up store to determine platform. Every remaining tool needs it —
    //    including Phase-2 verification, which may have to re-read the order live.
    const store = await getStoreById(ecommerceStoreId);
    if (!store || !store.isActive) {
        return live({ tool_name: toolCall.name, success: false, error: 'store_not_connected' });
    }

    // 3. check_inventory resolves and answers LOCALLY (D-092): no result cache.
    //    The old raw-args cache keyed on the model's free text and pinned whatever
    //    the platform matcher returned — including a wrong product — for five
    //    minutes. The only cache on this path now is the per-product LIVE stock
    //    read inside readStock, keyed by platform product id. Stays ahead of the
    //    module resolution below so an unknown platform still answers from the row.
    if (toolCall.name === 'check_inventory') {
        try {
            return live(await executeInventoryCheck(store, toolCall, ctx));
        } catch (err) {
            captureError(err, 'E-commerce tool execution failed: check_inventory', {
                tags: { service: 'ecommerce-tools', platform: store.platform },
                extra: { storeId: ecommerceStoreId, tool: toolCall.name },
            });
            return live({ tool_name: toolCall.name, success: false, error: 'api_error' });
        }
    }

    // 4. Resolve the platform module once. A demo store answers from constants —
    //    its token is a placeholder that cannot reach any platform (see demoOrders).
    let mod: PlatformModule;
    try {
        mod = isDemoStore(store) ? demoOrderModule : await platformModule(store.platform);
    } catch {
        return live({ tool_name: toolCall.name, success: false, error: 'unsupported_platform' });
    }

    // 5. Phase-2 verification: never cached — the answer depends on the customer's
    //    identity claim, and a passed check must not be replayable from a cache key.
    if (toolCall.name === 'verify_and_get_order' || toolCall.name === 'verify_and_get_shipment') {
        return live(await handleVerification(mod, store, toolCall));
    }

    //    Same rule for the phone lookup: its answer depends on the customer's
    //    identity claim, so it must never be served from (or written to) a cache.
    if (toolCall.name === 'find_order_by_phone') {
        return live(await handlePhoneLookup(mod, store, toolCall));
    }

    // 6. Phase-1 order tools: Redis result cache, keyed on the SANITIZED arguments
    //    so '#123' and '123' share an entry.
    const cacheKey = buildToolCacheKey(ecommerceStoreId, toolCall.name, sanitizedArgsOf(toolCall));
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return { result: JSON.parse(cached) as EcommerceToolResult, cached: true };
        }
    } catch {
        // Redis unavailable — proceed without cache
    }

    // 7. Execute against the platform
    let result: EcommerceToolResult;
    try {
        result = await executePlatformTool(mod, ecommerceStoreId, toolCall);
    } catch (err) {
        return live(platformFailure(err, toolCall, store));
    }

    // 8. Cache successful results
    if (result.success) {
        try {
            await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
        } catch {
            // Cache write failure is non-critical
        }
    }

    return live(result);
}

/** Map a platform throw to the tool error the model understands; api_error is reported. */
function platformFailure(err: unknown, toolCall: EcommerceToolCall, store: StoreRow): EcommerceToolResult {
    if (isPermissionError(err)) {
        return { tool_name: toolCall.name, success: false, error: 'insufficient_permissions' };
    }
    captureError(err, `E-commerce tool execution failed: ${toolCall.name}`, {
        tags: { service: 'ecommerce-tools', platform: store.platform },
        extra: { storeId: store.id, tool: toolCall.name },
    });
    return { tool_name: toolCall.name, success: false, error: 'api_error' };
}

// --- Phase 2: Server-Side Verification ---

/**
 * Verify the customer's identity claim and return the order or shipment they asked for.
 *
 * The Phase-1 blob is looked for in the requesting family first, then in the sibling
 * family, and when neither exists the requested family is read live from the
 * platform. That order matters for two reasons that both shipped as defects:
 *
 * - Phase 2 runs on the customer's NEXT message, a fresh request whose history is
 *   text only, so the model re-decides which verify tool to call with no memory of
 *   the Phase-1 tool. In production it paired lookup_order with
 *   verify_and_get_shipment every time; reading only the requesting family's key
 *   turned every correct identity answer into "verification expired" (4 of 4).
 * - The blob is a saved platform call, not a gate. A cache-served Phase 1 never
 *   writes one, and a customer who answers after VERIFICATION_TTL_SECONDS has none;
 *   both used to dead-end on the same error.
 *
 * What the identity comparison does and does NOT gate, stated exactly, because the
 * two are easy to conflate:
 * - It gates every BYTE returned. No order or shipment field reaches the model on
 *   any path until namesMatch/phonesMatch passes.
 * - It does NOT gate the platform READ on the no-blob path. There the order has to
 *   be fetched to have anything to compare against, so a wrong guess for an order
 *   number that exists costs one platform call and parks that blob for the rest of
 *   the TTL. That is bounded, not free: the park means repeat guesses against the
 *   same order number cost nothing further, so the worst case is one extra call per
 *   (order number, family) per VERIFICATION_TTL_SECONDS — the same shape of budget
 *   `lookup_order` already hands an unauthenticated DM, which is why it is accepted.
 *   Once a blob IS held (own or sibling), the comparison runs first and a failed
 *   guess causes no read at all.
 */
async function handleVerification(
    mod: PlatformModule,
    store: StoreRow,
    toolCall: EcommerceToolCall,
): Promise<EcommerceToolResult> {
    const orderNumber = sanitizeOrderNumber(toolCall.arguments.order_number || '');
    if (!orderNumber) {
        return { tool_name: toolCall.name, success: false, error: 'invalid_order_number' };
    }

    const providedName = toolCall.arguments.provided_name?.trim();
    const providedPhone = sanitizePhone(toolCall.arguments.provided_phone || '') || toolCall.arguments.provided_phone?.trim();

    if (!providedName && !providedPhone) {
        return { tool_name: toolCall.name, success: false, error: 'name_or_phone_required' };
    }

    const requested = familyOfVerifyTool(toolCall.name);

    // Find something to verify against: own blob → sibling blob → live read.
    const parked = await loadPendingBlob(store.id, orderNumber, requested);
    let held = parked;
    if (!held) {
        let blob: OrderBlob | null;
        try {
            blob = await fetchFamilyLive(mod, store.id, orderNumber, requested);
        } catch (err) {
            return platformFailure(err, toolCall, store);
        }
        if (!blob) {
            return { tool_name: toolCall.name, success: false, error: 'order_not_found' };
        }
        held = { blob, family: requested };
    }
    // Derived from what was PARKED, not from `held` — a live read yields the
    // requested family too, so after the fallback the two are indistinguishable.
    let source: VerificationSource = parked
        ? (parked.family === requested ? 'own' : 'sibling')
        : 'live';

    // Server-side comparison — the gate.
    const nameOk = providedName ? namesMatch(held.blob.customerFirstName, providedName) : false;
    const phoneOk = providedPhone && held.blob.customerPhone
        ? phonesMatch(held.blob.customerPhone, providedPhone)
        : false;
    if (!nameOk && !phoneOk) {
        return { tool_name: toolCall.name, success: false, error: 'verification_failed' };
    }

    // Verified. If the blob is the other family's, the customer still wants the
    // requested one (tracking, not an order summary) — read it now. On failure the
    // sibling data is a real answer about their order; an error code is not.
    let answer = held.blob;
    if (held.family !== requested) {
        try {
            const wanted = await fetchFamilyLive(mod, store.id, orderNumber, requested);
            if (wanted) {
                answer = wanted;
            } else {
                // Read succeeded, platform has nothing yet (an unshipped order asked
                // about by tracking). Healthy — never counted as a failure.
                source = 'requested_empty';
            }
        } catch (err) {
            source = 'requested_live_failed';
            if (await claimDailyOnce(`ecom:verify:live_failed:${store.id}`, VERIFICATION_TTL_SECONDS)) {
                captureError(err, 'Verified from the sibling blob but the requested family could not be read live — returning the sibling data', {
                    tags: { service: 'ecommerce-tools', platform: store.platform },
                    extra: { storeId: store.id, orderNumber, requested },
                });
            }
        }
    }

    recordVerificationSource(source);
    return { tool_name: toolCall.name, success: true, data: stripPii(answer) };
}

/** Own family's blob first, then the sibling's. A Redis failure is a miss (reported), not a refusal. */
async function loadPendingBlob(
    storeId: string,
    orderNumber: string,
    requested: OrderFamily,
): Promise<{ blob: OrderBlob; family: OrderFamily } | null> {
    for (const family of [requested, SIBLING_FAMILY[requested]]) {
        try {
            const json = await redis.get(pendingVerificationKey(storeId, orderNumber, family));
            if (json) return { blob: JSON.parse(json) as OrderBlob, family };
        } catch (error) {
            captureError(error, 'Redis unavailable during order verification Phase 2 — falling back to a live read', {
                tags: { service: 'ecommerce-tools' },
                extra: { storeId, orderNumber, family },
            });
            return null;
        }
    }
    return null;
}

/**
 * Read ONE family from the platform and park it for Phase 2. Used by Phase 1 and by
 * a Phase 2 that has nothing to verify against, so a retry inside the TTL is free.
 */
async function fetchFamilyLive(
    mod: PlatformModule,
    storeId: string,
    orderNumber: string,
    family: OrderFamily,
): Promise<OrderBlob | null> {
    const blob = family === 'order'
        ? await mod.lookupOrder(storeId, orderNumber)
        : await mod.getShipmentTracking(storeId, orderNumber);
    if (blob) await storePendingVerification(storeId, orderNumber, family, blob);
    return blob;
}

/** Verification passed — the model gets the data WITHOUT the fields it was verified against. */
function stripPii(blob: OrderBlob): Record<string, unknown> {
    const { customerFirstName: _n, customerPhone: _p, ...safeData } = blob;
    return safeData as unknown as Record<string, unknown>;
}

// --- Phase 1: Platform-Specific Executors ---

/**
 * Platform module interface — Shopify, Salla and Zid each export these.
 * `getProductById` replaced the three `checkInventory` matchers (D-092): the
 * platform is asked about ONE product, by its own id, and never asked to guess
 * which product a name means.
 */
interface PlatformModule {
    lookupOrder: (storeId: string, orderNumber: string) => Promise<OrderInfoFull | null>;
    getShipmentTracking: (storeId: string, orderNumber: string) => Promise<ShipmentInfoFull | null>;
    getProductById: (storeId: string, platformProductId: string) => Promise<PlatformProductDetail | null>;
    /** Candidate orders for a phone number — never a verification, see handlePhoneLookup. */
    findOrdersByPhone: (storeId: string, phone: string) => Promise<OrderInfoFull[]>;
}

/** Shared executor — platform-agnostic routing for the Phase-1 ORDER tools. */
async function executePlatformTool(
    mod: PlatformModule, storeId: string, toolCall: EcommerceToolCall,
): Promise<EcommerceToolResult> {
    switch (toolCall.name) {
        case 'lookup_order':
            return phaseOne(mod, storeId, toolCall, 'order');
        case 'track_shipment':
            return phaseOne(mod, storeId, toolCall, 'shipment');
        default:
            return { tool_name: toolCall.name, success: false, error: 'unknown_tool' };
    }
}

/** Confirm the order exists, park its data for Phase 2, and hand back the identity challenge. */
async function phaseOne(
    mod: PlatformModule, storeId: string, toolCall: EcommerceToolCall, family: OrderFamily,
): Promise<EcommerceToolResult> {
    const orderNumber = sanitizeOrderNumber(toolCall.arguments.order_number || '');
    if (!orderNumber) return { tool_name: toolCall.name, success: false, error: 'invalid_order_number' };
    const blob = await fetchFamilyLive(mod, storeId, orderNumber, family);
    if (!blob) return { tool_name: toolCall.name, success: false, error: 'order_not_found' };
    return buildVerificationChallenge(toolCall.name, orderNumber, family);
}

/**
 * The customer has no order number: find their order from phone + name (D-101).
 *
 * SECURITY — why this is the same strength as the order-number flow, not weaker:
 * - BOTH are required, in ONE call. Phone alone returns nothing; name alone
 *   returns nothing. The order-number flow gates on (order number) + (name OR
 *   phone); this one gates on (phone) + (name). Each is two independent facts
 *   about the same order.
 * - The PLATFORM's phone search is never the gate. Zid's `search_term` is a
 *   natural-language lookup that also matches names and order codes, and Salla's
 *   `customers?keyword=` matches name and email too — so a hit proves nothing.
 *   Every candidate is re-compared here with the same `phonesMatch` +
 *   `namesMatch` used by verify_and_get_*, and BOTH must pass.
 * - Reads are bounded per (store, phone): the first lookup claims a Redis slot
 *   for VERIFICATION_TTL_SECONDS, so repeated guesses against one phone number
 *   cost no further platform calls. Same budget shape `lookup_order` already
 *   hands an unauthenticated DM.
 * - Only ONE order is returned — the newest match — and it goes through
 *   `stripPii` like every other verified answer.
 */
async function handlePhoneLookup(
    mod: PlatformModule, store: StoreRow, toolCall: EcommerceToolCall,
): Promise<EcommerceToolResult> {
    const phone = sanitizePhone(toolCall.arguments.provided_phone || '');
    const name = toolCall.arguments.provided_name?.trim() || '';
    // Both, always. A missing half is a prompt/tool-call error, never a partial search.
    if (!phone || phone.replace(/\D/g, '').length < MIN_PHONE_DIGITS) {
        return { tool_name: toolCall.name, success: false, error: 'phone_and_name_required' };
    }
    if (name.length < MIN_NAME_CHARS) {
        return { tool_name: toolCall.name, success: false, error: 'phone_and_name_required' };
    }

    let candidates: OrderInfoFull[];
    try {
        candidates = await mod.findOrdersByPhone(store.id, phone);
    } catch (err) {
        return platformFailure(err, toolCall, store);
    }

    // The gate: the platform's search is a suggestion; these two comparisons decide.
    const verified = candidates.filter(o =>
        o.customerPhone && phonesMatch(o.customerPhone, phone) && namesMatch(o.customerFirstName, name),
    );
    recordPhoneLookupOutcome(verified.length > 0 ? 'verified' : (candidates.length > 0 ? 'rejected' : 'no_candidates'));
    if (verified.length === 0) {
        // Deliberately the SAME answer for "no such phone" and "phone found but the
        // name does not match": distinguishing them would confirm a phone number is
        // a customer's to anyone who can type one.
        return { tool_name: toolCall.name, success: false, error: 'order_not_found' };
    }

    // Newest first — the order a customer asking "where is my order?" means.
    const newest = [...verified].sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''))[0];
    return { tool_name: toolCall.name, success: true, data: stripPii(newest) };
}

/** Phone must carry enough digits to be an identity claim, name enough to be a name. */
const MIN_PHONE_DIGITS = 7;
const MIN_NAME_CHARS = 2;

/** `metrics:ecom:phone_lookup:{verified|rejected|no_candidates}` — fire-and-forget. */
function recordPhoneLookupOutcome(outcome: 'verified' | 'rejected' | 'no_candidates'): void {
    try {
        redis.incr(`metrics:ecom:phone_lookup:${outcome}`).catch(() => { });
    } catch {
        // never on the reply path
    }
}

// --- check_inventory (D-092: resolve in code, answer locally, platform by id only when risky) ---

type StoreRow = NonNullable<Awaited<ReturnType<typeof getStoreById>>>;

async function executeInventoryCheck(
    store: StoreRow,
    toolCall: EcommerceToolCall,
    ctx: ToolExecutionContext,
): Promise<EcommerceToolResult> {
    const productId = sanitizeProductId(toolCall.arguments.product_id);
    const productName = sanitizeProductName(toolCall.arguments.product_name || '');
    if (!productId && !productName) {
        return { tool_name: toolCall.name, success: false, error: 'invalid_product_name' };
    }

    const resolution = await resolveProduct({
        storeId: store.id,
        pageId: ctx.pageId,
        kbActiveVersion: ctx.kbActiveVersion,
        productId,
        productName,
        queryEmbedding: ctx.queryEmbedding,
        userId: ctx.userId,
        logger: ctx.logger,
    });

    if (resolution.kind === 'not_found') {
        return { tool_name: toolCall.name, success: false, error: 'product_not_found' };
    }
    if (resolution.kind === 'ambiguous') {
        return { tool_name: toolCall.name, success: false, error: 'ambiguous_product', candidates: resolution.candidates };
    }

    const info = await readStock(store, resolution.product, sanitizeVariant(toolCall.arguments.variant));
    return { tool_name: toolCall.name, success: true, data: info as unknown as Record<string, unknown> };
}

/**
 * Answer from the synced row; go to the platform by id only when the local
 * answer is RISKY — a tracked product at or below LOW_STOCK_UNITS whose store
 * last synced more than STOCK_REFRESH_MIN ago. Unlimited (`null`) rows and
 * demo stores never refresh. A platform failure degrades to the local answer
 * (reported once), never to a wrong product or an api_error for the customer.
 */
async function readStock(store: StoreRow, product: EcommerceProduct, variant?: string): Promise<InventoryInfo> {
    const local = inventoryFromRow(store, product);
    const demo = isDemoStore(store);
    const risky = product.totalInventory !== null && product.totalInventory <= LOW_STOCK_UNITS;
    const lastSync = store.lastSyncAt ? new Date(store.lastSyncAt).getTime() : 0;
    const stale = Date.now() - lastSync > STOCK_REFRESH_MIN * 60 * 1000;

    if (demo) { recordResolverOutcome('demo_local'); return local; }
    if (!risky) { recordResolverOutcome(stale ? 'stale_served' : 'local'); return local; }
    if (!stale) { recordResolverOutcome('local'); return local; }

    const cacheKey = `ecom:stock:${store.id}:${product.platformProductId}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            const detail = JSON.parse(cached) as { detail: PlatformProductDetail; asOf: string };
            recordResolverOutcome('live_cached');
            return inventoryFromDetail(store, product, detail.detail, detail.asOf, variant);
        }
    } catch {
        // cache miss path below
    }

    try {
        const mod = await platformModule(store.platform);
        const detail = await mod.getProductById(store.id, product.platformProductId);
        if (!detail) {
            // The platform no longer knows this product; the synced row is the
            // best answer we have, and the next sync will reconcile the row.
            recordResolverOutcome('live_missing');
            return local;
        }
        const asOf = new Date().toISOString();
        await writeBackProductStock(store.id, product.platformProductId, { totalInventory: detail.totalInventory, status: detail.status });
        try {
            await redis.set(cacheKey, JSON.stringify({ detail, asOf }), 'EX', STOCK_CACHE_TTL_SECONDS);
        } catch {
            // cache write is best-effort
        }
        recordResolverOutcome('live_refresh');
        return inventoryFromDetail(store, product, detail, asOf, variant);
    } catch (err) {
        recordResolverOutcome('live_failed');
        // Once per store per refresh window: a store whose token has died fails
        // this way on EVERY risky read, and the counter above already carries
        // the volume — Sentry needs the first one, not the four-hundredth.
        if (await claimDailyOnce(`ecom:stock:failed:${store.id}`, STOCK_CACHE_TTL_SECONDS)) {
            captureError(err, 'Live stock refresh failed — serving the synced figure', {
                tags: { service: 'ecommerce-tools', platform: store.platform },
                extra: { storeId: store.id, platformProductId: product.platformProductId },
            });
        }
        return local;
    }
}

/** InventoryInfo from the synced catalog row. `asOf` is the store's last sync. */
function inventoryFromRow(store: StoreRow, product: EcommerceProduct): InventoryInfo {
    const availability = availabilityOf(product);
    const productUrl = productUrlFor(store, product);
    return {
        platformProductId: product.platformProductId,
        productName: product.title,
        available: availability !== 'out_of_stock',
        availability,
        ...(product.totalInventory !== null ? { quantity: product.totalInventory } : {}),
        ...(product.variantSummary ? { variantSummary: product.variantSummary } : {}),
        ...(product.priceRange ? { price: product.priceRange } : {}),
        ...(product.currency ? { currency: product.currency } : {}),
        ...(productUrl ? { productUrl } : {}),
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
        ...(product.handle ? { handle: product.handle } : {}),
        source: 'local',
        // A store that never synced has no date for its figure — omit it rather
        // than hand the model an epoch placeholder it would read out.
        ...(store.lastSyncAt ? { asOf: new Date(store.lastSyncAt).toISOString() } : {}),
    };
}

/** InventoryInfo from a live platform read, keyed on the SAME product the resolver chose. */
function inventoryFromDetail(
    store: StoreRow,
    product: EcommerceProduct,
    detail: PlatformProductDetail,
    asOf: string,
    variant?: string,
): InventoryInfo {
    const availability = availabilityOf(detail);
    const variants = filterVariants(detail.variants, variant);
    const productUrl = liveProductUrl(store, product, detail);
    return {
        platformProductId: product.platformProductId,
        productName: detail.title || product.title,
        available: availability !== 'out_of_stock',
        availability,
        ...(detail.totalInventory !== null ? { quantity: detail.totalInventory } : {}),
        ...(variants ? { variants } : {}),
        ...(detail.priceRange ? { price: detail.priceRange } : {}),
        ...(detail.currency ? { currency: detail.currency } : {}),
        ...(productUrl ? { productUrl } : {}),
        ...((detail.imageUrl ?? product.imageUrl) ? { imageUrl: (detail.imageUrl ?? product.imageUrl) as string } : {}),
        ...((detail.handle ?? product.handle) ? { handle: (detail.handle ?? product.handle) as string } : {}),
        source: 'live',
        asOf,
    };
}

/** The live read's URL first (it may carry the platform's canonical one), then the synced row's. */
function liveProductUrl(store: StoreRow, product: EcommerceProduct, detail: PlatformProductDetail): string | undefined {
    return productUrlFor(store, { productUrl: detail.productUrl, handle: detail.handle })
        ?? productUrlFor(store, product);
}

/** Variant filtering happens ONCE, here — it used to be re-implemented per platform on unsanitized input. */
function filterVariants(
    variants: PlatformProductDetail['variants'],
    variant: string | undefined,
): PlatformProductDetail['variants'] | undefined {
    if (!variants || variants.length === 0) return undefined;
    if (!variant) return variants;
    const needle = variant.toLowerCase();
    const matched = variants.filter(v => v.name.toLowerCase().includes(needle));
    return matched.length > 0 ? matched : variants;
}

async function platformModule(platform: string): Promise<PlatformModule> {
    switch (platform) {
        case 'shopify': return import('./shopify');
        case 'salla': return import('./salla');
        case 'zid': return import('./zid');
        default: throw new Error(`unsupported platform: ${platform}`);
    }
}

// --- Utilities ---

/** Park full order/shipment data in Redis so Phase 2 can verify without a second platform call. */
async function storePendingVerification(
    storeId: string,
    orderNumber: string,
    family: OrderFamily,
    data: OrderBlob,
): Promise<void> {
    const key = pendingVerificationKey(storeId, orderNumber, family);
    try {
        await redis.set(key, JSON.stringify(data), 'EX', VERIFICATION_TTL_SECONDS);
    } catch (error) {
        captureError(error, 'Redis unavailable: failed to store pending verification (Phase 2 will re-read live)', {
            tags: { service: 'ecommerce-tools' },
            extra: { storeId, orderNumber, family },
        });
    }
}

/**
 * Build a Phase 1 verification challenge response (no sensitive data). It names the
 * verify tool of the SAME family — the old text offered both, which is the wording
 * that taught the model to cross families.
 */
function buildVerificationChallenge(toolName: string, orderNumber: string, family: OrderFamily): EcommerceToolResult {
    const challenge: PendingVerification = {
        orderFound: true,
        orderNumber,
        message: `Order found. Ask the customer for the name on the order or the phone number used when ordering to verify their identity. Then call ${VERIFY_TOOL_OF[family]} with their answer.`,
    };
    return { tool_name: toolName, success: true, data: challenge as unknown as Record<string, unknown> };
}

/** Build a deterministic cache key from store ID + tool name + the SANITIZED arguments (key order fixed). */
function buildToolCacheKey(storeId: string, toolName: string, args: Record<string, string>): string {
    const canonical = Object.keys(args).sort().map(k => `${k}=${args[k]}`).join('&');
    const argsHash = crypto.createHash('md5').update(canonical).digest('hex').slice(0, 12);
    return `ecom:tool:${storeId}:${toolName}:${argsHash}`;
}

/** Check if an error is a permission/scope error (401/403) */
function isPermissionError(err: unknown): boolean {
    if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden');
    }
    return false;
}
