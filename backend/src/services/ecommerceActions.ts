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
 *   and only then returns sensitive data.
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
    getStoreById, writeBackProductStock, buildProductUrl,
    type PlatformProductDetail,
} from './ecommerce';
import { isDemoStore } from './demoStore';
import { resolveProduct, sanitizeProductId, recordResolverOutcome } from './reply/productResolver';
import { redis } from '../lib/redis';
import { captureError } from '../utils/sentryHelpers';

const CACHE_TTL_SECONDS = 300; // 5 minutes
const VERIFICATION_TTL_SECONDS = 600; // 10 minutes — pending verification data
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
    queryEmbedding?: number[] | null;
    userId?: string | null;
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

/** Redis key for pending verification data */
function pendingVerificationKey(storeId: string, orderNumber: string, toolType: 'order' | 'shipment'): string {
    return `ecom:pending:${storeId}:${toolType}:${orderNumber}`;
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

    // 2. Handle verification tools (Phase 2) — no store API call needed
    if (toolCall.name === 'verify_and_get_order' || toolCall.name === 'verify_and_get_shipment') {
        return live(await handleVerification(ecommerceStoreId, toolCall));
    }

    // 3. Look up store to determine platform
    const store = await getStoreById(ecommerceStoreId);
    if (!store || !store.isActive) {
        return live({ tool_name: toolCall.name, success: false, error: 'store_not_connected' });
    }

    // 4. check_inventory resolves and answers LOCALLY (D-092): no result cache.
    //    The old raw-args cache keyed on the model's free text and pinned whatever
    //    the platform matcher returned — including a wrong product — for five
    //    minutes. The only cache on this path now is the per-product LIVE stock
    //    read inside readStock, keyed by platform product id.
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

    // 5. Order tools: Redis result cache, keyed on the SANITIZED arguments so
    //    '#123' and '123' share an entry.
    const cacheKey = buildToolCacheKey(ecommerceStoreId, toolCall.name, sanitizedArgsOf(toolCall));
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return { result: JSON.parse(cached) as EcommerceToolResult, cached: true };
        }
    } catch {
        // Redis unavailable — proceed without cache
    }

    // 6. Route to platform-specific executor
    let result: EcommerceToolResult;
    try {
        switch (store.platform) {
            case 'shopify':
                result = await executeShopifyTool(ecommerceStoreId, toolCall);
                break;
            case 'salla':
                result = await executeSallaTool(ecommerceStoreId, toolCall);
                break;
            case 'zid':
                result = await executeZidTool(ecommerceStoreId, toolCall);
                break;
            default:
                return live({ tool_name: toolCall.name, success: false, error: 'unsupported_platform' });
        }
    } catch (err) {
        if (isPermissionError(err)) {
            return live({ tool_name: toolCall.name, success: false, error: 'insufficient_permissions' });
        }

        captureError(err, `E-commerce tool execution failed: ${toolCall.name}`, {
            tags: { service: 'ecommerce-tools', platform: store.platform },
            extra: { storeId: ecommerceStoreId, tool: toolCall.name },
        });

        return live({ tool_name: toolCall.name, success: false, error: 'api_error' });
    }

    // 7. Cache successful results
    if (result.success) {
        try {
            await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
        } catch {
            // Cache write failure is non-critical
        }
    }

    return live(result);
}

// --- Phase 2: Server-Side Verification ---

async function handleVerification(
    storeId: string,
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

    const toolType = toolCall.name === 'verify_and_get_order' ? 'order' : 'shipment';
    const redisKey = pendingVerificationKey(storeId, orderNumber, toolType);

    // Retrieve the full data stored during Phase 1
    let storedJson: string | null;
    try {
        storedJson = await redis.get(redisKey);
    } catch (error) {
        captureError(error, 'Redis unavailable during order verification Phase 2', {
            tags: { service: 'ecommerce-tools' },
            extra: { storeId, orderNumber, toolType },
        });
        return { tool_name: toolCall.name, success: false, error: 'verification_expired' };
    }

    if (!storedJson) {
        return { tool_name: toolCall.name, success: false, error: 'verification_expired' };
    }

    const storedData = JSON.parse(storedJson) as OrderInfoFull | ShipmentInfoFull;

    // Server-side comparison
    const nameOk = providedName ? namesMatch(storedData.customerFirstName, providedName) : false;
    const phoneOk = providedPhone && storedData.customerPhone
        ? phonesMatch(storedData.customerPhone, providedPhone)
        : false;

    if (!nameOk && !phoneOk) {
        return { tool_name: toolCall.name, success: false, error: 'verification_failed' };
    }

    // Verification passed — return data WITHOUT PII fields
    const { customerFirstName: _n, customerPhone: _p, ...safeData } = storedData;
    return { tool_name: toolCall.name, success: true, data: safeData as unknown as Record<string, unknown> };
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
}

/** Shared executor — platform-agnostic routing for the ORDER tools. */
async function executePlatformTool(
    mod: PlatformModule, storeId: string, toolCall: EcommerceToolCall,
): Promise<EcommerceToolResult> {
    switch (toolCall.name) {
        case 'lookup_order': {
            const orderNumber = sanitizeOrderNumber(toolCall.arguments.order_number || '');
            if (!orderNumber) return { tool_name: toolCall.name, success: false, error: 'invalid_order_number' };
            const fullData = await mod.lookupOrder(storeId, orderNumber);
            if (!fullData) return { tool_name: toolCall.name, success: false, error: 'order_not_found' };
            await storePendingVerification(storeId, orderNumber, 'order', fullData);
            return buildVerificationChallenge(toolCall.name, orderNumber);
        }
        case 'track_shipment': {
            const orderNumber = sanitizeOrderNumber(toolCall.arguments.order_number || '');
            if (!orderNumber) return { tool_name: toolCall.name, success: false, error: 'invalid_order_number' };
            const fullData = await mod.getShipmentTracking(storeId, orderNumber);
            if (!fullData) return { tool_name: toolCall.name, success: false, error: 'order_not_found' };
            await storePendingVerification(storeId, orderNumber, 'shipment', fullData);
            return buildVerificationChallenge(toolCall.name, orderNumber);
        }
        default:
            return { tool_name: toolCall.name, success: false, error: 'unknown_tool' };
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
        await writeBackProductStock(store.id, product.platformProductId, detail.totalInventory);
        try {
            await redis.set(cacheKey, JSON.stringify({ detail, asOf }), 'EX', STOCK_CACHE_TTL_SECONDS);
        } catch {
            // cache write is best-effort
        }
        recordResolverOutcome('live_refresh');
        return inventoryFromDetail(store, product, detail, asOf, variant);
    } catch (err) {
        recordResolverOutcome('live_failed');
        captureError(err, 'Live stock refresh failed — serving the synced figure', {
            tags: { service: 'ecommerce-tools', platform: store.platform },
            extra: { storeId: store.id, platformProductId: product.platformProductId },
        });
        return local;
    }
}

/** InventoryInfo from the synced catalog row. `asOf` is the store's last sync. */
function inventoryFromRow(store: StoreRow, product: EcommerceProduct): InventoryInfo {
    const availability = availabilityOf(product);
    return {
        platformProductId: product.platformProductId,
        productName: product.title,
        available: availability !== 'out_of_stock',
        availability,
        ...(product.totalInventory !== null ? { quantity: product.totalInventory } : {}),
        ...(product.variantSummary ? { variantSummary: product.variantSummary } : {}),
        ...(product.priceRange ? { price: product.priceRange } : {}),
        ...(product.currency ? { currency: product.currency } : {}),
        ...(productUrlOf(store, product.handle) ? { productUrl: productUrlOf(store, product.handle) } : {}),
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
        ...(product.handle ? { handle: product.handle } : {}),
        source: 'local',
        asOf: store.lastSyncAt ? new Date(store.lastSyncAt).toISOString() : new Date(0).toISOString(),
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
    return {
        platformProductId: product.platformProductId,
        productName: detail.title || product.title,
        available: availability !== 'out_of_stock',
        availability,
        ...(detail.totalInventory !== null ? { quantity: detail.totalInventory } : {}),
        ...(variants ? { variants } : {}),
        ...(detail.priceRange ? { price: detail.priceRange } : {}),
        ...(detail.currency ? { currency: detail.currency } : {}),
        ...((detail.productUrl ?? productUrlOf(store, detail.handle ?? product.handle))
            ? { productUrl: detail.productUrl ?? productUrlOf(store, detail.handle ?? product.handle) }
            : {}),
        ...((detail.imageUrl ?? product.imageUrl) ? { imageUrl: (detail.imageUrl ?? product.imageUrl) as string } : {}),
        ...((detail.handle ?? product.handle) ? { handle: (detail.handle ?? product.handle) as string } : {}),
        source: 'live',
        asOf,
    };
}

function productUrlOf(store: { platform: string; storeDomain: string | null }, handle: string | null | undefined): string | undefined {
    return handle && store.storeDomain ? buildProductUrl(store.platform, store.storeDomain, handle) : undefined;
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

async function executeShopifyTool(storeId: string, toolCall: EcommerceToolCall): Promise<EcommerceToolResult> {
    const mod = await import('./shopify');
    return executePlatformTool(mod, storeId, toolCall);
}

async function executeSallaTool(storeId: string, toolCall: EcommerceToolCall): Promise<EcommerceToolResult> {
    const mod = await import('./salla');
    return executePlatformTool(mod, storeId, toolCall);
}

async function executeZidTool(storeId: string, toolCall: EcommerceToolCall): Promise<EcommerceToolResult> {
    const mod = await import('./zid');
    return executePlatformTool(mod, storeId, toolCall);
}

// --- Utilities ---

/** Store full data in Redis for Phase 2 verification (with TTL so it auto-expires) */
async function storePendingVerification(
    storeId: string,
    orderNumber: string,
    toolType: 'order' | 'shipment',
    data: OrderInfoFull | ShipmentInfoFull,
): Promise<void> {
    const key = pendingVerificationKey(storeId, orderNumber, toolType);
    try {
        await redis.set(key, JSON.stringify(data), 'EX', VERIFICATION_TTL_SECONDS);
    } catch (error) {
        captureError(error, 'Redis unavailable: failed to store pending verification (Phase 2 will fail)', {
            tags: { service: 'ecommerce-tools' },
            extra: { storeId, orderNumber, toolType },
        });
    }
}

/** Build a Phase 1 verification challenge response (no sensitive data) */
function buildVerificationChallenge(toolName: string, orderNumber: string): EcommerceToolResult {
    const challenge: PendingVerification = {
        orderFound: true,
        orderNumber,
        message: 'Order found. Ask the customer for the name on the order or the phone number used when ordering to verify their identity. Then call verify_and_get_order or verify_and_get_shipment with their answer.',
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
