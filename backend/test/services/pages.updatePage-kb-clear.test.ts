/**
 * pagesService.updatePage — clearing the KB must re-ingest, not skip.
 *
 * The ingestion trigger used to be gated on `kbText.trim()`, so emptying the
 * Business Info bumped kbVersion and then did nothing: the old version stayed
 * active and the AI kept quoting deleted facts (prod, 2026-08-22, 5½ hours).
 *
 * Mutation checks:
 *   - restore the `kbText.trim() &&` gate            → "re-ingests on clear" fails
 *   - drop the `if (kbText.trim())` around facts      → "does not extract facts" fails
 *   - break the non-empty path                         → "still re-ingests on edit" fails
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIngestFullPage = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/kb/ingestion', () => ({
    KbIngestionService: vi.fn(() => ({ ingestFullPage: (...args: unknown[]) => mockIngestFullPage(...args) })),
}));
vi.mock('../../src/services/kb/embedding', () => ({ OpenAIEmbeddingProvider: vi.fn() }));
vi.mock('../../src/services/kb/pgvector-store', () => ({ PgVectorStore: vi.fn() }));

vi.mock('../../src/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/config')>();
    return { config: { ...actual.config, openai: { ...actual.config.openai, apiKey: 'test-key' } } };
});

const PAGE = { id: 'page-1', userId: 'user-1', kbVersion: 7, ecommerceStoreId: null };
const mockReturning = vi.fn().mockResolvedValue([PAGE]);
vi.mock('../../src/db', () => ({
    db: {
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) })) })),
        insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]), orderBy: vi.fn() })) })) })),
        execute: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: { getUserPages: vi.fn(), subscribePageToWebhooks: vi.fn(), setLogger: vi.fn() },
}));
vi.mock('../../src/services/instagram', () => ({ instagramService: { getLinkedInstagramAccount: vi.fn() } }));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: { canEnablePage: vi.fn().mockResolvedValue({ allowed: true, remaining: null }) },
}));
vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: { channelsForPage: vi.fn(() => []), evaluate: vi.fn(), record: vi.fn() },
}));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() },
}));
const mockExtract = vi.fn().mockResolvedValue({});
vi.mock('../../src/services/kb/operationalFactsExtractor', () => ({
    operationalFactsExtractor: { extract: (...args: unknown[]) => mockExtract(...args) },
}));
vi.mock('../../src/services/auditLog', () => ({ logAutoReplyToggle: vi.fn(), auditLog: vi.fn() }));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { pagesService } from '../../src/services/pages';

/** Let the fire-and-forget `.then` chain run. */
const settle = () => new Promise(r => setImmediate(r));

beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockResolvedValue([PAGE]);
});

describe('updatePage — KB cleared', () => {
    it('re-ingests on clear: ingestFullPage runs with the EMPTY text and the bumped version', async () => {
        await pagesService.updatePage('ws-1', PAGE.id, { knowledgeBase: '' });
        await settle();

        expect(mockIngestFullPage).toHaveBeenCalledTimes(1);
        expect(mockIngestFullPage).toHaveBeenCalledWith(PAGE.id, '', [], 7, { resolveGaps: true });
    });

    it('does not extract operational facts from an emptied KB', async () => {
        await pagesService.updatePage('ws-1', PAGE.id, { knowledgeBase: '   ' });
        await settle();

        expect(mockIngestFullPage).toHaveBeenCalledTimes(1);
        expect(mockExtract).not.toHaveBeenCalled();
    });

    it('still re-ingests on an ordinary edit (no regression on the non-empty path)', async () => {
        await pagesService.updatePage('ws-1', PAGE.id, { knowledgeBase: 'نشحن لكل المدن' });
        await settle();

        expect(mockIngestFullPage).toHaveBeenCalledWith(PAGE.id, 'نشحن لكل المدن', [], 7, { resolveGaps: true });
    });

    it('does nothing when the KB is not part of the update', async () => {
        await pagesService.updatePage('ws-1', PAGE.id, { name: 'Renamed' });
        await settle();

        expect(mockIngestFullPage).not.toHaveBeenCalled();
    });
});
