import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as sallaService from '../services/salla';
import {
    getStoreByDomain,
    getStoreByWorkspace,
    createStore,
    disconnectStore,
    linkStoreToPage,
    getProducts,
    mapToEcommerceStore,
    createPendingInstall,
} from '../services/ecommerce';
import { authService } from '../services/auth';
import { workspaceService } from '../services/workspace';
import type { WorkspaceRequest } from '../middleware/workspace';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
import { config } from '../config';
import {
    PENDING_SALLA_COOKIE_OPTIONS,
    SALLA_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';

// --- Helpers ---

function tryGetUserId(request: FastifyRequest): string | null {
    try {
        let token: string | undefined;

        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (request.cookies.token) {
            const unsigned = request.unsignCookie(request.cookies.token);
            if (unsigned.valid && unsigned.value) {
                token = unsigned.value;
            } else {
                return null;
            }
        }

        if (!token) return null;

        const payload = authService.verifyToken(token);
        return payload?.userId || null;
    } catch {
        return null;
    }
}

// --- OAuth Flow (PUBLIC — no JWT required) ---

export async function authRedirect(_request: FastifyRequest, reply: FastifyReply) {
    // Salla doesn't need a shop domain — merchant authenticates directly
    const nonce = crypto.randomBytes(16).toString('hex');

    reply.setCookie('sallaNonce', nonce, SALLA_NONCE_COOKIE_OPTIONS);

    const authUrl = sallaService.buildAuthUrl(nonce);
    return reply.redirect(authUrl);
}

export async function authCallback(request: FastifyRequest, reply: FastifyReply) {
    const { code, state } = request.query as {
        code?: string; state?: string;
    };

    // Validate nonce from signed cookie matches state param
    const nonceCookie = request.cookies.sallaNonce;
    let storedNonce: string | null = null;
    if (nonceCookie) {
        const unsigned = request.unsignCookie(nonceCookie);
        if (unsigned.valid && unsigned.value) {
            storedNonce = unsigned.value;
        }
    }

    if (!code || !state || state !== storedNonce) {
        return reply.status(400).send({ error: 'Invalid OAuth callback: state mismatch' });
    }

    // Clear the nonce cookie
    reply.clearCookie('sallaNonce', { path: '/' });

    const frontendUrl = config.frontendUrl;

    try {
        // Exchange code for tokens
        const tokens = await sallaService.exchangeCodeForToken(code);

        // Fetch store info to get domain (used as unique identifier)
        const storeInfo = await sallaService.fetchStoreInfo(tokens.accessToken);

        // Check if user is already logged in
        const userId = tryGetUserId(request);

        if (userId) {
            // --- LOGGED IN: Create store directly ---
            const workspaces = await workspaceService.getUserWorkspaces(userId);
            const workspaceId = workspaces[0]?.id || null;

            const store = await createStore({
                userId,
                platform: 'salla',
                storeDomain: storeInfo.storeDomain,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                shopInfo: {
                    shopName: storeInfo.storeName,
                    shopEmail: storeInfo.storeEmail,
                    shopCurrency: storeInfo.storeCurrency,
                },
                platformData: { merchantId: storeInfo.merchantId },
                workspaceId,
            });

            // Register webhooks (non-blocking)
            sallaService.registerWebhooks(tokens.accessToken).catch(err => {
                request.log.error({ err }, 'Failed to register Salla webhooks');
            });

            // Enqueue full sync (non-blocking)
            enqueueSyncJob(store.id, 'salla').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Salla sync');
            });

            return reply.redirect(`${frontendUrl}/salla/onboarding`);
        } else {
            // --- NOT LOGGED IN: Create pending install ---
            const existingStore = await getStoreByDomain('salla', storeInfo.storeDomain);
            if (existingStore && existingStore.isActive) {
                return reply.redirect(`${frontendUrl}/login?salla_error=already_connected`);
            }

            const pendingId = await createPendingInstall('salla', {
                storeDomain: storeInfo.storeDomain,
                accessToken: tokens.accessToken,
                scopes: config.salla.scopes,
                nonce: state,
            });

            reply.setCookie('pendingSallaId', pendingId, PENDING_SALLA_COOKIE_OPTIONS);

            return reply.redirect(`${frontendUrl}/login?salla_pending=true`);
        }
    } catch (error) {
        request.log.error({ error }, 'Salla auth callback failed');
        return reply.redirect(`${frontendUrl}/login?salla_error=auth_failed`);
    }
}

// --- Webhooks (Salla calls these — HMAC verified with hex digest) ---

function verifySallaWebhookHmac(request: FastifyRequest, reply: FastifyReply): boolean {
    const signature = request.headers['x-salla-signature'] as string;
    const rawBody = request.rawBody;
    if (!rawBody) {
        reply.status(401).send({ error: 'Missing raw body for HMAC verification' });
        return false;
    }
    const body = rawBody.toString('utf8');
    if (!signature || !sallaService.verifyWebhookHmac(body, signature)) {
        reply.status(401).send({ error: 'Invalid HMAC' });
        return false;
    }
    return true;
}

export async function webhookProductUpdate(request: FastifyRequest, reply: FastifyReply) {
    if (!verifySallaWebhookHmac(request, reply)) return;

    const { merchant } = request.body as { merchant?: number };
    if (merchant) {
        // Find store by merchantId in platformData
        const store = await getStoreByDomain('salla', String(merchant));
        if (store) {
            enqueueSyncJob(store.id, 'salla').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Salla product sync');
            });
        }
    }

    return reply.status(200).send({ ok: true });
}

export async function webhookUninstall(request: FastifyRequest, reply: FastifyReply) {
    if (!verifySallaWebhookHmac(request, reply)) return;

    const { merchant } = request.body as { merchant?: number };
    if (merchant) {
        const { deactivateStore } = await import('../services/ecommerce');
        // Look up store by merchantId — store domain is the merchant's domain
        // For Salla, the merchant ID is stored as storeDomain
        await deactivateStore('salla', String(merchant));
    }

    return reply.status(200).send({ ok: true });
}

// --- Protected API (Jawab24 JWT required) ---

export async function getStore(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await getStoreByWorkspace('salla', req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Salla store connected' });
    }
    return reply.send(mapToEcommerceStore(store));
}

export async function connectStore(_request: FastifyRequest, reply: FastifyReply) {
    // Salla doesn't need a shop domain — just return the auth URL
    const nonce = crypto.randomBytes(16).toString('hex');
    reply.setCookie('sallaNonce', nonce, SALLA_NONCE_COOKIE_OPTIONS);

    const authUrl = sallaService.buildAuthUrl(nonce);
    return reply.send({ authUrl });
}

export async function disconnectStoreHandler(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await getStoreByWorkspace('salla', req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Salla store connected' });
    }
    await disconnectStore(store.id);
    return reply.send({ ok: true });
}

export async function syncStore(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await getStoreByWorkspace('salla', req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Salla store connected' });
    }

    const result = await sallaService.fullSync(store.id);
    return reply.send(result);
}

export async function getStoreProducts(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await getStoreByWorkspace('salla', req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Salla store connected' });
    }

    const products = await getProducts(store.id);
    return reply.send({ products, total: products.length });
}

export async function linkPage(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const { pageId } = request.body as { pageId?: string };

    if (!pageId) {
        return reply.status(400).send({ error: 'pageId is required' });
    }

    const store = await getStoreByWorkspace('salla', req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Salla store connected' });
    }

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
