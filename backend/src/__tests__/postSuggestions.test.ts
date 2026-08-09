/**
 * «بوست اليوم» service — the spend-safety contract.
 *
 * The pilot's promise to the owner is an ABSOLUTE 3-generations/day cap and a
 * default-OFF gate. These tests pin the order of the guards (gate → cap check →
 * increment → paid calls) so no refactor can ever put an OpenAI call before the
 * cap, plus the degrade-to-text-only path and the deterministic type picker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockChatCreate, mockImagesGenerate, mockCheckDailyCap, mockIncrementDailyCap,
    mockIsConfigured, mockPut, mockRemove, dbResults, mockConfig,
} = vi.hoisted(() => {
    const dbResults: unknown[] = [];
    return {
        mockChatCreate: vi.fn(),
        mockImagesGenerate: vi.fn(),
        mockCheckDailyCap: vi.fn(),
        mockIncrementDailyCap: vi.fn(),
        mockIsConfigured: vi.fn(),
        mockPut: vi.fn(),
        mockRemove: vi.fn(),
        dbResults,
        mockConfig: {
            openai: { apiKey: 'test-key' },
            postSuggestions: { enabled: true, pageIds: [] as string[], dailyCapPerPage: 3 },
        },
    };
});

/**
 * Chainable thenable standing in for drizzle's query builders: every method
 * returns itself, `await` resolves the next queued result. Tests queue exactly
 * the rows the code path under test will read, in order.
 */
function chainable(): Record<string, unknown> {
    const self: Record<string, unknown> = {};
    const handler = () => self;
    for (const m of ['select', 'from', 'where', 'limit', 'orderBy', 'innerJoin', 'insert', 'values', 'onConflictDoNothing', 'returning', 'update', 'set']) {
        self[m] = vi.fn(handler);
    }
    self.then = (resolve: (v: unknown) => void) => {
        resolve(dbResults.length > 0 ? dbResults.shift() : []);
    };
    return self;
}

vi.mock('../db', () => ({
    db: new Proxy({}, { get: (_t, prop: string) => (chainable() as Record<string, unknown>)[prop] }),
}));
vi.mock('../config', () => ({ config: mockConfig }));
vi.mock('../services/openaiClient', () => ({
    makeTrackedOpenAI: vi.fn(() => ({
        chat: { completions: { create: mockChatCreate } },
        images: { generate: mockImagesGenerate },
    })),
}));
vi.mock('../lib/dailyCap', () => ({
    dailyCapKey: (prefix: string, id: string) => `${prefix}:${id}:today`,
    checkDailyCap: mockCheckDailyCap,
    incrementDailyCap: mockIncrementDailyCap,
}));
vi.mock('../services/imageStorage', () => ({
    imageStorage: { isConfigured: mockIsConfigured, put: mockPut, remove: mockRemove },
}));
vi.mock('../services/settings', () => ({
    settingsService: { getSettings: vi.fn().mockResolvedValue({ brandVoiceNotes: 'ودّي وقريب' }) },
}));
vi.mock('../services/ecommerce', () => ({ getStoreContextForAI: vi.fn() }));
vi.mock('../services/catalog', () => ({
    catalogService: { buildCatalogPromptBlock: vi.fn().mockResolvedValue('<catalog>عطر 50 د.ل</catalog>') },
}));
vi.mock('../services/factCollections', () => ({
    factCollectionsService: { buildFactCollectionsContext: vi.fn().mockResolvedValue({ block: undefined, gated: false }) },
}));
vi.mock('../lib/aiMetrics', () => ({
    recordAiAttempt: vi.fn(),
    recordAiReturn: vi.fn(),
    recordAiFailedBeforeLog: vi.fn(),
}));
vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { makeTrackedOpenAI } from '../services/openaiClient';
import {
    postSuggestionsService,
    isPostSuggestionsEnabledForPage,
    isCronEligiblePage,
    pickPostType,
    buildContactSuffix,
} from '../services/postSuggestions';

const PAGE = 'aaaaaaaa-0000-0000-0000-000000000001';
const WS = 'bbbbbbbb-0000-0000-0000-000000000001';
const PAGE_ROW = { id: PAGE, name: 'متجري', userId: 'u1', workspaceId: WS, knowledgeBase: 'نبيع عطور', businessProfile: null, ecommerceStoreId: null };
const CHAT_OK = {
    choices: [{ message: { content: JSON.stringify({ text: 'بوست تجريبي 🌟', imageBrief: 'perfume bottle on marble' }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    model: 'gpt-4.1-mini',
};

beforeEach(() => {
    vi.clearAllMocks();
    dbResults.length = 0;
    mockConfig.postSuggestions.enabled = true;
    mockConfig.postSuggestions.pageIds = [];
    mockConfig.postSuggestions.dailyCapPerPage = 3;
    mockCheckDailyCap.mockResolvedValue({ allowed: true, used: 0, limit: 3 });
    mockIsConfigured.mockReturnValue(true);
    mockPut.mockResolvedValue({ url: 'https://media/x.png', key: 'generated-posts/ws/x.png' });
    mockChatCreate.mockResolvedValue(CHAT_OK);
    mockImagesGenerate.mockResolvedValue({ data: [{ b64_json: 'aGVsbG8=' }], usage: { input_tokens: 90, output_tokens: 1000 } });
});

describe('gate functions', () => {
    it('endpoint gate: disabled kills everything; empty allowlist = fleet-wide; non-empty = only listed', () => {
        mockConfig.postSuggestions.enabled = false;
        expect(isPostSuggestionsEnabledForPage(PAGE)).toBe(false);

        mockConfig.postSuggestions.enabled = true;
        mockConfig.postSuggestions.pageIds = [];
        expect(isPostSuggestionsEnabledForPage(PAGE)).toBe(true);

        mockConfig.postSuggestions.pageIds = ['other-page'];
        expect(isPostSuggestionsEnabledForPage(PAGE)).toBe(false);
        mockConfig.postSuggestions.pageIds = [PAGE];
        expect(isPostSuggestionsEnabledForPage(PAGE)).toBe(true);
    });

    it('cron gate is STRICTER: an empty allowlist means the cron generates for nobody', () => {
        mockConfig.postSuggestions.pageIds = [];
        expect(isCronEligiblePage(PAGE)).toBe(false); // endpoint would say true here

        mockConfig.postSuggestions.pageIds = [PAGE];
        expect(isCronEligiblePage(PAGE)).toBe(true);
        mockConfig.postSuggestions.enabled = false;
        expect(isCronEligiblePage(PAGE)).toBe(false);
    });
});

describe('pickPostType — deterministic, varies day to day', () => {
    const all = { hasLiveDatedRow: true, hasCatalog: true, hasHours: true, knowledgeBase: 'kb' };

    it('prefers promo when a live dated row exists', () => {
        expect(pickPostType(all, null)).toBe('promo');
    });

    it('excludes yesterday\'s type when there is a choice', () => {
        expect(pickPostType(all, 'promo')).toBe('product_spotlight');
    });

    it('reuses the only candidate rather than inventing one', () => {
        const onlyHours = { hasLiveDatedRow: false, hasCatalog: false, hasHours: true, knowledgeBase: undefined };
        expect(pickPostType(onlyHours, 'hours_reminder')).toBe('hours_reminder');
    });

    it('falls back to general on an empty page', () => {
        expect(pickPostType({ hasLiveDatedRow: false, hasCatalog: false, hasHours: false, knowledgeBase: undefined }, null)).toBe('general');
    });
});

describe('buildContactSuffix — code-composed, never model-written (a mangled digit = a lost sale)', () => {
    it('composes address + phone + distinct whatsapp in order', () => {
        expect(buildContactSuffix({
            address: 'شارع الجمهورية', city: 'طرابلس',
            phones: ['0912345678'], channels: { whatsapp: '0919999999' },
        })).toBe('📍 شارع الجمهورية، طرابلس\n📞 0912345678\n💬 واتساب: 0919999999');
    });

    it('collapses whatsapp when it equals the phone, and skips absent fields', () => {
        expect(buildContactSuffix({ phones: ['0912345678'], channels: { whatsapp: '0912345678' } }))
            .toBe('📞 0912345678');
    });

    it('empty or missing profile → no footer at all', () => {
        expect(buildContactSuffix(null)).toBeUndefined();
        expect(buildContactSuffix({})).toBeUndefined();
    });
});

describe('generateSuggestion — spend guards run before any paid call', () => {
    it('gated page: refuses before touching the cap or OpenAI', async () => {
        mockConfig.postSuggestions.enabled = false;
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'gated' });
        expect(mockCheckDailyCap).not.toHaveBeenCalled();
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('cap exhausted: refuses without incrementing or calling OpenAI', async () => {
        mockCheckDailyCap.mockResolvedValue({ allowed: false, used: 3, limit: 3 });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toMatchObject({ ok: false, reason: 'daily_cap' });
        expect(mockIncrementDailyCap).not.toHaveBeenCalled();
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('Redis down: FAILS CLOSED (cap is the only bound on real spend)', async () => {
        mockCheckDailyCap.mockRejectedValue(new Error('redis down'));
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'cap_check_unavailable' });
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('increments the cap BEFORE the paid calls so a failing call still burns its slot', async () => {
        mockChatCreate.mockRejectedValue(new Error('api down'));
        dbResults.push([PAGE_ROW], [], [], []); // page, catalog dated, collections, previous-type
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'generation_failed' });
        expect(mockIncrementDailyCap).toHaveBeenCalledTimes(1);
    });
});

describe('generateSuggestion — happy path and degrades', () => {
    /** Queue the db reads for a full run: page, dated-catalog probe, collections probe, previous-type, stale rows, (supersede UPDATE when stale), insert-returning. */
    function queueFullRun(insertedRow: Record<string, unknown>, stale: Record<string, unknown>[] = []) {
        dbResults.push([PAGE_ROW], [], [], [], stale);
        if (stale.length > 0) dbResults.push([]); // the supersede UPDATE await comes before the INSERT
        dbResults.push([insertedRow]);
    }
    const INSERTED = {
        id: 's1', pageId: PAGE, suggestedFor: '2026-08-09', source: 'manual', postType: 'product_spotlight',
        text: 'بوست تجريبي 🌟', imageUrl: 'https://media/x.png', imageKey: 'generated-posts/ws/x.png',
        status: 'ready', openedAt: null, copiedAt: null, downloadedAt: null, createdAt: new Date(),
    };

    it('returns text + stored image and decrements remaining', async () => {
        queueFullRun(INSERTED);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.suggestion.text).toBe('بوست تجريبي 🌟');
        expect(r.suggestion.imageUrl).toBe('https://media/x.png');
        expect(r.imageDegraded).toBeUndefined();
        expect(r.remainingToday).toBe(2);
        expect(mockPut).toHaveBeenCalledWith(expect.stringMatching(/^generated-posts\//), expect.any(Buffer), 'image/png');
    });

    it('image API failure degrades to TEXT-ONLY instead of failing the suggestion', async () => {
        mockImagesGenerate.mockRejectedValue(new Error('image api down'));
        queueFullRun({ ...INSERTED, imageUrl: null, imageKey: null });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.suggestion.imageUrl).toBeNull();
        expect(r.imageDegraded).toBe('image_failed');
    });

    it('unconfigured storage degrades to text-only WITHOUT calling the image API', async () => {
        mockIsConfigured.mockReturnValue(false);
        queueFullRun({ ...INSERTED, imageUrl: null, imageKey: null });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.imageDegraded).toBe('storage_off');
        expect(mockImagesGenerate).not.toHaveBeenCalled();
    });

    it('supersedes today\'s previous ready row and best-effort deletes its image', async () => {
        queueFullRun(INSERTED, [{ id: 'old1', imageKey: 'generated-posts/ws/old.png' }]);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        expect(mockRemove).toHaveBeenCalledWith('generated-posts/ws/old.png');
    });
});
