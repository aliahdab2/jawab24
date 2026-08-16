import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `pagesService.connectInstagramDirect` — the four tenancy branches, against the
 * service's real query flow (review M4: the connect-controller tests mock this
 * function wholesale, so the branches that decide tenancy were asserted nowhere).
 *
 * Ordering is load-bearing and mutation-checked: a cross-workspace claim on a
 * page-linked row must answer `taken`, NOT `alreadyLinked` — the reverse order
 * would leak "already connected through its Facebook Page" to a foreign
 * tenant's probe.
 */
vi.mock('../../src/db', () => ({
    db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
}));
vi.mock('../../src/lib/redis', () => ({ redis: {} }));
vi.mock('../../src/services/kb/operationalFactsExtractor', () => ({ operationalFactsExtractor: {} }));
vi.mock('../../src/services/ecommerce', () => ({ storeAnswersPolicies: vi.fn() }));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/instagram', () => ({ instagramService: {} }));
vi.mock('../../src/services/imageStorage', () => ({ imageStorage: {} }));
vi.mock('../../src/services/subscriptions', () => ({ subscriptionsService: {} }));
vi.mock('../../src/services/channelTrial', () => ({ channelTrialService: {} }));
vi.mock('../../src/services/auditLog', () => ({ logAutoReplyToggle: vi.fn(), auditLog: vi.fn() }));
vi.mock('../../src/services/statsCache', () => ({
    STATS_CACHE_TTL: 60, pagesStatsCacheKey: vi.fn(), invalidateWorkspaceStatsCache: vi.fn(),
}));
vi.mock('../../src/services/pageTokenRecovery', () => ({ clearReconnectAlertClaims: vi.fn() }));
vi.mock('../../src/services/kb/ingestion', () => ({ KbIngestionService: class {} }));
vi.mock('../../src/services/kb/embedding', () => ({ OpenAIEmbeddingProvider: class {} }));
vi.mock('../../src/services/kb/pgvector-store', () => ({ PgVectorStore: class {} }));

import { pagesService } from '../../src/services/pages';
import { db } from '../../src/db';

const PROFILE = { userId: 'ig-777', username: 'shop', name: 'المتجر', profilePictureUrl: 'https://cdn/p.jpg' };
const TOKEN = { accessToken: 'long-lived-tok', expiresAt: new Date('2026-10-15T00:00:00Z') };

function mockSelect(rows: unknown[]) {
    vi.mocked(db.select).mockReturnValue({
        from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    } as never);
}

describe('pagesService.connectInstagramDirect — tenancy branches', () => {
    beforeEach(() => vi.clearAllMocks());

    it('(a) account owned by a FOREIGN workspace ⇒ taken — even when that row is page-linked', async () => {
        // A page-linked row too: the cross-workspace check must win over
        // alreadyLinked, or a foreign tenant's probe learns the link exists.
        mockSelect([{ id: 'p1', workspaceId: 'ws-OTHER', facebookPageId: 'fb-1' }]);

        const result = await pagesService.connectInstagramDirect('ws-MINE', 'u1', PROFILE, TOKEN);

        expect(result).toEqual({ taken: true });
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('(b) same workspace, reachable via its Facebook Page ⇒ alreadyLinked, row untouched', async () => {
        mockSelect([{ id: 'p1', workspaceId: 'ws-MINE', facebookPageId: 'fb-1' }]);

        const result = await pagesService.connectInstagramDirect('ws-MINE', 'u1', PROFILE, TOKEN);

        expect(result.taken).toBe(false);
        expect(result.alreadyLinked).toBe(true);
        // "Untouched" is the point: writing the token onto a page-linked row
        // creates the hybrid the send path refuses to use.
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('(c) same workspace, Instagram-direct row ⇒ reconnect updates credential/profile, NOT the toggles', async () => {
        mockSelect([{ id: 'p1', workspaceId: 'ws-MINE', facebookPageId: null }]);
        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'p1' }]) }),
        });
        vi.mocked(db.update).mockReturnValue({ set: setSpy } as never);

        const result = await pagesService.connectInstagramDirect('ws-MINE', 'u1', PROFILE, TOKEN);

        expect(result).toEqual({ taken: false, page: { id: 'p1' } });
        const setArg = setSpy.mock.calls[0][0];
        expect(setArg.instagramAccessToken).toBe('long-lived-tok'); // no key in test env → stored as-is
        expect(setArg.instagramTokenExpiresAt).toBe(TOKEN.expiresAt);
        expect(setArg.instagramUsername).toBe('shop');
        // The merchant's own switches survive a reconnect — a reconnect that
        // silently re-enabled (or disabled) replies would be a settings write
        // nobody asked for.
        expect(setArg).not.toHaveProperty('autoReplyEnabled');
        expect(setArg).not.toHaveProperty('instagramAutoReplyEnabled');
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('(d) no row ⇒ creates the Instagram-only shape: no FB page, empty FB token, both toggles off', async () => {
        mockSelect([]);
        const valuesSpy = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-1' }]) });
        vi.mocked(db.insert).mockReturnValue({ values: valuesSpy } as never);

        const result = await pagesService.connectInstagramDirect('ws-MINE', 'u1', PROFILE, TOKEN);

        expect(result).toEqual({ taken: false, page: { id: 'new-1' } });
        const values = valuesSpy.mock.calls[0][0];
        expect(values).toMatchObject({
            workspaceId: 'ws-MINE',
            userId: 'u1',
            facebookPageId: null,
            accessToken: '',
            autoReplyEnabled: false,
            instagramAccountId: 'ig-777',
            instagramAutoReplyEnabled: false,
            instagramAccessToken: 'long-lived-tok',
        });
    });

    it('(d-race) unique violation on the INSERT ⇒ taken — the race loser gets the sequential answer', async () => {
        mockSelect([]);
        const uniqueErr = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        vi.mocked(db.insert).mockReturnValue({
            values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(uniqueErr) }),
        } as never);

        await expect(pagesService.connectInstagramDirect('ws-MINE', 'u1', PROFILE, TOKEN))
            .resolves.toEqual({ taken: true });
    });
});
