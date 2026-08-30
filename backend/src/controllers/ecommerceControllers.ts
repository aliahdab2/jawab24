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
    /**
     * Zid only: the second credential from Zid's token response (`Authorization` field).
     * Zid API calls need BOTH — access_token as X-Manager-Token AND this as
     * `Authorization: Bearer`. Absent for Salla (single-token platforms).
     */
    authorizationToken?: string;
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
    /** Fetches store info (domain, name, currency, merchantId) using the exchanged tokens. */
    fetchStoreInfo: (tokens: OAuthTokenResponse) => Promise<OAuthStoreInfo>;
    /**
     * Registers the platform's webhooks for the just-connected store. Receives the full
     * token response (Zid needs both credentials) and the new store's id (Zid embeds it
     * in each subscription's target_url for deterministic webhook routing).
     */
    registerWebhooks: (tokens: OAuthTokenResponse, storeId: string) => Promise<WebhookRegistrationResult>;
    /** OAuth scopes string, persisted on the pending install. */
    scopes: string;
    /** Cookie name for the pending-install id (claim flow). */
    pendingCookieName: string;
    /** Cookie options for the pending-install cookie. */
    pendingCookieOptions: CookieOptions;

    // --- Optional platform hooks (all default to the pre-hook behavior) ---

    /**
     * Where a completed install lands when postInstall does not override the
     * redirect. Defaults to `/${platform}/onboarding` (Shopify/Salla wizards);
     * Zid retired its wizard (D-119) and lands on the connect flow instead.
     */
    onboardingPath?: string;

    /**
     * Auto-provision a merchant account from the platform-asserted store
     * identity, for App Market installs that arrive with no Jawab24 session
     * ("direct merchant access, no sign-in prompt" — the Zid review standard).
     * Return null to fall back to the pending-install claim flow (e.g. the
     * store email already belongs to an account, or is missing).
     */
    provisionMerchant?: (storeInfo: OAuthStoreInfo) => Promise<{ userId: string } | null>;
    /**
     * Runs after a store install completes (store created, webhooks registered,
     * sync enqueued) on every path — logged-in, auto-provisioned, and platform
     * reinstall — e.g. Zid embedded-token registration. `platformInitiated` is
     * true when the install arrived with no Jawab24 session (App Market flow),
     * where the returned redirect is the merchant's ONLY way into the app. A
     * returned URL replaces the default post-install redirect; null keeps it.
     */
    postInstall?: (
        store: { id: string; storeDomain: string },
        tokens: OAuthTokenResponse,
        storeInfo: OAuthStoreInfo,
        platformInitiated: boolean,
        log: FastifyRequest['log'],
    ) => Promise<string | null>;
    /**
     * How to treat a platform-initiated install (no session) for a store that
     * ALREADY exists — active or uninstalled. The server-to-server code
     * exchange proves the platform sent us here for THAT store, so
     * 'reactivate-for-owner' rotates tokens and reactivates it for its
     * EXISTING owner in its EXISTING workspace (ownership is never re-bound),
     * then runs postInstall for the redirect. Omitted: active stores bounce to
     * `already_connected`, inactive ones fall to the pending-install claim
     * flow (pre-hook behavior).
     */
    reinstallPolicy?: 'reactivate-for-owner';
    /**
     * Platform-side teardown for a merchant-initiated disconnect. Runs BEFORE
     * disconnectStore, which blanks the OAuth tokens such a call needs. Must
     * not throw — a failed remote revocation cannot block the disconnect.
     */
    onDisconnect?: (storeId: string, log: FastifyRequest['log']) => Promise<void>;
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

        // Create the store + webhooks + sync for a known owner — shared by the
        // logged-in, auto-provisioned, and reinstall paths (one body). The
        // reinstall path passes workspaceIdOverride so the store stays in its
        // ORIGINAL workspace — resolving workspaces[0] for a multi-workspace
        // owner would silently move it.
        async function installStoreForUser(
            ownerId: string,
            tokens: OAuthTokenResponse,
            storeInfo: OAuthStoreInfo,
            tokenExpiresAt: Date,
            log: FastifyRequest['log'],
            workspaceIdOverride?: string | null,
        ) {
            const workspaceId = workspaceIdOverride !== undefined
                ? workspaceIdOverride
                : (await workspaceService.getUserWorkspaces(ownerId))[0]?.id || null;

            const store = await createStore({
                userId: ownerId,
                platform,
                storeDomain: storeInfo.storeDomain,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                authorizationToken: tokens.authorizationToken,
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
                () => adapter.registerWebhooks(tokens, store.id),
            );

            enqueueSyncJob(store.id, platform).catch(err => {
                log.error({ err }, `Failed to enqueue ${platformLabel} sync`);
            });

            return store;
        }

        try {
            const tokens = await adapter.exchangeCodeForToken(code);
            const storeInfo = await adapter.fetchStoreInfo(tokens);
            const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

            const userId = tryGetUserId(request);

            if (userId) {
                // --- LOGGED IN: create store directly ---
                const store = await installStoreForUser(userId, tokens, storeInfo, tokenExpiresAt, request.log);

                const redirectOverride = adapter.postInstall
                    ? await adapter.postInstall(store, tokens, storeInfo, false, request.log)
                    : null;
                return reply.redirect(redirectOverride ?? `${frontendUrl}${adapter.onboardingPath ?? `/${platform}/onboarding`}`);
            } else {
                // --- NOT LOGGED IN (platform-initiated install) ---
                const existingStore = await getStoreByDomain(platform, storeInfo.storeDomain);

                if (existingStore) {
                    // Reinstall of a known store. The code exchange proves the
                    // platform sent us here for THIS store, so the policy may
                    // rotate tokens and reactivate it for its EXISTING owner in
                    // its EXISTING workspace (createStore's upsert — ownership
                    // is never re-bound). Without the policy: active stores keep
                    // the already_connected bounce, inactive ones fall through
                    // to the pending-install claim flow (pre-hook behavior).
                    if (adapter.reinstallPolicy === 'reactivate-for-owner') {
                        const store = await installStoreForUser(
                            existingStore.userId, tokens, storeInfo, tokenExpiresAt,
                            request.log, existingStore.workspaceId ?? null,
                        );
                        const redirectOverride = adapter.postInstall
                            ? await adapter.postInstall(store, tokens, storeInfo, true, request.log)
                            : null;
                        // A reactivation SUCCEEDED — onboarding is the honest
                        // destination, not `already_connected` on a login page
                        // (the login wall this whole flow exists to remove). The
                        // override is normally set (Zid sends them to the framed
                        // dashboard); this fallback only fires for a platform that
                        // reactivates without its own post-install redirect.
                        return reply.redirect(redirectOverride ?? `${frontendUrl}${adapter.onboardingPath ?? `/${platform}/onboarding`}`);
                    }
                    if (existingStore.isActive) {
                        return reply.redirect(`${frontendUrl}/login?${platform}_error=already_connected`);
                    }
                }

                // Fresh store, no session: auto-provision a merchant account from
                // the platform-asserted identity when the adapter supports it
                // ("direct merchant access" — the merchant never sees a login).
                if (!existingStore && adapter.provisionMerchant) {
                    const provisioned = await adapter.provisionMerchant(storeInfo);
                    if (provisioned) {
                        const store = await installStoreForUser(
                            provisioned.userId, tokens, storeInfo, tokenExpiresAt, request.log,
                        );
                        const redirectOverride = adapter.postInstall
                            ? await adapter.postInstall(store, tokens, storeInfo, true, request.log)
                            : null;
                        return reply.redirect(redirectOverride ?? `${frontendUrl}${adapter.onboardingPath ?? `/${platform}/onboarding`}`);
                    }
                }

                // Fall back: pending install, claimed after login.
                const pendingId = await createPendingInstall(platform, {
                    storeDomain: storeInfo.storeDomain,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    authorizationToken: tokens.authorizationToken,
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
        // Platform-side teardown BEFORE disconnectStore blanks the tokens it needs
        // (Zid: revoke the embedded-app session token — a surviving one would keep
        // the in-dashboard entry able to open a session for a disconnected store).
        if (adapter.onDisconnect) await adapter.onDisconnect(store.id, request.log);
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
