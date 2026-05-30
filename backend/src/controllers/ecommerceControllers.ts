import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import {
    getStoreByWorkspace,
    getStoreByWorkspaceAny,
    getStoreByDomain,
    createStore,
    createPendingInstall,
    registerWebhooksWithPersist,
    disconnectStore,
    linkStoreToPage,
    unlinkStoreFromPage,
    getProducts,
    mapToEcommerceStore,
} from '../services/ecommerce';
import type { EcommercePlatform, WebhookRegistrationResult } from '../services/ecommerce';
import { workspaceService } from '../services/workspace';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
import { tryGetUserId } from '../utils/authHelpers';
import { config } from '../config';

type CookieOptions = Parameters<FastifyReply['setCookie']>[2];

/** Token response shape returned by a redirect-based platform's code exchange. */
export interface OAuthTokenResponse {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
}

/** Store metadata fetched after a successful code exchange. */
export interface OAuthStoreInfo {
    storeDomain: string;
    storeName?: string;
    storeEmail?: string;
    storeCurrency?: string;
    merchantId?: string;
}

export interface EcommerceControllerAdapter {
    /** Triggers a full product + store-info sync. */
    fullSync: (storeId: string) => Promise<unknown>;
    /** Builds the OAuth authorization URL (no domain input — Salla/Zid pattern). */
    buildAuthUrl: (nonce: string) => string;
    /** Cookie name for the OAuth nonce (e.g. 'sallaNonce'). */
    nonceCookieName: string;
    /** Cookie options for the nonce cookie. */
    nonceCookieOptions: CookieOptions;
    // --- OAuth callback hooks (redirect-based platforms: Salla, Zid) ---
    /** Exchanges the authorization code for tokens. */
    exchangeCodeForToken: (code: string) => Promise<OAuthTokenResponse>;
    /** Fetches store info (domain, name, currency, merchantId) using the access token. */
    fetchStoreInfo: (accessToken: string) => Promise<OAuthStoreInfo>;
    /** Registers the platform's webhooks for the just-connected store. */
    registerWebhooks: (accessToken: string) => Promise<WebhookRegistrationResult>;
    /** OAuth scopes string, persisted on the pending install. */
    scopes: string;
    /** Cookie name for the pending-install id (claim flow). */
    pendingCookieName: string;
    /** Cookie options for the pending-install cookie. */
    pendingCookieOptions: CookieOptions;
}

/**
 * Factory that creates the 7 protected API handlers shared by all redirect-based
 * OAuth platforms (Salla, Zid). Shopify is excluded — it uses a domain-input flow.
 *
 * Usage:
 *   export const { getStore, connectStore, ... } = createEcommerceControllers('salla', sallaAdapter);
 */
export function createEcommerceControllers(platform: EcommercePlatform, adapter: EcommerceControllerAdapter) {
    const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);

    // --- OAuth flow (PUBLIC — no JWT). Shared by redirect-based platforms (Salla, Zid).
    //     Shopify is excluded (domain-input + HMAC-callback flow) and keeps its own. ---

    async function authRedirect(_request: FastifyRequest, reply: FastifyReply) {
        // No shop domain — the merchant authenticates directly on the platform.
        const nonce = crypto.randomBytes(16).toString('hex');
        reply.setCookie(adapter.nonceCookieName, nonce, adapter.nonceCookieOptions);
        return reply.redirect(adapter.buildAuthUrl(nonce));
    }

    async function authCallback(request: FastifyRequest, reply: FastifyReply) {
        const { code, state } = request.query as { code?: string; state?: string };

        if (!code) {
            return reply.status(400).send({ error: 'Invalid OAuth callback: missing code' });
        }

        // CSRF state validation applies ONLY to merchant-initiated installs — flows we
        // started via GET /<platform>/auth, which sets the signed nonce cookie. Platform-
        // initiated installs (App Store / App Market) redirect straight here with their own
        // state and no prior nonce, so there's nothing to match against; the server-to-server
        // code exchange (client_secret) is the trust anchor. Tampered cookies are still
        // rejected — they must NOT fall through to the platform-initiated path.
        const nonceCookie = request.cookies[adapter.nonceCookieName];
        if (nonceCookie) {
            const unsigned = request.unsignCookie(nonceCookie);
            const storedNonce = unsigned.valid ? unsigned.value : null;
            if (!storedNonce || state !== storedNonce) {
                return reply.status(400).send({ error: 'Invalid OAuth callback: state mismatch' });
            }
            reply.clearCookie(adapter.nonceCookieName, { path: '/' });
        }

        const frontendUrl = config.frontendUrl;

        try {
            const tokens = await adapter.exchangeCodeForToken(code);
            const storeInfo = await adapter.fetchStoreInfo(tokens.accessToken);
            const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

            const userId = tryGetUserId(request);

            if (userId) {
                // --- LOGGED IN: create store directly ---
                const workspaces = await workspaceService.getUserWorkspaces(userId);
                const workspaceId = workspaces[0]?.id || null;

                const store = await createStore({
                    userId,
                    platform,
                    storeDomain: storeInfo.storeDomain,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt,
                    shopInfo: {
                        shopName: storeInfo.storeName,
                        shopEmail: storeInfo.storeEmail,
                        shopCurrency: storeInfo.storeCurrency,
                    },
                    platformData: { merchantId: storeInfo.merchantId },
                    workspaceId,
                });

                // Webhooks via persist-on-throw + retry queue — install never fails on a
                // webhook hiccup (a marker is persisted + a retry enqueued).
                await registerWebhooksWithPersist(
                    store.id,
                    platform,
                    () => adapter.registerWebhooks(tokens.accessToken),
                );

                enqueueSyncJob(store.id, platform).catch(err => {
                    request.log.error({ err }, `Failed to enqueue ${platformLabel} sync`);
                });

                return reply.redirect(`${frontendUrl}/${platform}/onboarding`);
            } else {
                // --- NOT LOGGED IN: create pending install (claim after login) ---
                const existingStore = await getStoreByDomain(platform, storeInfo.storeDomain);
                if (existingStore && existingStore.isActive) {
                    return reply.redirect(`${frontendUrl}/login?${platform}_error=already_connected`);
                }

                const pendingId = await createPendingInstall(platform, {
                    storeDomain: storeInfo.storeDomain,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt,
                    scopes: adapter.scopes,
                    // Platform-initiated installs may omit state; the claim flow keys off
                    // the signed pending cookie, not this value.
                    nonce: state ?? '',
                });

                reply.setCookie(adapter.pendingCookieName, pendingId, adapter.pendingCookieOptions);

                return reply.redirect(`${frontendUrl}/login?${platform}_pending=true`);
            }
        } catch (error) {
            request.log.error({ error }, `${platformLabel} auth callback failed`);
            return reply.redirect(`${frontendUrl}/login?${platform}_error=auth_failed`);
        }
    }

    async function getStore(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const store = await getStoreByWorkspaceAny(platform, req.workspaceId);
        if (!store) return reply.send(null);
        return reply.send(mapToEcommerceStore(store));
    }

    async function connectStore(_request: FastifyRequest, reply: FastifyReply) {
        const nonce = crypto.randomBytes(16).toString('hex');
        reply.setCookie(adapter.nonceCookieName, nonce, adapter.nonceCookieOptions);
        const authUrl = adapter.buildAuthUrl(nonce);
        return reply.send({ authUrl });
    }

    async function disconnectStoreHandler(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const store = await getStoreByWorkspace(platform, req.workspaceId);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        await disconnectStore(store.id);
        return reply.send({ ok: true });
    }

    async function syncStore(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const store = await getStoreByWorkspace(platform, req.workspaceId);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        const result = await adapter.fullSync(store.id);
        return reply.send(result);
    }

    async function getStoreProducts(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const store = await getStoreByWorkspace(platform, req.workspaceId);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        const products = await getProducts(store.id);
        return reply.send({ products, total: products.length });
    }

    async function linkPage(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.body as { pageId?: string };
        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });
        const store = await getStoreByWorkspace(platform, req.workspaceId);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        try {
            await linkStoreToPage(store.id, pageId, req.workspaceId);
            return reply.send({ ok: true });
        } catch (error) {
            if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
                return reply.status(403).send({ error: 'Page does not belong to workspace' });
            }
            throw error;
        }
    }

    async function unlinkPage(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.body as { pageId?: string };
        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });
        try {
            await unlinkStoreFromPage(pageId, req.workspaceId);
            return reply.send({ ok: true });
        } catch (error) {
            if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
                return reply.status(403).send({ error: 'Page does not belong to workspace' });
            }
            throw error;
        }
    }

    return {
        authRedirect,
        authCallback,
        getStore,
        connectStore,
        disconnectStoreHandler,
        syncStore,
        getStoreProducts,
        linkPage,
        unlinkPage,
    };
}
