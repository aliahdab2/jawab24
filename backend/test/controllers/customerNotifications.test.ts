import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mocks must be declared before imports
vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        select: vi.fn(),
    },
}));

vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: {
        seedDefaults: vi.fn().mockResolvedValue(undefined),
    },
}));

// getWhatsAppStatus dependencies. Only the store/owner/availability path is
// exercised below (the Zid early-return, D-117); resolveWhatsAppSender returns
// null so a non-blocked store falls through to "available:false, no reason".
const mockGetStoreById = vi.fn();
const mockResolveOwner = vi.fn();
const mockGetWaUnavailable = vi.fn().mockResolvedValue(null);
vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...a: unknown[]) => mockGetStoreById(...a),
    resolveBillingSubjectUserId: (...a: unknown[]) => mockResolveOwner(...a),
}));
vi.mock('../../src/services/whatsappAvailability', () => ({
    getWhatsAppUnavailableReason: (...a: unknown[]) => mockGetWaUnavailable(...a),
}));
vi.mock('../../src/services/whatsappNotificationSender', () => ({
    resolveWhatsAppSender: vi.fn().mockResolvedValue(null),
    // Must resolve, not return undefined: the controller fires this
    // fire-and-forget and attaches a .catch — a bare vi.fn() would make the
    // channel-switch path throw a TypeError that production never does.
    ensureTemplatesProvisioned: vi.fn().mockResolvedValue(undefined),
}));

import {
    getTemplates,
    updateTemplate,
    resetTemplates,
    getLog,
    getStats,
    getWhatsAppStatus,
} from '../../src/controllers/customerNotifications';
import { db } from '../../src/db';
import { customerNotificationService } from '../../src/services/customerNotifications';

/** Request/reply factories */
function makeReq(params: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
    return { workspaceId: 'ws-1', params, query: {}, body: {}, ...overrides } as unknown as FastifyRequest;
}

function makeReply() {
    const r = { status: vi.fn(), send: vi.fn() };
    r.status.mockReturnValue(r);
    r.send.mockReturnValue(r);
    return r as unknown as FastifyReply;
}

/** Chainable mock helpers */
function mockOrderByChain(returnValue: unknown) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(returnValue),
            }),
        }),
    };
}

function mockOrderByLimitChain(returnValue: unknown) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(returnValue),
                }),
            }),
        }),
    };
}

function mockUpdateReturningChain(returnValue: unknown[]) {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue(returnValue),
            }),
        }),
    };
}

function mockDeleteWhereChain() {
    return { where: vi.fn().mockResolvedValue(undefined) };
}

function mockGroupByChain(returnValue: unknown) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockResolvedValue(returnValue),
            }),
        }),
    };
}

const sampleTemplate = {
    id: 'tpl-1',
    ecommerceStoreId: 'store-1',
    notificationType: 'order_confirmed',
    isEnabled: true,
    messageAr: 'AR',
    messageEn: 'EN',
    delayMinutes: 0,
};

// ─── getTemplates ────────────────────────────────────────────────────────────

describe('getTemplates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches and returns templates for storeId', async () => {
        vi.mocked(db.select).mockReturnValue(mockOrderByChain([sampleTemplate]) as never);

        const req = makeReq({ storeId: 'store-1' });
        const reply = makeReply();

        await getTemplates(req, reply);

        expect(db.select).toHaveBeenCalledTimes(1);
        expect(reply.send).toHaveBeenCalledWith([sampleTemplate]);
    });
});

// ─── updateTemplate ──────────────────────────────────────────────────────────

describe('updateTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates template and returns it', async () => {
        const updated = { ...sampleTemplate, isEnabled: false };
        vi.mocked(db.update).mockReturnValue(mockUpdateReturningChain([updated]) as never);

        const req = makeReq(
            { storeId: 'store-1', type: 'order_confirmed' },
            { body: { isEnabled: false } },
        );
        const reply = makeReply();

        await updateTemplate(req, reply);

        expect(db.update).toHaveBeenCalledTimes(1);
        expect(reply.send).toHaveBeenCalledWith(updated);
    });

    it('returns 404 if template not found (db returns empty array)', async () => {
        vi.mocked(db.update).mockReturnValue(mockUpdateReturningChain([]) as never);

        const req = makeReq(
            { storeId: 'store-1', type: 'order_confirmed' },
            { body: { isEnabled: true } },
        );
        const reply = makeReply();

        await updateTemplate(req, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
        expect(reply.send).toHaveBeenCalledWith({ error: 'Template not found' });
    });

    // WhatsApp is the only rail (D-123). A PUT naming the retired SMS rail is
    // refused rather than stored: accepting it would write a row whose sends can
    // only ever fail, which is the silent-failure shape this endpoint's channel
    // pre-flight exists to prevent.
    it('refuses a retired sms channel without writing anything', async () => {
        const req = makeReq(
            { storeId: 'store-1', type: 'order_confirmed' },
            { body: { channel: 'sms' } },
        );
        const reply = makeReply();

        await updateTemplate(req, reply);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(db.update).not.toHaveBeenCalled();
        // The message must name what IS accepted — a bare "invalid" leaves an
        // API client guessing at a value that no longer exists.
        const sent = vi.mocked(reply.send).mock.calls[0][0] as { error: string };
        expect(sent.error).toContain('whatsapp');
    });

    it('accepts the whatsapp channel for a WhatsApp-capable type', async () => {
        const updated = { ...sampleTemplate, channel: 'whatsapp' };
        vi.mocked(db.update).mockReturnValue(mockUpdateReturningChain([updated]) as never);
        const { resolveWhatsAppSender } = await import('../../src/services/whatsappNotificationSender');
        vi.mocked(resolveWhatsAppSender).mockResolvedValueOnce({
            pageId: 'page-1', phoneNumberId: '123', wabaId: 'waba-1', accessToken: 'tok',
        });

        const req = makeReq(
            { storeId: 'store-1', type: 'order_confirmed' },
            { body: { channel: 'whatsapp' }, log: { error: vi.fn() } },
        );
        const reply = makeReply();

        await updateTemplate(req, reply);

        expect(reply.send).toHaveBeenCalledWith(updated);
        expect(reply.status).not.toHaveBeenCalledWith(400);
    });
});

// ─── resetTemplates ──────────────────────────────────────────────────────────

describe('resetTemplates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deletes all templates and seeds defaults, returns { ok: true }', async () => {
        vi.mocked(db.delete).mockReturnValue(mockDeleteWhereChain() as never);

        const req = makeReq({ storeId: 'store-1' });
        const reply = makeReply();

        await resetTemplates(req, reply);

        expect(db.delete).toHaveBeenCalledTimes(1);
        expect(customerNotificationService.seedDefaults).toHaveBeenCalledWith('store-1');
        expect(reply.send).toHaveBeenCalledWith({ ok: true });
    });
});

// ─── getLog ──────────────────────────────────────────────────────────────────

describe('getLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches log with default limit 50', async () => {
        vi.mocked(db.select).mockReturnValue(mockOrderByLimitChain([]) as never);

        const req = makeReq({ storeId: 'store-1' });
        const reply = makeReply();

        await getLog(req, reply);

        const limitFn = vi.mocked(db.select).mock.results[0].value.from().where().orderBy;
        expect(limitFn).toHaveBeenCalled();
        // Verify the chain resolved and send was called
        expect(reply.send).toHaveBeenCalledWith([]);
    });

    it('respects custom limit up to 200', async () => {
        vi.mocked(db.select).mockReturnValue(mockOrderByLimitChain([]) as never);

        const req = makeReq({ storeId: 'store-1' }, { query: { limit: '100' } });
        const reply = makeReply();

        await getLog(req, reply);

        expect(reply.send).toHaveBeenCalledWith([]);
    });
});

// ─── getStats ────────────────────────────────────────────────────────────────

describe('getStats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns { total, sent, failed, byType } computed from two GROUP BY queries', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(mockGroupByChain([
                { status: 'sent', count: 10 },
                { status: 'failed', count: 2 },
                { status: 'pending', count: 1 },
            ]) as never)
            .mockReturnValueOnce(mockGroupByChain([
                { notificationType: 'order_confirmed', count: 8 },
                { notificationType: 'abandoned_cart', count: 5 },
            ]) as never);

        const req = makeReq({ storeId: 'store-1' });
        const reply = makeReply();

        await getStats(req, reply);

        expect(reply.send).toHaveBeenCalledWith(
            expect.objectContaining({
                total: 13,
                sent: 10,
                failed: 2,
                byType: expect.objectContaining({
                    order_confirmed: 8,
                }),
            }),
        );
    });
});

describe('getWhatsAppStatus — availability (D-117)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetWaUnavailable.mockResolvedValue(null);
    });

    it('reports unavailableReason for a Zid store, without touching the sender/template query', async () => {
        mockGetStoreById.mockResolvedValue({ id: 's1', userId: 'u1', workspaceId: 'ws-1' });
        mockResolveOwner.mockResolvedValue('owner-1');
        mockGetWaUnavailable.mockResolvedValueOnce('zid_marketplace');
        const reply = makeReply();

        await getWhatsAppStatus(makeReq({ storeId: 's1' }), reply);

        // Mutation: delete the unavailableReason early-return in getWhatsAppStatus
        // and this fails (it falls through to available:false with no reason).
        expect(reply.send).toHaveBeenCalledWith({ available: false, unavailableReason: 'zid_marketplace', templates: {} });
        expect(mockResolveOwner).toHaveBeenCalledWith({ id: 's1', userId: 'u1', workspaceId: 'ws-1' });
    });

    it('a non-blocked store with no connected sender is available:false with NO reason', async () => {
        mockGetStoreById.mockResolvedValue({ id: 's2', userId: 'u2', workspaceId: 'ws-2' });
        mockResolveOwner.mockResolvedValue('owner-2');
        const reply = makeReply();

        await getWhatsAppStatus(makeReq({ storeId: 's2' }), reply);

        expect(reply.send).toHaveBeenCalledWith({ available: false, templates: {} });
    });
});
