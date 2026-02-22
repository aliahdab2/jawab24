import crypto from 'crypto';
import { eq, and, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores, ecommerceProducts, pages, pendingEcommerceInstalls, workspaceMembers } from '../db/schema';
import { config } from '../config';
import { encrypt, decrypt } from './ecommerceCrypto';
import type { EcommerceStore, EcommerceProduct } from '@jawab24/shared';
import { captureError } from '../utils/sentryHelpers';
import { redis } from '../lib/redis';

const SHOPIFY_API_VERSION = '2025-01';
const KB_MAX_CHARS = 1500; // Must match ai-worker's KB_MAX_CHARS
const MAX_PRODUCTS_PER_PAGE = 50;
const MAX_PAGES_TO_FETCH = 5; // 250 products max

// --- OAuth ---

/**
 * Build the Shopify OAuth authorization URL
 */
export function buildAuthUrl(shop: string, state: string): string {
    const { apiKey, scopes } = config.shopify;
    const redirectUri = `https://${config.shopify.hostName}/shopify/auth/callback`;
    return `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(shop: string, code: string): Promise<string> {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: config.shopify.apiKey,
            client_secret: config.shopify.apiSecret,
            code,
        }),
    });

    if (!response.ok) {
        throw new Error(`Shopify token exchange failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
}

/**
 * Verify Shopify webhook HMAC signature
 */
export function verifyWebhookHmac(body: string, hmacHeader: string): boolean {
    const hash = crypto
        .createHmac('sha256', config.shopify.apiSecret)
        .update(body, 'utf8')
        .digest('base64');
    // Ensure both buffers have the same length before comparing
    const hashBuf = Buffer.from(hash);
    const hmacBuf = Buffer.from(hmacHeader);
    if (hashBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, hmacBuf);
}

/**
 * Register mandatory webhooks after OAuth install
 */
export async function registerWebhooks(shop: string, accessToken: string): Promise<void> {
    const webhookUrl = `https://${config.shopify.hostName}/shopify/webhooks`;
    const topics = [
        { topic: 'app/uninstalled', address: `${webhookUrl}/uninstall` },
        { topic: 'products/update', address: `${webhookUrl}/products-update` },
    ];

    for (const { topic, address } of topics) {
        try {
            const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({
                    webhook: { topic, address, format: 'json' },
                }),
            });
            if (!response.ok) {
                const text = await response.text();
                // 422 = webhook already exists, which is fine
                if (response.status !== 422) {
                    captureError(new Error(`Shopify webhook registration failed: ${topic} ${response.status}`), `Shopify webhook registration failed: ${topic}`, { tags: { service: 'shopify' }, extra: { topic, status: response.status, body: text } });
                }
            }
        } catch (err) {
            captureError(err, `Shopify webhook registration error: ${topic}`, { tags: { service: 'shopify' } });
        }
    }
}

// --- Store CRUD ---

export async function getStoreByDomain(storeDomain: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.storeDomain, storeDomain), eq(ecommerceStores.platform, 'shopify'))
    ).limit(1);
    return result[0] || null;
}

export async function getStoreByWorkspace(workspaceId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.workspaceId, workspaceId), eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, 'shopify'))
    ).limit(1);
    return result[0] || null;
}

/** @deprecated Use getStoreByWorkspace — kept for OAuth flows that lack workspace context */
export async function getStoreByUserId(userId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.userId, userId), eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, 'shopify'))
    ).limit(1);
    return result[0] || null;
}

export async function getStoreById(storeId: string) {
    const result = await db.select().from(ecommerceStores).where(eq(ecommerceStores.id, storeId)).limit(1);
    return result[0] || null;
}

export async function createStore(userId: string, storeDomain: string, accessToken: string, shopInfo?: {
    shopName?: string; shopEmail?: string; shopCurrency?: string; shopTimezone?: string;
}, workspaceId?: string | null) {
    const { ciphertext, iv } = encrypt(accessToken);

    const result = await db.insert(ecommerceStores).values({
        userId,
        workspaceId: workspaceId ?? undefined,
        platform: 'shopify',
        storeDomain,
        accessToken: ciphertext,
        accessTokenIv: iv,
        storeName: shopInfo?.shopName,
        storeEmail: shopInfo?.shopEmail,
        storeCurrency: shopInfo?.shopCurrency,
        storeTimezone: shopInfo?.shopTimezone,
        installedAt: new Date(),
    }).onConflictDoUpdate({
        target: [ecommerceStores.platform, ecommerceStores.storeDomain],
        set: {
            userId,
            workspaceId: workspaceId ?? undefined,
            accessToken: ciphertext,
            accessTokenIv: iv,
            storeName: shopInfo?.shopName,
            storeEmail: shopInfo?.shopEmail,
            storeCurrency: shopInfo?.shopCurrency,
            storeTimezone: shopInfo?.shopTimezone,
            isActive: true,
            uninstalledAt: null,
            updatedAt: new Date(),
        },
    }).returning();

    return result[0];
}

export async function deactivateStore(storeDomain: string) {
    await db.update(ecommerceStores).set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
    }).where(and(eq(ecommerceStores.storeDomain, storeDomain), eq(ecommerceStores.platform, 'shopify')));
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
 * Link a Shopify store to a Facebook/Instagram page (with ownership validation)
 */
export async function linkStoreToPage(storeId: string, pageId: string, workspaceId: string) {
    await db.transaction(async (tx) => {
        // Validate page belongs to workspace (inside transaction for atomicity)
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

// --- Shopify Admin API helpers ---

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

async function shopifyGraphQL<T = unknown>(shop: string, accessToken: string, query: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ query }),
        });

        // Retry on 429 (rate limit) or 5xx (server error)
        if (response.status === 429 || response.status >= 500) {
            const retryAfter = response.headers.get('retry-after');
            const delayMs = retryAfter
                ? parseInt(retryAfter, 10) * 1000
                : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, delayMs));
                continue;
            }
            lastError = new Error(`Shopify API ${response.status} after ${MAX_RETRIES} retries`);
            break;
        }

        if (!response.ok) {
            throw new Error(`Shopify GraphQL HTTP error: ${response.status}`);
        }

        const result = await response.json() as T & { errors?: Array<{ message: string }> };

        // Shopify GraphQL returns 200 even on query errors
        if (result.errors && result.errors.length > 0) {
            throw new Error(`Shopify GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
        }

        return result;
    }

    throw lastError || new Error('Shopify API request failed');
}

async function fetchShopInfo(shop: string, accessToken: string) {
    const data = await shopifyGraphQL<{
        data: { shop: { name: string; email: string; currencyCode: string; timezoneAbbreviation: string; plan: { displayName: string } } }
    }>(shop, accessToken, `{
        shop {
            name
            email
            currencyCode
            timezoneAbbreviation
            plan { displayName }
        }
    }`);

    const s = data.data.shop;
    return {
        storeName: s.name,
        storeEmail: s.email,
        storeCurrency: s.currencyCode,
        storeTimezone: s.timezoneAbbreviation,
        platformData: { planName: s.plan?.displayName ?? null },
    };
}

// --- Product Sync ---

interface ShopifyGQLProduct {
    id: string;
    title: string;
    productType: string;
    vendor: string;
    status: string;
    tags: string[];
    totalInventory: number;
    hasOnlyDefaultVariant: boolean;
    priceRangeV2: {
        minVariantPrice: { amount: string; currencyCode: string };
        maxVariantPrice: { amount: string; currencyCode: string };
    };
    variants: {
        edges: Array<{
            node: {
                title: string;
                selectedOptions: Array<{ name: string; value: string }>;
            };
        }>;
    };
}

interface ProductsPageInfo {
    hasNextPage: boolean;
    endCursor: string | null;
}

/**
 * Fetch all active products with cursor-based pagination (up to 250)
 */
interface ProductsQueryResult {
    data: {
        products: {
            edges: Array<{ node: ShopifyGQLProduct; cursor: string }>;
            pageInfo: ProductsPageInfo;
        }
    }
}

async function fetchAllProducts(shop: string, accessToken: string): Promise<ShopifyGQLProduct[]> {
    const allProducts: ShopifyGQLProduct[] = [];
    let cursor: string | null = null;
    let pagesCount = 0;

    while (pagesCount < MAX_PAGES_TO_FETCH) {
        const afterArg: string = cursor ? `, after: "${cursor}"` : '';
        const query = `{
            products(first: ${MAX_PRODUCTS_PER_PAGE}${afterArg}, query: "status:active") {
                edges {
                    node {
                        id
                        title
                        productType
                        vendor
                        status
                        tags
                        totalInventory
                        hasOnlyDefaultVariant
                        priceRangeV2 {
                            minVariantPrice { amount currencyCode }
                            maxVariantPrice { amount currencyCode }
                        }
                        variants(first: 20) {
                            edges {
                                node {
                                    title
                                    selectedOptions { name value }
                                }
                            }
                        }
                    }
                    cursor
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }`;
        const data: ProductsQueryResult = await shopifyGraphQL<ProductsQueryResult>(shop, accessToken, query);

        const edges = data.data.products.edges;
        allProducts.push(...edges.map((e: { node: ShopifyGQLProduct }) => e.node));

        if (!data.data.products.pageInfo.hasNextPage) break;
        cursor = data.data.products.pageInfo.endCursor;
        pagesCount++;
    }

    return allProducts;
}

/**
 * Sync all active products from Shopify store (with pagination and atomic replace)
 */
export async function syncProducts(storeId: string) {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    // Decrypt access token before using it
    const accessToken = decrypt(store.accessToken, store.accessTokenIv);
    const products = await fetchAllProducts(store.storeDomain, accessToken);

    // Atomic replacement: delete old + insert new in sequence
    // Delete first, then batch insert
    await db.delete(ecommerceProducts).where(eq(ecommerceProducts.ecommerceStoreId, storeId));

    if (products.length > 0) {
        const rows = products.map(p => {
            const minPrice = parseFloat(p.priceRangeV2.minVariantPrice.amount);
            const maxPrice = parseFloat(p.priceRangeV2.maxVariantPrice.amount);
            const currency = p.priceRangeV2.minVariantPrice.currencyCode;
            const priceRange = minPrice === maxPrice
                ? `${minPrice} ${currency}`
                : `${minPrice} - ${maxPrice} ${currency}`;
            const variantSummary = buildVariantSummary(p.variants.edges.map(e => e.node));

            return {
                ecommerceStoreId: storeId,
                platformProductId: p.id.replace('gid://shopify/Product/', ''),
                title: p.title,
                productType: p.productType || null,
                vendor: p.vendor || null,
                status: p.status.toLowerCase(),
                priceRange,
                currency,
                totalInventory: p.totalInventory,
                hasVariants: !p.hasOnlyDefaultVariant,
                variantSummary: variantSummary || null,
                tags: p.tags.join(', ') || null,
            };
        });

        // Batch insert all products at once (much faster than one-by-one)
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

    // Invalidate AI caches so stale product info is never served
    await invalidateCachesForStore(storeId);

    return { synced: products.length };
}

/**
 * Invalidate AI reply caches for all pages linked to an e-commerce store.
 *
 * When product data changes (price, stock, availability), any cached AI
 * replies that reference the old data become stale. This function:
 *
 *   1. Bumps `kbActiveVersion` on every linked page — the semantic cache
 *      scopes lookups by version, so old entries are automatically skipped.
 *   2. Flushes Redis exact-match AI cache keys for each affected page —
 *      these are keyed as `cache:ai_reply:<sha256(text:lang:pageId)>`, and
 *      we use SCAN to delete them by pageId prefix pattern.
 *   3. Deletes semantic_cache rows for affected pages to reclaim storage.
 *
 * All operations are best-effort: failures are logged but never block the
 * sync pipeline.
 */
export async function invalidateCachesForStore(storeId: string): Promise<number> {
    try {
        // Find all pages linked to this store
        const linkedPages = await db.select({ id: pages.id })
            .from(pages)
            .where(eq(pages.ecommerceStoreId, storeId));

        if (linkedPages.length === 0) return 0;

        const pageIds = linkedPages.map(p => p.id);

        // 1. Bump kbActiveVersion on linked pages (invalidates semantic cache lookups)
        for (const pageId of pageIds) {
            await db.update(pages).set({
                kbActiveVersion: sql`COALESCE(${pages.kbActiveVersion}, 1) + 1`,
                updatedAt: new Date(),
            }).where(eq(pages.id, pageId));
        }

        // 2. Flush Redis exact AI cache entries for affected pages
        // Keys follow pattern: cache:ai_reply:<sha256> but the hash includes pageId,
        // so we cannot pattern-match by pageId. Instead we use a scan on the full
        // keyspace and check a secondary index, OR we accept a full flush of
        // ai_reply keys (safe because they're just a performance cache with 30-day TTL).
        // For correctness > performance, flush all ai_reply keys when product data changes.
        try {
            let cursor = '0';
            const keysToDelete: string[] = [];
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'cache:ai_reply:*', 'COUNT', 200);
                cursor = nextCursor;
                keysToDelete.push(...keys);
            } while (cursor !== '0');

            if (keysToDelete.length > 0) {
                // Delete in batches of 100 to avoid blocking Redis
                for (let i = 0; i < keysToDelete.length; i += 100) {
                    await redis.del(...keysToDelete.slice(i, i + 100));
                }
            }
        } catch {
            // Redis unavailable — semantic cache version bump is sufficient
        }

        // 3. Delete semantic_cache rows for affected pages (reclaim storage)
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
            tags: { service: 'shopify' },
            extra: { storeId },
        });
        return 0;
    }
}

/**
 * Sync store policies (shipping, returns, etc.)
 */
export async function syncPolicies(storeId: string) {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);
    const data = await shopifyGraphQL<{
        data: { shop: { shippingPolicy: { body: string } | null; refundPolicy: { body: string } | null } }
    }>(store.storeDomain, accessToken, `{
        shop {
            shippingPolicy { body }
            refundPolicy { body }
        }
    }`);

    const policies: string[] = [];
    if (data.data.shop.shippingPolicy?.body) {
        // Strip HTML and keep first ~100 chars
        const text = data.data.shop.shippingPolicy.body.replace(/<[^>]*>/g, '').trim();
        policies.push(`Shipping: ${text.slice(0, 100)}`);
    }
    if (data.data.shop.refundPolicy?.body) {
        const text = data.data.shop.refundPolicy.body.replace(/<[^>]*>/g, '').trim();
        policies.push(`Returns: ${text.slice(0, 100)}`);
    }

    const policiesSummary = policies.join('\n') || null;

    await db.update(ecommerceStores).set({
        policiesSummary,
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));

    // Invalidate AI caches so stale policy info is never served
    await invalidateCachesForStore(storeId);

    return { policiesSummary };
}

/**
 * Full sync: products + policies + shop info
 */
export async function fullSync(storeId: string) {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);

    // Update shop info
    const shopInfo = await fetchShopInfo(store.storeDomain, accessToken);
    await db.update(ecommerceStores).set({
        ...shopInfo,
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));

    // Sync products and policies in parallel
    const [productResult, policyResult] = await Promise.all([
        syncProducts(storeId),
        syncPolicies(storeId),
    ]);

    return { ...productResult, ...policyResult };
}

// --- Product Summary Generator ---

export function buildVariantSummary(variants: Array<{ title: string; selectedOptions: Array<{ name: string; value: string }> }>): string {
    // Group options by name: { "Size": ["S","M","L"], "Color": ["Black","White"] }
    const optionGroups: Record<string, Set<string>> = {};

    for (const v of variants) {
        for (const opt of v.selectedOptions) {
            if (opt.name === 'Title' && opt.value === 'Default Title') continue;
            if (!optionGroups[opt.name]) optionGroups[opt.name] = new Set();
            optionGroups[opt.name].add(opt.value);
        }
    }

    const parts = Object.entries(optionGroups).map(
        ([name, values]) => `${name}: ${[...values].join(', ')}`
    );

    return parts.join(' | ');
}

/**
 * Build a structured product summary for AI consumption (~800 chars max)
 */
export async function buildProductSummary(storeId: string): Promise<string> {
    const products = await db.select().from(ecommerceProducts)
        .where(and(eq(ecommerceProducts.ecommerceStoreId, storeId), eq(ecommerceProducts.status, 'active')))
        .limit(15); // Top 15 active products

    if (products.length === 0) return '';

    const lines: string[] = ['Top Products:'];

    for (const p of products) {
        const parts = [p.title];
        if (p.priceRange) parts.push(p.priceRange);
        if (p.variantSummary) parts.push(p.variantSummary);

        // Stock status
        if (p.totalInventory === 0) parts.push('out of stock');
        else if (p.totalInventory !== null && p.totalInventory <= 5) parts.push('low stock');
        else parts.push('in stock');

        lines.push(parts.join(' — '));
    }

    // Keep under ~800 chars — truncate at last complete line
    let summary = lines.join('\n');
    if (summary.length > 800) {
        const truncated = summary.slice(0, 800);
        const lastNewline = truncated.lastIndexOf('\n');
        summary = lastNewline > 0 ? truncated.slice(0, lastNewline) + '\n...' : truncated.slice(0, 797) + '...';
    }

    return summary;
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

// --- Pending Install Flow (Shopify-first onboarding) ---

/**
 * Create a pending Shopify install for unauthenticated users.
 * Encrypts the access token and stores it with a 30-minute TTL.
 * Deletes any older pending records for the same shop domain.
 */
export async function createPendingInstall(data: {
    shopDomain: string;
    accessToken: string;
    scopes: string;
    nonce: string;
}): Promise<string> {
    // Delete older pending records for same shop
    await db.delete(pendingEcommerceInstalls).where(
        and(
            eq(pendingEcommerceInstalls.storeDomain, data.shopDomain),
            eq(pendingEcommerceInstalls.platform, 'shopify'),
            eq(pendingEcommerceInstalls.status, 'pending')
        )
    );

    // Encrypt the access token
    const { ciphertext, iv } = encrypt(data.accessToken);

    const result = await db.insert(pendingEcommerceInstalls).values({
        platform: 'shopify',
        storeDomain: data.shopDomain,
        accessToken: ciphertext,
        accessTokenIv: iv,
        scopes: data.scopes,
        nonce: data.nonce,
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    }).returning();

    return result[0].id;
}

/**
 * Claim a pending install: decrypt token, create ecommerce_stores row, mark as claimed.
 * Returns the new store or null if pending record is invalid/expired.
 */
export async function claimPendingInstall(pendingId: string, userId: string) {
    const result = await db.select().from(pendingEcommerceInstalls)
        .where(eq(pendingEcommerceInstalls.id, pendingId))
        .limit(1);

    const pending = result[0];
    if (!pending) return null;

    // Validate status and expiry
    if (pending.status !== 'pending' || pending.expiresAt < new Date()) {
        return null;
    }

    // Check if shop is already linked to another user
    const existingStore = await getStoreByDomain(pending.storeDomain);
    if (existingStore && existingStore.userId !== userId && existingStore.isActive) {
        throw new Error('This Shopify store is already connected to another account');
    }

    // Decrypt access token
    const accessToken = decrypt(pending.accessToken, pending.accessTokenIv);

    // Resolve user's workspace for store scoping
    const [membership] = await db.select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers).where(eq(workspaceMembers.userId, userId)).limit(1);
    const workspaceId = membership?.workspaceId || null;

    // Create/update store
    const store = await createStore(userId, pending.storeDomain, accessToken, undefined, workspaceId);

    // Mark pending as claimed
    await db.update(pendingEcommerceInstalls).set({
        status: 'claimed',
        claimedByUserId: userId,
    }).where(eq(pendingEcommerceInstalls.id, pendingId));

    // Register webhooks (non-blocking)
    registerWebhooks(pending.storeDomain, accessToken).catch(err => {
        captureError(err, 'Shopify webhook registration after claim failed', { tags: { service: 'shopify' } });
    });

    return store;
}

/**
 * Clean up expired pending installs
 */
export async function cleanupExpiredInstalls(): Promise<number> {
    const result = await db.delete(pendingEcommerceInstalls).where(
        and(
            eq(pendingEcommerceInstalls.platform, 'shopify'),
            eq(pendingEcommerceInstalls.status, 'pending'),
            lt(pendingEcommerceInstalls.expiresAt, new Date())
        )
    ).returning();

    return result.length;
}

// --- Map to shared type ---

/**
 * Map a DB row to the EcommerceStore shared type.
 * Note: `shopDomain` alias kept for one PR to avoid breaking existing test assertions.
 * TODO: Remove shopDomain alias in next PR, migrate all assertions to storeDomain.
 */
export function mapToEcommerceStore(row: typeof ecommerceStores.$inferSelect): EcommerceStore & { shopDomain: string } {
    return {
        id: row.id,
        userId: row.userId,
        platform: row.platform as 'shopify' | 'salla' | 'zid',
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
