import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { shopifyStores, shopifyProducts, pages } from '../db/schema';
import { config } from '../config';
import type { ShopifyStore, ShopifyProduct } from '@jawab24/shared';

const KB_MAX_CHARS = 1500; // Must match ai-worker's KB_MAX_CHARS

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
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

// --- Store CRUD ---

export async function getStoreByDomain(shopDomain: string) {
    const result = await db.select().from(shopifyStores).where(eq(shopifyStores.shopDomain, shopDomain)).limit(1);
    return result[0] || null;
}

export async function getStoreByUserId(userId: string) {
    const result = await db.select().from(shopifyStores).where(
        and(eq(shopifyStores.userId, userId), eq(shopifyStores.isActive, true))
    ).limit(1);
    return result[0] || null;
}

export async function getStoreById(storeId: string) {
    const result = await db.select().from(shopifyStores).where(eq(shopifyStores.id, storeId)).limit(1);
    return result[0] || null;
}

export async function createStore(userId: string, shopDomain: string, accessToken: string, shopInfo?: {
    shopName?: string; shopEmail?: string; shopCurrency?: string; shopTimezone?: string; planName?: string;
}) {
    const result = await db.insert(shopifyStores).values({
        userId,
        shopDomain,
        accessToken,
        shopName: shopInfo?.shopName,
        shopEmail: shopInfo?.shopEmail,
        shopCurrency: shopInfo?.shopCurrency,
        shopTimezone: shopInfo?.shopTimezone,
        planName: shopInfo?.planName,
        installedAt: new Date(),
    }).onConflictDoUpdate({
        target: shopifyStores.shopDomain,
        set: {
            userId,
            accessToken,
            shopName: shopInfo?.shopName,
            shopEmail: shopInfo?.shopEmail,
            shopCurrency: shopInfo?.shopCurrency,
            shopTimezone: shopInfo?.shopTimezone,
            planName: shopInfo?.planName,
            isActive: true,
            uninstalledAt: null,
            updatedAt: new Date(),
        },
    }).returning();

    return result[0];
}

export async function deactivateStore(shopDomain: string) {
    await db.update(shopifyStores).set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
    }).where(eq(shopifyStores.shopDomain, shopDomain));
}

export async function disconnectStore(storeId: string) {
    // Unlink any pages connected to this store
    await db.update(pages).set({ shopifyStoreId: null, updatedAt: new Date() })
        .where(eq(pages.shopifyStoreId, storeId));
    // Deactivate the store
    await db.update(shopifyStores).set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
    }).where(eq(shopifyStores.id, storeId));
}

/**
 * Link a Shopify store to a Facebook/Instagram page
 */
export async function linkStoreToPage(storeId: string, pageId: string) {
    await db.update(pages).set({ shopifyStoreId: storeId, updatedAt: new Date() })
        .where(eq(pages.id, pageId));
}

// --- Shopify Admin API helpers ---

async function shopifyGraphQL(shop: string, accessToken: string, query: string) {
    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query }),
    });

    if (!response.ok) {
        throw new Error(`Shopify GraphQL error: ${response.status}`);
    }

    return response.json();
}

async function fetchShopInfo(shop: string, accessToken: string) {
    const data = await shopifyGraphQL(shop, accessToken, `{
        shop {
            name
            email
            currencyCode
            timezoneAbbreviation
            plan { displayName }
        }
    }`) as { data: { shop: { name: string; email: string; currencyCode: string; timezoneAbbreviation: string; plan: { displayName: string } } } };

    const s = data.data.shop;
    return {
        shopName: s.name,
        shopEmail: s.email,
        shopCurrency: s.currencyCode,
        shopTimezone: s.timezoneAbbreviation,
        planName: s.plan?.displayName,
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

/**
 * Sync all active products from Shopify store
 */
export async function syncProducts(storeId: string) {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const data = await shopifyGraphQL(store.shopDomain, store.accessToken, `{
        products(first: 50, query: "status:active") {
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
            }
        }
    }`) as { data: { products: { edges: Array<{ node: ShopifyGQLProduct }> } } };

    const products = data.data.products.edges.map(e => e.node);

    // Clear old products for this store, then insert fresh
    await db.delete(shopifyProducts).where(eq(shopifyProducts.shopifyStoreId, storeId));

    for (const p of products) {
        const minPrice = parseFloat(p.priceRangeV2.minVariantPrice.amount);
        const maxPrice = parseFloat(p.priceRangeV2.maxVariantPrice.amount);
        const currency = p.priceRangeV2.minVariantPrice.currencyCode;
        const priceRange = minPrice === maxPrice
            ? `${minPrice} ${currency}`
            : `${minPrice} - ${maxPrice} ${currency}`;

        // Build variant summary: "S, M, L in Black, White"
        const variantSummary = buildVariantSummary(p.variants.edges.map(e => e.node));

        await db.insert(shopifyProducts).values({
            shopifyStoreId: storeId,
            shopifyProductId: p.id.replace('gid://shopify/Product/', ''),
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
        });
    }

    // Build and store the product summary
    const productSummary = await buildProductSummary(storeId);

    await db.update(shopifyStores).set({
        productCount: products.length,
        productSummary,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
    }).where(eq(shopifyStores.id, storeId));

    return { synced: products.length };
}

/**
 * Sync store policies (shipping, returns, etc.)
 */
export async function syncPolicies(storeId: string) {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const data = await shopifyGraphQL(store.shopDomain, store.accessToken, `{
        shop {
            shippingPolicy { body }
            refundPolicy { body }
        }
    }`) as { data: { shop: { shippingPolicy: { body: string } | null; refundPolicy: { body: string } | null } } };

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

    await db.update(shopifyStores).set({
        policiesSummary,
        updatedAt: new Date(),
    }).where(eq(shopifyStores.id, storeId));

    return { policiesSummary };
}

/**
 * Full sync: products + policies + shop info
 */
export async function fullSync(storeId: string) {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    // Update shop info
    const shopInfo = await fetchShopInfo(store.shopDomain, store.accessToken);
    await db.update(shopifyStores).set({
        ...shopInfo,
        updatedAt: new Date(),
    }).where(eq(shopifyStores.id, storeId));

    // Sync products and policies in parallel
    const [productResult, policyResult] = await Promise.all([
        syncProducts(storeId),
        syncPolicies(storeId),
    ]);

    return { ...productResult, ...policyResult };
}

// --- Product Summary Generator (Step 7) ---

function buildVariantSummary(variants: Array<{ title: string; selectedOptions: Array<{ name: string; value: string }> }>): string {
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
async function buildProductSummary(storeId: string): Promise<string> {
    const products = await db.select().from(shopifyProducts)
        .where(and(eq(shopifyProducts.shopifyStoreId, storeId), eq(shopifyProducts.status, 'active')))
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

    // Keep under ~800 chars
    let summary = lines.join('\n');
    if (summary.length > 800) {
        summary = summary.slice(0, 797) + '...';
    }

    return summary;
}

// --- KB Enrichment (Step 8) ---

/**
 * Get enriched knowledge base: Shopify products + policies + page KB
 * Priority: 1) Products (~800 chars)  2) Policies (~200 chars)  3) Page KB (remaining space)
 */
export async function getEnrichedKnowledgeBase(pageKB: string | undefined, shopifyStoreId: string): Promise<string> {
    const store = await getStoreById(shopifyStoreId);
    if (!store || !store.isActive) return pageKB || '';

    const productSection = store.productSummary || '';
    const policySection = store.policiesSummary || '';

    const shopifySection = [productSection, policySection].filter(Boolean).join('\n');
    const remaining = KB_MAX_CHARS - shopifySection.length;
    const pageSection = (pageKB && remaining > 100) ? pageKB.slice(0, remaining) : '';

    return [shopifySection, pageSection].filter(Boolean).join('\n\n');
}

// --- List products for frontend ---

export async function getProducts(storeId: string): Promise<ShopifyProduct[]> {
    const rows = await db.select().from(shopifyProducts)
        .where(eq(shopifyProducts.shopifyStoreId, storeId));

    return rows.map(r => ({
        id: r.id,
        shopifyStoreId: r.shopifyStoreId,
        shopifyProductId: r.shopifyProductId,
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

// --- Map to shared type ---

export function mapToShopifyStore(row: typeof shopifyStores.$inferSelect): ShopifyStore {
    return {
        id: row.id,
        userId: row.userId,
        shopDomain: row.shopDomain,
        shopName: row.shopName,
        shopEmail: row.shopEmail,
        shopCurrency: row.shopCurrency,
        productCount: row.productCount || 0,
        productSummary: row.productSummary,
        policiesSummary: row.policiesSummary,
        lastSyncAt: row.lastSyncAt,
        isActive: row.isActive ?? true,
        installedAt: row.installedAt,
    };
}
