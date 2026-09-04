import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

// Mock dependencies before imports
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        createPage: vi.fn(),
        getPages: vi.fn(),
        getPage: vi.fn(),
        updatePage: vi.fn(),
        updateBrandVoice: vi.fn(),
        deletePage: vi.fn(),
        archivePage: vi.fn(),
        toggleAutoReply: vi.fn(),
        syncFromFacebook: vi.fn(),
    },
    isPageDisconnected: vi.fn((page: any) => !!page && page.accessToken === ''),
    // Mirrors the prod one-liner (services/pages.ts) — serializePage calls it on
    // every response, so a factory missing it turns every controller test 500.
    whatsappNeedsReconnect: vi.fn((page: any) => !!page?.whatsappDisconnectReason),
}));

// Persona save path (D-084): the controller reuses the workspace persona's
// translation machinery — identity-stub it so tests assert routing, not
// translation content (that behavior is pinned by multiLangTranslation.test.ts).
vi.mock('../../src/services/multiLangTranslation', () => ({
    smartTranslateMultiLang: vi.fn(async (update: Record<string, string>) => ({ ...update, sourceLang: 'ar' })),
}));
vi.mock('../../src/services/translation', () => ({
    translateText: vi.fn(async () => ({ translatedText: 'translated' })),
}));
vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getSettings: vi.fn(async () => ({ supportedLanguages: ['ar', 'en'] })),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddPage: vi.fn(),
        canEnablePage: vi.fn(),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        subscribePageToWebhooks: vi.fn(),
        unsubscribePageFromWebhooks: vi.fn(),
    },
}));

vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: {
        evaluate: vi.fn().mockResolvedValue({ blocked: false }),
        record: vi.fn().mockResolvedValue(undefined),
        channelsForPage: vi.fn().mockReturnValue([{ type: 'facebook', id: 'fb-1' }]),
    },
}));

vi.mock('../../src/services/auditLog', () => ({
    auditLog: vi.fn(),
    logAutoReplyToggle: vi.fn(),
}));

// The readiness gate hits the DB (catalog probe) and the store service. This
// suite is about the billing/trial/disconnect gates, so default to "the page is
// grounded" and let the dedicated tests below flip it.
vi.mock('../../src/services/businessReadiness', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/services/businessReadiness')>()),
    businessInfoGate: vi.fn().mockResolvedValue(null),
}));

// Import after mocks
import { pagesController } from '../../src/controllers/pages';
import { pagesService } from '../../src/services/pages';
import { subscriptionsService } from '../../src/services/subscriptions';
import { logAutoReplyToggle, auditLog } from '../../src/services/auditLog';
import { businessInfoGate } from '../../src/services/businessReadiness';

// What businessInfoGate returns for a page with nothing to answer from.
const BUSINESS_INFO_REFUSAL = {
    status: 409,
    body: { error: 'Add your Business Info', code: 'BUSINESS_INFO_REQUIRED' },
} as const;

describe('Pages Controller', () => {
    let mockRequest: Partial<WorkspaceRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        // Re-armed after clearAllMocks: a cleared mock resolves undefined, which
        // the readiness gate reads as "ungrounded" and would 409 every enable.
        vi.mocked(businessInfoGate).mockResolvedValue(null);
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            workspaceId: 'test_workspace_id',
            workspaceOwnerId: 'user-123',
            workspaceRole: 'owner',
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
        };
    });

    // ---- getAll: the list-shape opt-in ----
    //
    // This is a DATA-LOSS guard, not a perf assertion. Mobile bundles already on
    // merchants' phones cannot be redeployed, they read `businessProfile` off
    // this list, and they PUT it back as a full replace — so serving them the
    // trimmed shape would tombstone every merchant-confirmed fact on the next
    // edit. The trim must therefore stay opt-in until those builds are gone.
    describe('getAll — list shape is opt-in', () => {
        // Must clear KB_FILLED_MIN_CHARS (80) for kbFilled to be true — the
        // shared predicate treats anything shorter as not-yet-provided.
        const KB_TEXT =
            'We open every day from nine in the morning until nine at night, and we deliver across the city.';
        const fatRow = {
            id: 'page-1',
            name: 'Test Page',
            facebookPageId: 'fb-page-1',
            accessToken: 'tok',
            knowledgeBase: KB_TEXT,
            suggestedKnowledgeBase: null,
            businessProfile: { merchant: { address: 'Damascus' } },
            archivedAt: null,
        };

        it('serves the FULL row by default — old clients must keep their fields', async () => {
            vi.mocked(pagesService.getPages).mockResolvedValue([fatRow] as any);

            await pagesController.getAll(mockRequest as any, mockReply as FastifyReply);

            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent).toHaveLength(1);
            expect(sent[0].knowledgeBase).toBe(KB_TEXT);
            expect(sent[0].businessProfile).toEqual({ merchant: { address: 'Damascus' } });
            // Credentials are stripped in BOTH shapes.
            expect(sent[0]).not.toHaveProperty('accessToken');
        });

        it('serves the trimmed row only when ?view=list is asked for', async () => {
            vi.mocked(pagesService.getPages).mockResolvedValue([fatRow] as any);
            mockRequest.query = { view: 'list' };

            await pagesController.getAll(mockRequest as any, mockReply as FastifyReply);

            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent[0]).not.toHaveProperty('knowledgeBase');
            expect(sent[0]).not.toHaveProperty('suggestedKnowledgeBase');
            expect(sent[0]).not.toHaveProperty('businessProfile');
            expect(sent[0].kbFilled).toBe(true);
        });

        it('treats any other view value as the safe default', async () => {
            vi.mocked(pagesService.getPages).mockResolvedValue([fatRow] as any);
            mockRequest.query = { view: 'List' };

            await pagesController.getAll(mockRequest as any, mockReply as FastifyReply);

            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent[0].knowledgeBase).toBe(KB_TEXT);
        });
    });

    // ---- create ----
    describe('create', () => {
        it('should create a page successfully', async () => {
            const newPage = { id: 'page-1', name: 'Test Page', facebookPageId: 'fb-page-1', accessToken: 'tok' };
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 1 } as any);
            vi.mocked(pagesService.createPage).mockResolvedValue(newPage as any);
            mockRequest.body = { facebookPageId: 'fb-page-1', name: 'Test Page', accessToken: 'tok' };

            await pagesController.create(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(201);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
        });

        it('should return 403 when subscription limit reached', async () => {
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({
                allowed: false,
                reason: 'Page limit reached',
                limit: 3,
                used: 3,
            } as any);

            await pagesController.create(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAGE_LIMIT_REACHED', error: 'Page limit reached' }));
        });

        it('should return 402 SUBSCRIPTION_INACTIVE (not a page-limit error) when subscription is past due', async () => {
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({
                allowed: false,
                reason: 'Subscription expired. Please renew to continue.',
                code: 'subscription_inactive',
            } as any);

            await pagesController.create(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(402);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
                code: 'SUBSCRIPTION_INACTIVE',
                error: 'Subscription expired. Please renew to continue.',
            }));
        });
    });

    // ---- getAll ----
    describe('getAll', () => {
        it('should return all pages for the user with isConnected flag', async () => {
            const pages = [{ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok' }, { id: 'page-2', facebookPageId: 'fb-2', accessToken: '' }];
            vi.mocked(pagesService.getPages).mockResolvedValue(pages as any);

            await pagesController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(pagesService.getPages).toHaveBeenCalledWith('test_workspace_id');
            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent[0]).toEqual(expect.objectContaining({ id: 'page-1', isConnected: true }));
            expect(sent[1]).toEqual(expect.objectContaining({ id: 'page-2', isConnected: false }));
            // accessToken should be stripped
            expect(sent[0].accessToken).toBeUndefined();
        });

        it('hides archived pages from the merchant list', async () => {
            // The service intentionally still returns archived rows (the Facebook
            // sync depends on seeing them) — this endpoint is the single choke point
            // that hides them from every merchant surface.
            const pages = [
                { id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok', archivedAt: null },
                { id: 'page-archived', facebookPageId: 'fb-2', accessToken: '', archivedAt: new Date('2026-08-09T00:00:00Z') },
            ];
            vi.mocked(pagesService.getPages).mockResolvedValue(pages as any);

            await pagesController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent).toHaveLength(1);
            expect(sent[0].id).toBe('page-1');
        });
    });

    // ---- archive ----
    describe('archive', () => {
        it('archives a disconnected page, strips tokens, and audits it', async () => {
            vi.mocked(pagesService.archivePage).mockResolvedValue({
                status: 'archived',
                page: { id: 'page-1', facebookPageId: 'fb-1', accessToken: '', archivedAt: new Date() },
                already: false,
            } as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.archive(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.archivePage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent.id).toBe('page-1');
            expect(sent.accessToken).toBeUndefined();
            expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
                action: 'page.archived',
                pageId: 'page-1',
                workspaceId: 'test_workspace_id',
            }));
        });

        it('refuses a page that is not disconnected with PAGE_NOT_DISCONNECTED', async () => {
            vi.mocked(pagesService.archivePage).mockResolvedValue({ status: 'not_disconnected' } as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.archive(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAGE_NOT_DISCONNECTED' }));
            expect(auditLog).not.toHaveBeenCalled();
        });

        it('returns 404 when the page is not in the workspace', async () => {
            vi.mocked(pagesService.archivePage).mockResolvedValue({ status: 'not_found' } as any);
            mockRequest.params = { id: 'nope' };

            await pagesController.archive(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(auditLog).not.toHaveBeenCalled();
        });

        it('does not re-audit an already-archived page', async () => {
            vi.mocked(pagesService.archivePage).mockResolvedValue({
                status: 'archived',
                page: { id: 'page-1', facebookPageId: 'fb-1', accessToken: '', archivedAt: new Date() },
                already: true,
            } as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.archive(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.send).toHaveBeenCalled();
            expect(auditLog).not.toHaveBeenCalled();
        });

        it('returns 500 when the service throws', async () => {
            vi.mocked(pagesService.archivePage).mockRejectedValue(new Error('boom'));
            mockRequest.params = { id: 'page-1' };

            await pagesController.archive(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
        });
    });

    // ---- getOne ----
    describe('getOne', () => {
        it('should return a single page with isConnected flag', async () => {
            const page = { id: 'page-1', name: 'My Page', facebookPageId: 'fb-1', accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.getOne(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.getPage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
        });

        it('should return 404 when page not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
            mockRequest.params = { id: 'nonexistent' };

            await pagesController.getOne(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Page not found' });
        });
    });

    // ---- update ----
    describe('update', () => {
        it('should update a page successfully', async () => {
            const updated = { id: 'page-1', name: 'Updated', facebookPageId: 'fb-1', accessToken: 'tok' };
            vi.mocked(pagesService.updatePage).mockResolvedValue(updated as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { name: 'Updated' };

            await pagesController.update(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.updatePage).toHaveBeenCalledWith('test_workspace_id', 'page-1', { name: 'Updated' });
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
        });

        it('canonicalizes loose business hours before persisting', async () => {
            vi.mocked(pagesService.updatePage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok' } as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { businessProfile: { hours: { sat: ['9am-8pm'], sun: ['9-8'], fri: ['مغلق'] } } };

            await pagesController.update(mockRequest as any, mockReply as FastifyReply);

            const passed = vi.mocked(pagesService.updatePage).mock.calls[0][2] as any;
            expect(passed.businessProfile.hours).toEqual({
                sat: ['09:00-20:00'], sun: ['09:00-20:00'], fri: ['closed'],
            });
        });

        it('rejects an unknown day key with 400', async () => {
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { businessProfile: { hours: { funday: ['9-5'] } } };

            await pagesController.update(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Invalid business hours', day: 'funday', code: 'invalid_day_key' }),
            );
            expect(pagesService.updatePage).not.toHaveBeenCalled();
        });
    });

    // ---- delete ----
    describe('delete', () => {
        it('should delete a page and return 204', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-page-1', accessToken: 'tok' } as any);
            vi.mocked(pagesService.deletePage).mockResolvedValue(undefined as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.delete(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.deletePage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(mockReply.status).toHaveBeenCalledWith(204);
        });
    });

    // ---- toggleAutoReply ----
    describe('toggleAutoReply', () => {
        it('should toggle auto-reply successfully', async () => {
            const toggled = { id: 'page-1', autoReplyEnabled: true, facebookPageId: 'fb-1', accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok' } as any);
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 0, remaining: 5 } as any);
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue(toggled as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.toggleAutoReply).toHaveBeenCalledWith('test_workspace_id', 'page-1', true);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
        });

        it('should return 400 when page is disconnected', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', accessToken: '' } as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAGE_DISCONNECTED' }));
        });

        // ⛔ BLAST-RADIUS GUARD for the widened `isPageDisconnected` (#772 C1).
        //
        // A WhatsApp-only card holds a LIVE WhatsApp credential, so the widened
        // predicate correctly reports it CONNECTED — but this endpoint governs the
        // FACEBOOK channel, and that card has no Facebook Page to reply as. Before
        // #772 it answered 400 here (only because `access_token` is '' on pageless
        // rows); it must still answer 400, or the predicate change silently hands a
        // live WhatsApp merchant a Facebook toggle Messenger can never honour.
        //
        // Mutation-checked: drop the `!existingPage.facebookPageId` half of the
        // guard in controllers/pages.ts and this goes green-to-red.
        it('still 400s the FACEBOOK toggle on a WhatsApp-only card (live WABA token, no Facebook Page)', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({
                id: 'wa-only-1', facebookPageId: null, accessToken: '', whatsappAccessToken: 'wa-tok',
            } as any);
            mockRequest.params = { id: 'wa-only-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAGE_DISCONNECTED' }));
            expect(pagesService.toggleAutoReply).not.toHaveBeenCalled();
        });

        it('audits WHO flipped the switch on a real off → on transition', async () => {
            // Page is currently OFF; merchant turns it ON — this is the exact event
            // that was previously unrecoverable (no actor/timestamp anywhere).
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok', autoReplyEnabled: false } as any);
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 0, remaining: 5 } as any);
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue({ id: 'page-1', autoReplyEnabled: true, facebookPageId: 'fb-1', accessToken: 'tok' } as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(logAutoReplyToggle).toHaveBeenCalledWith({
                pageId: 'page-1',
                workspaceId: 'test_workspace_id',
                userId: 'user-123',
                enabled: true,
                previous: false,
                reason: 'user',
            });
        });

        it('does NOT audit an idempotent re-save (already-on → enable)', async () => {
            // Same state in and out: must not emit a phantom toggle event.
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok', autoReplyEnabled: true } as any);
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 0, remaining: 5 } as any);
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue({ id: 'page-1', autoReplyEnabled: true, facebookPageId: 'fb-1', accessToken: 'tok' } as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(logAutoReplyToggle).not.toHaveBeenCalled();
        });

        it('409s BUSINESS_INFO_REQUIRED on enable when the page has nothing to answer from', async () => {
            vi.mocked(businessInfoGate).mockResolvedValue(BUSINESS_INFO_REFUSAL);
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok' } as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(409);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'BUSINESS_INFO_REQUIRED' }));
            expect(pagesService.toggleAutoReply).not.toHaveBeenCalled();
        });

        it('never blocks DISABLING an ungrounded page', async () => {
            // A merchant who emptied their Business Info must still be able to
            // switch the bot off — the gate must never trap them with a live bot.
            vi.mocked(businessInfoGate).mockResolvedValue(BUSINESS_INFO_REFUSAL);
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok', autoReplyEnabled: true } as any);
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue({ id: 'page-1', autoReplyEnabled: false, facebookPageId: 'fb-1', accessToken: 'tok' } as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: false };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.toggleAutoReply).toHaveBeenCalledWith('test_workspace_id', 'page-1', false);
        });
    });

    // ---- sync ----
    describe('sync', () => {
        it('should sync pages from Facebook successfully', async () => {
            const syncedPages = [{ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok' }];
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 1, remaining: 4 } as any);
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue({ syncedPages, skippedCount: 0, takenCount: 0, revokedCount: 0 } as any);
            mockRequest.body = { accessToken: 'fb-token-abc' };

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
                'test_workspace_id',
                'user-123',
                'fb-token-abc',
                'user-123',
                expect.objectContaining({ info: expect.any(Function) }),
            );
            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent.synced).toBe(1);
            expect(sent.pages[0]).toEqual(expect.objectContaining({ id: 'page-1', isConnected: true }));
            expect(sent.pages[0].accessToken).toBeUndefined();
        });

        /**
         * The refusal fields are the whole reason a merchant who granted two pages
         * and got one is told WHY. They are produced by a mapper shared with
         * POST /auth/facebook/link, so pinning them here also pins that the two
         * routes answer with one shape. Nothing asserted them before this suite
         * grew these cases — the mapper could have returned {} and stayed green.
         */
        describe('refusal fields', () => {
            const refusalSync = (overrides: Record<string, unknown>) => {
                vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 1, used: 1, remaining: 0 } as any);
                vi.mocked(pagesService.syncFromFacebook).mockResolvedValue({
                    syncedPages: [{ id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok' }],
                    skippedCount: 0, skippedPages: [], skipReason: 'page_limit', pageLimit: null,
                    takenCount: 0, takenPages: [], trialBlockedCount: 0, trialBlockedPages: [],
                    revokedCount: 0, alreadyMemberOf: [], noPagesDiagnosis: null,
                    ...overrides,
                } as any);
                mockRequest.body = { accessToken: 'fb-token-abc' };
            };

            it('names the pages the plan refused, with the limit that refused them', async () => {
                refusalSync({ skippedCount: 1, skippedPages: [{ pageName: 'Second Page' }], skipReason: 'page_limit', pageLimit: 1 });

                await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

                const sent = (mockReply.send as any).mock.calls[0][0];
                expect(sent).toMatchObject({
                    skippedCount: 1,
                    skippedPages: [{ pageName: 'Second Page' }],
                    skipReason: 'page_limit',
                    pageLimit: 1,
                });
            });

            it('withholds pageLimit on a trial-already-used refusal — "upgrade for more pages" is the wrong answer there', async () => {
                refusalSync({ skippedCount: 1, skippedPages: [{ pageName: 'A' }], skipReason: 'subscription_inactive', pageLimit: 1 });

                await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

                const sent = (mockReply.send as any).mock.calls[0][0];
                expect(sent.skipReason).toBe('subscription_inactive');
                expect(sent.pageLimit).toBeUndefined();
                expect(sent.subscriptionRequired).toBe(true);
            });

            it('names pages held by another workspace, and flags the ones the user can switch to', async () => {
                const alreadyMemberOf = [{ workspaceId: 'ws-2', workspaceName: 'Other Co', role: 'member', pageName: 'Held' }];
                refusalSync({ takenCount: 1, takenPages: [{ pageName: 'Held' }], alreadyMemberOf });

                await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

                const sent = (mockReply.send as any).mock.calls[0][0];
                expect(sent).toMatchObject({ takenCount: 1, takenPages: [{ pageName: 'Held' }], alreadyMemberOf });
            });

            it('reports pages connected but kept off by a used trial', async () => {
                refusalSync({ trialBlockedCount: 1, trialBlockedPages: [{ pageName: 'Blocked' }] });

                await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

                const sent = (mockReply.send as any).mock.calls[0][0];
                expect(sent).toMatchObject({ trialBlockedCount: 1, trialBlockedPages: [{ pageName: 'Blocked' }] });
            });

            it('omits every refusal field when nothing was refused', async () => {
                refusalSync({});

                await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

                const sent = (mockReply.send as any).mock.calls[0][0];
                for (const key of ['skippedCount', 'skippedPages', 'skipReason', 'pageLimit', 'takenCount', 'takenPages', 'trialBlockedCount', 'trialBlockedPages', 'alreadyMemberOf']) {
                    expect(sent).not.toHaveProperty(key);
                }
            });
        });

        it('should return 400 when accessToken is missing', async () => {
            mockRequest.body = {};

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access token is required' }));
        });

        it('surfaces the zero-page diagnosis reason so the client can tailor its empty state', async () => {
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue({
                syncedPages: [], skippedCount: 0, takenCount: 0, trialBlockedCount: 0,
                noPagesDiagnosis: { reason: 'instagram_only', igTargetCount: 1, pageTargetCount: 0, grantedScopes: ['instagram_basic'] },
            } as any);
            mockRequest.body = { accessToken: 'fb-token-abc' };

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent.synced).toBe(0);
            expect(sent.reason).toBe('instagram_only');
        });

        it('returns reason null on a zero sync without a diagnosis (established workspace)', async () => {
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue({
                syncedPages: [], skippedCount: 0, takenCount: 0, trialBlockedCount: 0,
                noPagesDiagnosis: null,
            } as any);
            mockRequest.body = { accessToken: 'fb-token-abc' };

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent.synced).toBe(0);
            expect(sent.reason).toBeNull();
        });
    });

    // ---- updateBrandVoice (PATCH /pages/:id/brand-voice, D-084) ----
    describe('updateBrandVoice', () => {
        const PAGE_ROW = { id: 'page-1', facebookPageId: 'fb-1', accessToken: 'tok', workspaceId: 'test_workspace_id', brandVoiceNotesMulti: null };

        beforeEach(() => {
            mockRequest.params = { id: 'page-1' };
            vi.mocked(pagesService.getPage).mockResolvedValue(PAGE_ROW as any);
            vi.mocked(pagesService.updateBrandVoice).mockResolvedValue({ ...PAGE_ROW, brandVoiceNotesMulti: { ar: 'شخصية' } } as any);
        });

        it('401 without a resolved workspace', async () => {
            mockRequest.workspaceId = undefined as any;
            mockRequest.body = { brandVoiceNotesMulti: null };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(pagesService.updateBrandVoice).not.toHaveBeenCalled();
        });

        it('400 when the key is missing entirely', async () => {
            mockRequest.body = {};

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(pagesService.updateBrandVoice).not.toHaveBeenCalled();
        });

        it('400 on a non-object value and on an array', async () => {
            for (const bad of ['text', 42, ['ar']]) {
                vi.mocked(mockReply.status as any).mockClear();
                mockRequest.body = { brandVoiceNotesMulti: bad };
                await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);
                expect(mockReply.status).toHaveBeenCalledWith(400);
            }
            expect(pagesService.updateBrandVoice).not.toHaveBeenCalled();
        });

        it('400 when a language exceeds MAX_BRAND_VOICE_LENGTH', async () => {
            mockRequest.body = { brandVoiceNotesMulti: { ar: 'ع'.repeat(5000) } };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(pagesService.updateBrandVoice).not.toHaveBeenCalled();
        });

        it('null reverts to inherit — no translation, no page prefetch', async () => {
            vi.mocked(pagesService.updateBrandVoice).mockResolvedValue({ ...PAGE_ROW, brandVoiceNotesMulti: null } as any);
            mockRequest.body = { brandVoiceNotesMulti: null };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.updateBrandVoice).toHaveBeenCalledWith('test_workspace_id', 'page-1', null);
            expect(pagesService.getPage).not.toHaveBeenCalled();
            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent.brandVoiceNotesMulti).toBeNull();
            expect(sent.accessToken).toBeUndefined(); // serializePage strips tokens
        });

        it('a record saves through the shared translation helper and the tenant-scoped service', async () => {
            mockRequest.body = { brandVoiceNotesMulti: { ar: 'أنتِ موظفة استعلامات' } };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            // The identity-stubbed helper adds sourceLang — proving the save went
            // THROUGH smartTranslateMultiLang, not around it.
            expect(pagesService.updateBrandVoice).toHaveBeenCalledWith(
                'test_workspace_id',
                'page-1',
                { ar: 'أنتِ موظفة استعلامات', sourceLang: 'ar' },
            );
        });

        it('404 when the page is not in this workspace (tenant isolation)', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
            mockRequest.body = { brandVoiceNotesMulti: { ar: 'نص' } };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(pagesService.updateBrandVoice).not.toHaveBeenCalled();
        });

        it('404 when the tenant-scoped write matches no row', async () => {
            vi.mocked(pagesService.updateBrandVoice).mockResolvedValue(null as any);
            mockRequest.body = { brandVoiceNotesMulti: null };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
        });

        it('400 on non-language keys — junk keys and __proto__ never reach jsonb', async () => {
            // JSON.parse so __proto__ is an OWN property, as it would arrive
            // from a real request body — an object literal would set the prototype.
            for (const bad of [{ notes: 'نص' }, { zz9x: 'نص' }, JSON.parse('{"__proto__":"نص"}')]) {
                vi.mocked(mockReply.status as any).mockClear();
                mockRequest.body = { brandVoiceNotesMulti: bad };
                await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);
                expect(mockReply.status).toHaveBeenCalledWith(400);
            }
            expect(pagesService.updateBrandVoice).not.toHaveBeenCalled();
        });

        it('accepts regioned language codes (pt-BR)', async () => {
            mockRequest.body = { brandVoiceNotesMulti: { 'pt-BR': 'Persona da página' } };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.updateBrandVoice).toHaveBeenCalled();
        });

        it('400 when sourceLang smuggles an unbounded string past the per-language cap', async () => {
            mockRequest.body = { brandVoiceNotesMulti: { ar: 'نص', sourceLang: 'x'.repeat(64) } };

            await pagesController.updateBrandVoice(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(pagesService.updateBrandVoice).not.toHaveBeenCalled();
        });
    });
});
