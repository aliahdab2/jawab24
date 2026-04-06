import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../middleware/workspace';
import {
    getStoreByWorkspace,
    getStoreByWorkspaceAny,
    disconnectStore,
    linkStoreToPage,
    unlinkStoreFromPage,
    getProducts,
    mapToEcommerceStore,
} from '../services/ecommerce';
import type { EcommercePlatform } from '../services/ecommerce';

type CookieOptions = Parameters<FastifyReply['setCookie']>[2];

export interface EcommerceControllerAdapter {
    /** Triggers a full product + store-info sync. */
    fullSync: (storeId: string) => Promise<unknown>;
    /** Builds the OAuth authorization URL (no domain input — Salla/Zid pattern). */
    buildAuthUrl: (nonce: string) => string;
    /** Cookie name for the OAuth nonce (e.g. 'sallaNonce'). */
    nonceCookieName: string;
    /** Cookie options for the nonce cookie. */
    nonceCookieOptions: CookieOptions;
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

    async function getStore(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        const store = await getStoreByWorkspaceAny(platform, req.workspaceId!);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        return reply.send(mapToEcommerceStore(store));
    }

    async function connectStore(_request: FastifyRequest, reply: FastifyReply) {
        const nonce = crypto.randomBytes(16).toString('hex');
        reply.setCookie(adapter.nonceCookieName, nonce, adapter.nonceCookieOptions);
        const authUrl = adapter.buildAuthUrl(nonce);
        return reply.send({ authUrl });
    }

    async function disconnectStoreHandler(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        const store = await getStoreByWorkspace(platform, req.workspaceId!);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        await disconnectStore(store.id);
        return reply.send({ ok: true });
    }

    async function syncStore(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        const store = await getStoreByWorkspace(platform, req.workspaceId!);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        const result = await adapter.fullSync(store.id);
        return reply.send(result);
    }

    async function getStoreProducts(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        const store = await getStoreByWorkspace(platform, req.workspaceId!);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        const products = await getProducts(store.id);
        return reply.send({ products, total: products.length });
    }

    async function linkPage(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        const { pageId } = request.body as { pageId?: string };
        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });
        const store = await getStoreByWorkspace(platform, req.workspaceId!);
        if (!store) return reply.status(404).send({ error: `No ${platformLabel} store connected` });
        try {
            await linkStoreToPage(store.id, pageId, req.workspaceId!);
            return reply.send({ ok: true });
        } catch (error) {
            if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
                return reply.status(403).send({ error: 'Page does not belong to workspace' });
            }
            throw error;
        }
    }

    async function unlinkPage(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        const { pageId } = request.body as { pageId?: string };
        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });
        try {
            await unlinkStoreFromPage(pageId, req.workspaceId!);
            return reply.send({ ok: true });
        } catch (error) {
            if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
                return reply.status(403).send({ error: 'Page does not belong to workspace' });
            }
            throw error;
        }
    }

    return {
        getStore,
        connectStore,
        disconnectStoreHandler,
        syncStore,
        getStoreProducts,
        linkPage,
        unlinkPage,
    };
}
