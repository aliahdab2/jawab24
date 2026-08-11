/**
 * The Zid App Market install, replayed end-to-end — Integration (real Postgres)
 *
 * This is a LOCAL RE-RUN OF WHAT ZID'S REVIEWER DID on 2026-08-11 at 15:19 UTC,
 * reconstructed from the production log (requestId req-1w7):
 *
 *   1. GET /zid/auth                        → 302 to oauth.zid.sa (cookie set)
 *   2. GET /zid/auth/callback?code&state    → token exchange → profile fetch →
 *      auto-provision → createStore → 22001 → "Zid auth callback failed"
 *
 * The real Fastify routes, the real controllers, the real provisioning and the
 * real ecommerce_stores table (varchar(10) and all) run here; only the network
 * beyond our edge is played by a fetch mock returning the EXACT payloads Zid
 * sent — including `currency` as an object, the shape that took the install
 * down. Unit fixtures written from the docs could never catch this (they all
 * said `currency` is a string); this suite exists so the wire shape we now KNOW
 * is pinned at the level that actually broke.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { eq, and } from 'drizzle-orm';
import { testDb } from './setup';
import {
    users, workspaces, workspaceMembers, subscriptions, plans,
    ecommerceStores, pendingEcommerceInstalls,
} from '../../src/db/schema';

// BullMQ opens a redis connection at import time; the queue is out-of-process
// by definition and fire-and-forget on this path (.catch'd in the controller).
vi.mock('../../src/lib/ecommerceSyncQueue', () => ({
    enqueueSyncJob: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// The wire, verbatim from the 2026-08-11 production capture.
// ---------------------------------------------------------------------------

/** The profile envelope Zid actually returned — `currency` is an OBJECT. */
const LIVE_PROFILE_RESPONSE = {
    user: {
        id: 130216,
        email: 'appmarket@zid.sa',
        store: {
            id: 130216,
            title: 'Test',
            email: 'appmarket@zid.sa',
            url: 'https://a0xxorvfi5.zid.store',
            currency: {
                id: 4,
                name: 'ريال سعودي',
                code: 'SAR',
                symbol: ' ر.س ',
                country: {
                    id: 184, name: 'السعودية', priority: 1,
                    code: 'SA', country_code: 'SAU',
                    flag: 'https://media.zid.store/static/sa.svg',
                },
            },
        },
    },
};

/** Token response shape per docs + the ~3y expiry observed in the capture. */
const LIVE_TOKEN_RESPONSE = {
    access_token: 'live-replay-manager-token',
    refresh_token: 'live-replay-refresh-token',
    expires_in: 94_608_000, // ≈ 3 years — token_expires_at was 2029-08-11
    Authorization: 'live-replay-authorization-jwt',
};

/** Zid's side of every outbound call the install makes. */
function playZid(url: string): Response {
    if (url.startsWith('https://oauth.zid.sa/oauth/token')) {
        return new Response(JSON.stringify(LIVE_TOKEN_RESPONSE), { status: 200 });
    }
    if (url.startsWith('https://api.zid.sa/v1/managers/account/profile')) {
        return new Response(JSON.stringify(LIVE_PROFILE_RESPONSE), { status: 200 });
    }
    // Webhook subscriptions + embedded-apps-token registration.
    if (url.startsWith('https://api.zid.sa/')) {
        return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`Unexpected outbound call during replay: ${url}`);
}

const mockFetch = vi.fn(async (input: RequestInfo | URL) => playZid(String(input)));

// ---------------------------------------------------------------------------

const PLAN_SLUG = 'zid-replay-default';

describe('Zid App Market install — full callback replay (live capture 2026-08-11)', () => {
    let app: FastifyInstance;
    let realFetch: typeof global.fetch;

    beforeAll(async () => {
        realFetch = global.fetch;
        global.fetch = mockFetch as unknown as typeof global.fetch;

        // Reference data the per-test TRUNCATE does not cover — without a
        // default plan the subscription silently fails to seed (same pattern as
        // zidMerchantProvisioning.test.ts).
        await testDb.insert(plans).values({
            name: 'Trial', slug: PLAN_SLUG, price: 0, isDefault: true, isActive: true,
        }).onConflictDoNothing({ target: plans.slug });

        const { default: zidRoutes } = await import('../../src/routes/zid');
        app = fastify();
        await app.register(fastifyCookie, { secret: 'replay-cookie-secret' });
        await app.register(zidRoutes, { prefix: '/zid' });
        await app.ready();
    });

    afterAll(async () => {
        global.fetch = realFetch;
        await app.close();
        await testDb.delete(plans).where(eq(plans.slug, PLAN_SLUG)).catch(() => {});
    });

    beforeEach(() => {
        mockFetch.mockClear();
    });

    /** Steps 1+2 as the reviewer's client performed them (cookie jar kept). */
    async function performInstall() {
        const authRes = await app.inject({ method: 'GET', url: '/zid/auth' });
        expect(authRes.statusCode).toBe(302);
        expect(authRes.headers.location).toContain('oauth.zid.sa/oauth/authorize');

        const state = new URL(authRes.headers.location as string).searchParams.get('state');
        const nonceCookie = authRes.cookies.find(c => c.name === 'zidNonce');
        expect(nonceCookie).toBeDefined();

        return app.inject({
            method: 'GET',
            url: `/zid/auth/callback?code=live-replay-code&state=${state}`,
            cookies: { zidNonce: nonceCookie!.value },
        });
    }

    it('completes the install that failed in production — user, workspace, subscription, store', async () => {
        const res = await performInstall();

        // The production outcome was a 302 to /login?zid_error=auth_failed.
        // The fixed outcome is the documented Zid flow: straight into the
        // merchant dashboard's embedded app — no sign-in prompt anywhere.
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('dashboard.zid.sa');
        expect(res.headers.location).toContain('/embedded');
        expect(res.headers.location).not.toContain('/login');

        // The account production was left WITHOUT a store for:
        const [user] = await testDb.select().from(users)
            .where(eq(users.email, 'appmarket@zid.sa'));
        expect(user).toBeDefined();
        expect(user.name).toBe('Test');

        const memberships = await testDb.select().from(workspaceMembers)
            .where(eq(workspaceMembers.userId, user.id));
        expect(memberships).toHaveLength(1);
        expect(memberships[0].role).toBe('owner');

        const subs = await testDb.select().from(subscriptions)
            .where(eq(subscriptions.userId, user.id));
        expect(subs).toHaveLength(1);

        // The row the 22001 rejected, now landing — with the object's ISO code
        // in the varchar(10) column that threw.
        const [store] = await testDb.select().from(ecommerceStores).where(and(
            eq(ecommerceStores.platform, 'zid'),
            eq(ecommerceStores.storeDomain, 'a0xxorvfi5.zid.store'),
        ));
        expect(store).toBeDefined();
        expect(store.storeCurrency).toBe('SAR');
        expect(store.storeName).toBe('Test');
        expect(store.storeEmail).toBe('appmarket@zid.sa');
        expect(store.userId).toBe(user.id);
        expect(store.workspaceId).toBe(memberships[0].workspaceId);
        expect(store.isActive).toBe(true);
        expect((store.platformData as Record<string, unknown>).merchantId).toBe('130216');
        // Embedded token minted + hash stored — the merchant's in-dashboard entry.
        expect(store.embeddedTokenHash).toMatch(/^[0-9a-f]{64}$/);
        // ≈3-year expiry from the capture survived the trip.
        expect(store.tokenExpiresAt!.getFullYear()).toBe(new Date().getFullYear() + 3);
    });

    it('a RETRY while the orphan account exists falls back to the login wall — why the prod cleanup SQL must run', async () => {
        // The state production is in right now: the failed install's user row
        // exists, no store. provisionEcommerceMerchantUser must refuse the email
        // (account-takeover guard), so the reviewer would land on /login —
        // verbatim the defect app 7367 was rejected for on 2026-08-10.
        await testDb.insert(users).values({ email: 'appmarket@zid.sa', name: 'Test' });

        const res = await performInstall();

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('/login?zid_pending=true');

        // The claim-after-login staging row is the consolation prize.
        const pending = await testDb.select().from(pendingEcommerceInstalls).where(and(
            eq(pendingEcommerceInstalls.platform, 'zid'),
            eq(pendingEcommerceInstalls.storeDomain, 'a0xxorvfi5.zid.store'),
        ));
        expect(pending).toHaveLength(1);
        expect(pending[0].status).toBe('pending');

        // And no store was attached to the orphan.
        const stores = await testDb.select().from(ecommerceStores)
            .where(eq(ecommerceStores.platform, 'zid'));
        expect(stores).toHaveLength(0);
    });
});
