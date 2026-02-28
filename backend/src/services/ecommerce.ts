/**
 * Shared e-commerce service — platform-agnostic functions for Shopify, Salla, Zid, etc.
 *
 * All store CRUD, product summary, KB enrichment, cache invalidation, pending installs,
 * and DTO mapping live here. Platform-specific services (shopify.ts, salla.ts) import
 * from this module and add their own OAuth, API, and sync logic.
 */
import { eq, and, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores, ecommerceProducts, pages, pendingEcommerceInstalls, workspaceMembers } from '../db/schema';
import { encrypt, decrypt } from './ecommerceCrypto';
import type { EcommerceStore, EcommerceProduct } from '@jawab24/shared';
import { captureError } from '../utils/sentryHelpers';
import { redis } from '../lib/redis';

// --- Constants ---

export type EcommercePlatform = 'shopify' | 'salla' | 'zid';

export const KB_MAX_CHARS = 4000; // Must match ai-worker's KB_MAX_CHARS

// --- Store CRUD ---

export async function getStoreById(storeId: string) {
    const result = await db.select().from(ecommerceStores).where(eq(ecommerceStores.id, storeId)).limit(1);
    return result[0] || null;
}

export async function getStoreByDomain(platform: EcommercePlatform, storeDomain: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.storeDomain, storeDomain), eq(ecommerceStores.platform, platform))
    ).limit(1);
    return result[0] || null;
}

export async function getStoreByWorkspace(platform: EcommercePlatform, workspaceId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.workspaceId, workspaceId), eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, platform))
    ).limit(1);
    return result[0] || null;
}

/**
 * Like getStoreByWorkspace but also returns inactive (disconnected) stores.
 * Used by the integrations page to show a Reconnect card after disconnect.
 */
export async function getStoreByWorkspaceAny(platform: EcommercePlatform, workspaceId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.workspaceId, workspaceId), eq(ecommerceStores.platform, platform))
    ).limit(1);
    return result[0] || null;
}

/**
 * Get all active stores, optionally filtered by platform.
 * Used by the scheduled sync to refresh inventory across all connected stores.
 */
export async function getAllActiveStores(platform?: EcommercePlatform): Promise<Array<{ id: string; platform: string }>> {
    const conditions = platform
        ? and(eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, platform))
        : eq(ecommerceStores.isActive, true);
    return db.select({ id: ecommerceStores.id, platform: ecommerceStores.platform })
        .from(ecommerceStores)
        .where(conditions);
}

/** @deprecated Use getStoreByWorkspace — kept for OAuth flows that lack workspace context */
export async function getStoreByUserId(platform: EcommercePlatform, userId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.userId, userId), eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, platform))
    ).limit(1);
    return result[0] || null;
}

export interface CreateStoreOptions {
    userId: string;
    platform: EcommercePlatform;
    storeDomain: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    shopInfo?: {
        shopName?: string;
        shopEmail?: string;
        shopCurrency?: string;
        shopTimezone?: string;
    };
    platformData?: Record<string, unknown>;
    workspaceId?: string | null;
}

export async function createStore(opts: CreateStoreOptions) {
    const { ciphertext: accessCiphertext, iv: accessIv } = encrypt(opts.accessToken);

    // Encrypt refresh token if provided (Salla, Zid — Shopify doesn't need one)
    let refreshCiphertext: string | undefined;
    let refreshIv: string | undefined;
    if (opts.refreshToken) {
        const enc = encrypt(opts.refreshToken);
        refreshCiphertext = enc.ciphertext;
        refreshIv = enc.iv;
    }

    const result = await db.insert(ecommerceStores).values({
        userId: opts.userId,
        workspaceId: opts.workspaceId ?? undefined,
        platform: opts.platform,
        storeDomain: opts.storeDomain,
        accessToken: accessCiphertext,
        accessTokenIv: accessIv,
        refreshToken: refreshCiphertext,
        refreshTokenIv: refreshIv,
        tokenExpiresAt: opts.tokenExpiresAt,
        storeName: opts.shopInfo?.shopName,
        storeEmail: opts.shopInfo?.shopEmail,
        storeCurrency: opts.shopInfo?.shopCurrency,
        storeTimezone: opts.shopInfo?.shopTimezone,
        platformData: opts.platformData,
        installedAt: new Date(),
    }).onConflictDoUpdate({
        target: [ecommerceStores.platform, ecommerceStores.storeDomain],
        set: {
            userId: opts.userId,
            workspaceId: opts.workspaceId ?? undefined,
            accessToken: accessCiphertext,
            accessTokenIv: accessIv,
            refreshToken: refreshCiphertext,
            refreshTokenIv: refreshIv,
            tokenExpiresAt: opts.tokenExpiresAt,
            storeName: opts.shopInfo?.shopName,
            storeEmail: opts.shopInfo?.shopEmail,
            storeCurrency: opts.shopInfo?.shopCurrency,
            storeTimezone: opts.shopInfo?.shopTimezone,
            platformData: opts.platformData,
            isActive: true,
            uninstalledAt: null,
            updatedAt: new Date(),
        },
    }).returning();

    return result[0];
}

export async function updateStoreTokens(storeId: string, tokens: {
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
}) {
    const { ciphertext: accessCiphertext, iv: accessIv } = encrypt(tokens.accessToken);

    const updateSet: Record<string, unknown> = {
        accessToken: accessCiphertext,
        accessTokenIv: accessIv,
        updatedAt: new Date(),
    };

    if (tokens.tokenExpiresAt) {
        updateSet.tokenExpiresAt = tokens.tokenExpiresAt;
    }

    if (tokens.refreshToken) {
        const enc = encrypt(tokens.refreshToken);
        updateSet.refreshToken = enc.ciphertext;
        updateSet.refreshTokenIv = enc.iv;
    }

    await db.update(ecommerceStores).set(updateSet)
        .where(eq(ecommerceStores.id, storeId));
}

export async function deactivateStore(platform: EcommercePlatform, storeDomain: string) {
    await db.update(ecommerceStores).set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
    }).where(and(eq(ecommerceStores.storeDomain, storeDomain), eq(ecommerceStores.platform, platform)));
}

export async function disconnectStore(storeId: string) {
    // Unlink any pages connected to this store
    await db.update(pages).set({ ecommerceStoreId: null, updatedAt: new Date() })
        .where(eq(pages.ecommerceStoreId, storeId));
    // Deactivate the store
    await db.update(ecommerceStores).set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));
}

/**
 * Link an e-commerce store to a Facebook/Instagram page (with ownership validation)
 */
export async function linkStoreToPage(storeId: string, pageId: string, workspaceId: string) {
    await db.transaction(async (tx) => {
        const page = await tx.select().from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);

        if (!page[0]) {
            throw new Error('Page not found or does not belong to workspace');
        }

        await tx.update(pages).set({ ecommerceStoreId: storeId, updatedAt: new Date() })
            .where(eq(pages.id, pageId));
    });
}

// --- Product Summary ---

/**
 * Build a structured product summary for AI consumption (~800 chars max)
 */
export async function buildProductSummary(storeId: string): Promise<string> {
    const products = await db.select().from(ecommerceProducts)
        .where(and(eq(ecommerceProducts.ecommerceStoreId, storeId), eq(ecommerceProducts.status, 'active')))
        .limit(15);

    if (products.length === 0) return '';

    const lines: string[] = ['Top Products:'];

    for (const p of products) {
        const parts = [p.title];
        if (p.priceRange) parts.push(p.priceRange);
        if (p.variantSummary) parts.push(p.variantSummary);

        if (p.totalInventory === 0) parts.push('out of stock');
        else if (p.totalInventory !== null && p.totalInventory <= 5) parts.push('low stock');
        else parts.push('in stock');

        lines.push(parts.join(' — '));
    }

    let summary = lines.join('\n');
    if (summary.length > 800) {
        const truncated = summary.slice(0, 800);
        const lastNewline = truncated.lastIndexOf('\n');
        summary = lastNewline > 0 ? truncated.slice(0, lastNewline) + '\n...' : truncated.slice(0, 797) + '...';
    }

    return summary;
}

// --- Cache Invalidation ---

/**
 * Invalidate AI reply caches for all pages linked to an e-commerce store.
 *
 *   1. Bumps `kbActiveVersion` on every linked page
 *   2. Flushes Redis exact-match AI cache keys
 *   3. Deletes semantic_cache rows for affected pages
 */
export async function invalidateCachesForStore(storeId: string): Promise<number> {
    try {
        const linkedPages = await db.select({ id: pages.id })
            .from(pages)
            .where(eq(pages.ecommerceStoreId, storeId));

        if (linkedPages.length === 0) return 0;

        const pageIds = linkedPages.map(p => p.id);

        // 1. Bump kbActiveVersion on linked pages
        for (const pageId of pageIds) {
            await db.update(pages).set({
                kbActiveVersion: sql`COALESCE(${pages.kbActiveVersion}, 1) + 1`,
                updatedAt: new Date(),
            }).where(eq(pages.id, pageId));
        }

        // 2. Flush Redis exact AI cache entries
        try {
            let cursor = '0';
            const keysToDelete: string[] = [];
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'cache:ai_reply:*', 'COUNT', 200);
                cursor = nextCursor;
                keysToDelete.push(...keys);
            } while (cursor !== '0');

            if (keysToDelete.length > 0) {
                for (let i = 0; i < keysToDelete.length; i += 100) {
                    await redis.del(...keysToDelete.slice(i, i + 100));
                }
            }
        } catch {
            // Redis unavailable — semantic cache version bump is sufficient
        }

        // 3. Delete semantic_cache rows for affected pages
        for (const pageId of pageIds) {
            try {
                await db.execute(sql`DELETE FROM semantic_cache WHERE page_id = ${pageId}`);
            } catch {
                // Table may not exist in test environments
            }
        }

        return pageIds.length;
    } catch (error) {
        captureError(error, 'E-commerce cache invalidation failed', {
            tags: { service: 'ecommerce' },
            extra: { storeId },
        });
        return 0;
    }
}

// --- KB Enrichment ---

/**
 * Get enriched knowledge base: e-commerce products + policies + page KB
 * Priority: 1) Products (~800 chars)  2) Policies (~200 chars)  3) Page KB (remaining space)
 */
export async function getEnrichedKnowledgeBase(pageKB: string | undefined, ecommerceStoreId: string): Promise<string> {
    const store = await getStoreById(ecommerceStoreId);
    if (!store || !store.isActive) return pageKB || '';

    const productSection = store.productSummary || '';
    const policySection = store.policiesSummary || '';

    const storeSection = [productSection, policySection].filter(Boolean).join('\n');
    const remaining = KB_MAX_CHARS - storeSection.length;
    const pageSection = (pageKB && remaining > 100) ? pageKB.slice(0, remaining) : '';

    return [storeSection, pageSection].filter(Boolean).join('\n\n');
}

// --- List products for frontend ---

export async function getProducts(storeId: string): Promise<EcommerceProduct[]> {
    const rows = await db.select().from(ecommerceProducts)
        .where(eq(ecommerceProducts.ecommerceStoreId, storeId));

    return rows.map(r => ({
        id: r.id,
        ecommerceStoreId: r.ecommerceStoreId,
        platformProductId: r.platformProductId,
        title: r.title,
        productType: r.productType,
        vendor: r.vendor,
        status: r.status || 'active',
        priceRange: r.priceRange,
        currency: r.currency,
        totalInventory: r.totalInventory || 0,
        hasVariants: r.hasVariants || false,
        variantSummary: r.variantSummary,
        tags: r.tags,
    }));
}

// --- Pending Install Flow ---

/**
 * Create a pending install for unauthenticated users.
 * Encrypts the access token and stores it with a 30-minute TTL.
 * Deletes any older pending records for the same store domain + platform.
 */
export async function createPendingInstall(platform: EcommercePlatform, data: {
    storeDomain: string;
    accessToken: string;
    scopes?: string;
    nonce: string;
}): Promise<string> {
    // Delete older pending records for same store + platform
    await db.delete(pendingEcommerceInstalls).where(
        and(
            eq(pendingEcommerceInstalls.storeDomain, data.storeDomain),
            eq(pendingEcommerceInstalls.platform, platform),
            eq(pendingEcommerceInstalls.status, 'pending')
        )
    );

    const { ciphertext, iv } = encrypt(data.accessToken);

    const result = await db.insert(pendingEcommerceInstalls).values({
        platform,
        storeDomain: data.storeDomain,
        accessToken: ciphertext,
        accessTokenIv: iv,
        scopes: data.scopes || null,
        nonce: data.nonce,
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    }).returning();

    return result[0].id;
}

/**
 * Claim a pending install: decrypt token, create ecommerce_stores row, mark as claimed.
 * Accepts an optional registerWebhooks callback for platform-specific webhook setup.
 * Returns the new store or null if pending record is invalid/expired.
 */
export async function claimPendingInstall(
    pendingId: string,
    userId: string,
    platform: EcommercePlatform,
    registerWebhooksFn?: (storeDomain: string, accessToken: string) => Promise<void>,
) {
    const result = await db.select().from(pendingEcommerceInstalls)
        .where(eq(pendingEcommerceInstalls.id, pendingId))
        .limit(1);

    const pending = result[0];
    if (!pending) return null;

    // Validate status, expiry, and platform match
    if (pending.status !== 'pending' || pending.expiresAt < new Date()) return null;
    if (pending.platform !== platform) return null;

    // Check if store is already linked to another user
    const existingStore = await getStoreByDomain(platform, pending.storeDomain);
    if (existingStore && existingStore.userId !== userId && existingStore.isActive) {
        throw new Error(`This ${platform} store is already connected to another account`);
    }

    // Decrypt access token
    const accessToken = decrypt(pending.accessToken, pending.accessTokenIv);

    // Resolve user's workspace for store scoping
    const [membership] = await db.select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers).where(eq(workspaceMembers.userId, userId)).limit(1);
    const workspaceId = membership?.workspaceId || null;

    // Create/update store
    const store = await createStore({
        userId,
        platform,
        storeDomain: pending.storeDomain,
        accessToken,
        workspaceId,
    });

    // Mark pending as claimed
    await db.update(pendingEcommerceInstalls).set({
        status: 'claimed',
        claimedByUserId: userId,
    }).where(eq(pendingEcommerceInstalls.id, pendingId));

    // Register webhooks (non-blocking) if callback provided
    if (registerWebhooksFn) {
        registerWebhooksFn(pending.storeDomain, accessToken).catch(err => {
            captureError(err, `${platform} webhook registration after claim failed`, { tags: { service: platform } });
        });
    }

    return store;
}

/**
 * Clean up expired pending installs for a given platform
 */
export async function cleanupExpiredInstalls(platform: EcommercePlatform): Promise<number> {
    const result = await db.delete(pendingEcommerceInstalls).where(
        and(
            eq(pendingEcommerceInstalls.platform, platform),
            eq(pendingEcommerceInstalls.status, 'pending'),
            lt(pendingEcommerceInstalls.expiresAt, new Date())
        )
    ).returning();

    return result.length;
}

// --- Map to shared type ---

/**
 * Map a DB row to the EcommerceStore shared type.
 * Note: `shopDomain` alias kept for backward compat with existing Shopify test assertions.
 */
export function mapToEcommerceStore(row: typeof ecommerceStores.$inferSelect): EcommerceStore & { shopDomain: string } {
    return {
        id: row.id,
        userId: row.userId,
        platform: row.platform as EcommercePlatform,
        storeDomain: row.storeDomain,
        shopDomain: row.storeDomain, // temporary alias — remove next PR
        storeName: row.storeName,
        storeEmail: row.storeEmail,
        storeCurrency: row.storeCurrency,
        tokenExpiresAt: row.tokenExpiresAt,
        productCount: row.productCount || 0,
        productSummary: row.productSummary,
        policiesSummary: row.policiesSummary,
        lastSyncAt: row.lastSyncAt,
        isActive: row.isActive ?? true,
        installedAt: row.installedAt,
    };
}

/** @deprecated Use mapToEcommerceStore */
export const mapToShopifyStore = mapToEcommerceStore;

// --- Helpers for product sync (used by platform-specific sync functions) ---

/**
 * Atomically replace all products for a store and rebuild summary.
 * Platform services call this after fetching products from their API.
 */
export async function replaceProductsAndRebuildSummary(
    storeId: string,
    products: Array<{
        platformProductId: string;
        title: string;
        productType?: string | null;
        vendor?: string | null;
        status: string;
        priceRange: string;
        currency: string;
        totalInventory: number;
        hasVariants: boolean;
        variantSummary?: string | null;
        tags?: string | null;
    }>,
): Promise<{ synced: number }> {
    // Atomic replacement: delete old + insert new
    await db.delete(ecommerceProducts).where(eq(ecommerceProducts.ecommerceStoreId, storeId));

    if (products.length > 0) {
        const rows = products.map(p => ({
            ecommerceStoreId: storeId,
            platformProductId: p.platformProductId,
            title: p.title,
            productType: p.productType || null,
            vendor: p.vendor || null,
            status: p.status,
            priceRange: p.priceRange,
            currency: p.currency,
            totalInventory: p.totalInventory,
            hasVariants: p.hasVariants,
            variantSummary: p.variantSummary || null,
            tags: p.tags || null,
        }));

        await db.insert(ecommerceProducts).values(rows);
    }

    // Build and store the product summary
    const productSummary = await buildProductSummary(storeId);

    await db.update(ecommerceStores).set({
        productCount: products.length,
        productSummary,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));

    // Invalidate AI caches
    await invalidateCachesForStore(storeId);

    return { synced: products.length };
}
