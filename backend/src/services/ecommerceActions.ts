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
    type EcommerceToolCall, type EcommerceToolResult,
    type OrderInfoFull, type ShipmentInfoFull, type PendingVerification,
    type InventoryInfo,
} from '@jawab24/shared';
import { getStoreById } from './ecommerce';
import { redis } from '../lib/redis';
import { captureError } from '../utils/sentryHelpers';

const CACHE_TTL_SECONDS = 300; // 5 minutes
const VERIFICATION_TTL_SECONDS = 600; // 10 minutes — pending verification data
const PRODUCT_NAME_MAX_LENGTH = 200;

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
): Promise<EcommerceToolResult> {
    const { result, cached } = await runToolCall(ecommerceStoreId, toolCall);
    recordToolOutcome(
        toolCall.name,
        cached ? 'cached' : result.success ? 'success' : (result.error ?? 'unknown'),
    );
    return result;
}

async function runToolCall(
    ecommerceStoreId: string,
    toolCall: EcommerceToolCall,
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

    // 4. Check Redis cache
    const cacheKey = buildToolCacheKey(ecommerceStoreId, toolCall);
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return { result: JSON.parse(cached) as EcommerceToolResult, cached: true };
        }
    } catch {
        // Redis unavailable — proceed without cache
    }

    // 5. Route to platform-specific executor
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

    // 6. Cache successful results
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

/** Platform module interface — both Shopify and Salla export these functions */
interface PlatformModule {
    lookupOrder: (storeId: string, orderNumber: string) => Promise<OrderInfoFull | null>;
    getShipmentTracking: (storeId: string, orderNumber: string) => Promise<ShipmentInfoFull | null>;
    checkInventory: (storeId: string, productName: string, variant?: string) => Promise<InventoryInfo | null>;
}

/** Shared executor — platform-agnostic tool routing */
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
        case 'check_inventory': {
            const productName = sanitizeProductName(toolCall.arguments.product_name || '');
            if (!productName) return { tool_name: toolCall.name, success: false, error: 'invalid_product_name' };
            const data = await mod.checkInventory(storeId, productName, toolCall.arguments.variant);
            return data
                ? { tool_name: toolCall.name, success: true, data: data as unknown as Record<string, unknown> }
                : { tool_name: toolCall.name, success: false, error: 'product_not_found' };
        }
        default:
            return { tool_name: toolCall.name, success: false, error: 'unknown_tool' };
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

/** Build a deterministic cache key from store ID + tool call */
function buildToolCacheKey(storeId: string, toolCall: EcommerceToolCall): string {
    const argsHash = crypto
        .createHash('md5')
        .update(JSON.stringify(toolCall.arguments))
        .digest('hex')
        .slice(0, 12);
    return `ecom:tool:${storeId}:${toolCall.name}:${argsHash}`;
}

/** Check if an error is a permission/scope error (401/403) */
function isPermissionError(err: unknown): boolean {
    if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden');
    }
    return false;
}
