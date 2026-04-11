/**
 * Shared token-refresh logic for e-commerce platforms (Salla, Zid).
 *
 * Both platforms use:
 *  - Distributed Redis locking to prevent concurrent single-use token invalidation
 *  - The same 24h-ahead refresh window
 *  - The same DB helpers (getStoreById, updateStoreTokens)
 *
 * Platform-specific values are injected via `TokenRefreshConfig`.
 */
import { tracedExternalCall } from '../utils/tracing';
import { eq, and, lt } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores } from '../db/schema';
import { decrypt } from './ecommerceCrypto';
import { captureError } from '../utils/sentryHelpers';
import { redis } from '../lib/redis';
import { getStoreById, updateStoreTokens } from './ecommerce';

const LOCK_WAIT_DELAY_MS = 2000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenRefreshConfig {
    /** Platform label — used in lock keys, error messages, and tracing */
    platform: 'salla' | 'zid';
    /** Token endpoint URL, e.g. "https://accounts.salla.sa/oauth2/token" */
    tokenEndpointUrl: string;
    /** OAuth client ID */
    clientId: string;
    /** OAuth client secret */
    clientSecret: string;
}

/**
 * Refresh the access token for a store.
 *
 * Uses a Redis distributed lock to prevent concurrent refreshes — both Salla and Zid
 * have single-use refresh tokens, so a race condition would permanently invalidate the token.
 */
function platformLabel(cfg: TokenRefreshConfig): string {
    return cfg.platform.charAt(0).toUpperCase() + cfg.platform.slice(1);
}

export async function refreshAccessToken(storeId: string, cfg: TokenRefreshConfig): Promise<void> {
    const lockKey = `${cfg.platform}:token_refresh:${storeId}`;

    // Acquire lock (NX = only if not exists, EX = 30s TTL as safety net)
    const acquired = await redis.set(lockKey, '1', 'EX', 30, 'NX');
    if (!acquired) {
        // Another process is refreshing — wait and re-read from DB
        await new Promise(r => setTimeout(r, LOCK_WAIT_DELAY_MS));
        return;
    }

    try {
        const store = await getStoreById(storeId);
        if (!store) throw new Error('Store not found');

        // Re-check expiry (may have been refreshed while waiting for lock)
        const oneDayFromNow = new Date(Date.now() + ONE_DAY_MS);
        if (store.tokenExpiresAt && store.tokenExpiresAt > oneDayFromNow) return;

        if (!store.refreshToken || !store.refreshTokenIv) {
            throw new Error(`No refresh token for ${platformLabel(cfg)} store ${storeId}`);
        }

        const refreshToken = decrypt(store.refreshToken, store.refreshTokenIv);

        const response = await tracedExternalCall(cfg.platform, 'refreshAccessToken', () =>
            fetch(cfg.tokenEndpointUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: cfg.clientId,
                    client_secret: cfg.clientSecret,
                }),
            }),
        );

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`${platformLabel(cfg)} token refresh failed: ${response.status} ${text}`);
        }

        const data = await response.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
        };

        await updateStoreTokens(storeId, {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        });
    } finally {
        await redis.del(lockKey);
    }
}

/**
 * Ensure the store has a valid access token. Refreshes if the token expires within 24h.
 */
export async function ensureValidToken(storeId: string, cfg: TokenRefreshConfig): Promise<void> {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    // If no expiry set, the token is assumed non-expiring (e.g. Zid's 1-year tokens
    // that were stored without an explicit expiry date)
    if (!store.tokenExpiresAt) return;

    const oneDayFromNow = new Date(Date.now() + ONE_DAY_MS);
    if (store.tokenExpiresAt > oneDayFromNow) return;

    await refreshAccessToken(storeId, cfg);
}

/**
 * Return store IDs whose tokens expire within 2 days (for periodic proactive refresh).
 */
export async function getStoresNeedingTokenRefresh(platform: 'salla' | 'zid') {
    const twoDaysFromNow = new Date(Date.now() + 2 * ONE_DAY_MS);
    return db.select({ id: ecommerceStores.id }).from(ecommerceStores).where(
        and(
            eq(ecommerceStores.platform, platform),
            eq(ecommerceStores.isActive, true),
            lt(ecommerceStores.tokenExpiresAt, twoDaysFromNow),
        )
    );
}

/**
 * Refresh tokens for all stores of a given platform that are nearing expiry.
 * Returns the number of stores successfully refreshed.
 */
export async function refreshExpiringTokens(cfg: TokenRefreshConfig): Promise<number> {
    const stores = await getStoresNeedingTokenRefresh(cfg.platform);
    let refreshed = 0;

    for (const { id } of stores) {
        try {
            await refreshAccessToken(id, cfg);
            refreshed++;
        } catch (err) {
            captureError(err, `${cfg.platform} token refresh failed for store ${id}`, {
                tags: { service: cfg.platform },
                extra: { storeId: id },
            });
        }
    }

    return refreshed;
}
