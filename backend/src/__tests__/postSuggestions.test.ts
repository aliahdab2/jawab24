/**
 * «بوست اليوم» service — the spend-safety contract.
 *
 * The pilot's promise to the owner is an ABSOLUTE 3-generations/day cap and a
 * default-OFF gate. These tests pin the order of the guards (gate → ownership
 * → cap check → atomic claim → paid calls) so no refactor can ever put an
 * OpenAI call before the cap or a cap write before ownership, plus the
 * DB-grounded cap floor, the transactional supersede (old row dies only when
 * the new one exists; old image removed only after commit), the degrade-to-
 * text-only path, the deterministic type picker, and the cron's skip/waste
 * guards.
 *
 * DB mocking is SHAPE-KEYED via the shared drizzle router (test/helpers/
 * drizzleQueryMock.ts): each test declares which query gets which rows by
 * operation + table + selected fields — never by position, so adding a query
 * to the service can't silently feed rows to the wrong read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Column } from 'drizzle-orm';

const {
    mockChatCreate, mockImagesGenerate, mockCheckDailyCap, mockClaimDailyCapSlot,
    mockIsConfigured, mockPut, mockRemove, mockComposePostCard, mockFetchRoundedLogo, mockConfig,
} = vi.hoisted(() => ({
    mockChatCreate: vi.fn(),
    mockImagesGenerate: vi.fn(),
    mockCheckDailyCap: vi.fn(),
    mockClaimDailyCapSlot: vi.fn(),
    mockIsConfigured: vi.fn(),
    mockPut: vi.fn(),
    mockRemove: vi.fn(),
    mockComposePostCard: vi.fn(),
    mockFetchRoundedLogo: vi.fn(),
    mockConfig: {
        openai: { apiKey: 'test-key' },
        postSuggestions: { enabled: true, workspaceIds: [] as string[], dailyCapPerPage: 3 },
    },
}));

// The router is re-created per test; the '../db' factory reads it lazily at
// query time, so the module-level `let` is safe (same deferred pattern the
// previous positional harness used).
let router: DbRouter;

vi.mock('../db', () => ({
    db: new Proxy({}, { get: (_t, prop: string) => router.db[prop] }),
}));
vi.mock('../config', () => ({ config: mockConfig }));
vi.mock('../services/openaiClient', () => ({
    makeTrackedOpenAI: vi.fn(() => ({
        chat: { completions: { create: mockChatCreate } },
        images: { generate: mockImagesGenerate },
    })),
}));
vi.mock('../lib/dailyCap', () => ({
    dailyCapKey: (prefix: string, id: string, date?: string) => `${prefix}:${id}:${date ?? 'today'}`,
    checkDailyCap: mockCheckDailyCap,
    claimDailyCapSlot: mockClaimDailyCapSlot,
}));
vi.mock('../services/imageStorage', () => ({
    imageStorage: { isConfigured: mockIsConfigured, put: mockPut, remove: mockRemove },
}));
// The compositor has its own suite (imageCompose.test.ts) — here it is mocked
// so the service tests pin the CONTRACT: pre-fetched logo passed in, null =
// undecodable base ⇒ text-only degrade.
vi.mock('../services/imageCompose', () => ({
    composePostCard: mockComposePostCard,
    fetchRoundedLogo: mockFetchRoundedLogo,
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

import { makeDbRouter, type DbRouter } from './helpers/drizzleQueryMock';
import { pages, postSuggestions, catalogItems, factCollections } from '../db/schema';
import { makeTrackedOpenAI } from '../services/openaiClient';
import { getStoreContextForAI } from '../services/ecommerce';
import { captureError } from '../utils/sentryHelpers';
import {
    postSuggestionsService,
    isPostSuggestionsEnabledForWorkspace,
    setPostSuggestionsLogger,
    pickPostType,
    buildContactSuffix,
    buildRecentBriefsBlock,
    findUngroundedNumbers,
} from '../services/postSuggestions';

const PAGE = 'aaaaaaaa-0000-0000-0000-000000000001';
const WS = 'bbbbbbbb-0000-0000-0000-000000000001';
const PAGE_ROW = {
    id: PAGE, name: 'متجري', userId: 'u1', workspaceId: WS, knowledgeBase: 'نبيع عطور',
    businessProfile: null, ecommerceStoreId: null, instagramProfilePicUrl: null, facebookPageId: null,
};
const CHAT_OK = {
    choices: [{ message: { content: JSON.stringify({ text: 'بوست تجريبي 🌟', imageBrief: 'perfume bottle on marble' }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    model: 'gpt-4.1-mini',
};
const INSERTED = {
    id: 's1', pageId: PAGE, suggestedFor: '2026-08-09', source: 'manual', postType: 'product_spotlight',
    text: 'بوست تجريبي 🌟', imageUrl: 'https://media/x.png', imageKey: 'generated-posts/ws/x.png',
    status: 'ready', openedAt: null, copiedAt: null, downloadedAt: null, createdAt: new Date(),
};

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/**
 * Depth-safe scan for a drizzle Column identity inside a captured where
 * clause. The router applies no SQL, so this is the only way a unit test can
 * pin WHICH columns a query filters by (e.g. "the previous-type lookup is no
 * longer day-scoped"). Column nodes are never expanded — a Column carries its
 * whole table (and thereby every sibling column), which would false-positive.
 */
function referencesColumn(root: unknown, column: Column): boolean {
    const seen = new WeakSet<object>();
    const stack: unknown[] = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node === column) return true;
        if (node === null || node === undefined || typeof node !== 'object') continue;
        if (seen.has(node) || node instanceof Column) continue;
        seen.add(node);
        stack.push(...(Array.isArray(node) ? node : Object.values(node)));
    }
    return false;
}

// --- shape-keyed queue helpers (fields = a distinguishing subset of the select's keys) ---
const queueOwnedPage = (rows: unknown[]) =>
    router.queue({ op: 'select', table: pages, fields: ['knowledgeBase'], rows });
const queueCapCount = (n: number) =>
    router.queue({ op: 'select', table: postSuggestions, fields: ['value'], rows: [{ value: n }] });
const queueDatedCatalog = (rows: unknown[] = []) =>
    router.queue({ op: 'select', table: catalogItems, fields: ['startsAt'], rows });
const queueCollections = (rows: unknown[] = []) =>
    router.queue({ op: 'select', table: factCollections, fields: ['id'], rows });
const queuePrevious = (rows: unknown[] = []) =>
    router.queue({ op: 'select', table: postSuggestions, fields: ['postType'], rows });
const queueInsert = (rows: unknown[]) =>
    router.queue({ op: 'insert', table: postSuggestions, rows });
const queueStale = (rows: unknown[] = []) =>
    router.queue({ op: 'select', table: postSuggestions, fields: ['imageKey'], rows });

/** Queue the whole generateSuggestion read set. `insertedRow: null` = the insert is suppressed (cron race). */
function queueFullRun(
    insertedRow: Record<string, unknown> | null,
    opts: { stale?: Record<string, unknown>[]; previous?: Record<string, unknown>[]; datedCatalog?: Record<string, unknown>[]; dbUsed?: number; pageRow?: Record<string, unknown> } = {},
) {
    queueOwnedPage([opts.pageRow ?? PAGE_ROW]);
    queueCapCount(opts.dbUsed ?? 0);
    const dated = opts.datedCatalog ?? [];
    queueDatedCatalog(dated);
    if (dated.length === 0) queueCollections([]); // only probed when no live dated catalog row
    queuePrevious(opts.previous ?? []);
    queueInsert(insertedRow ? [insertedRow] : []);
    if (insertedRow) {
        queueStale(opts.stale ?? []); // stale probe runs only once a new row exists
        // Post-generation availability (one envelope across routes): catalog
        // id-probe + the same dated-row liveness reads getToday performs. An
        // ecommerce page skips the id-probe — its store id advertises without
        // touching catalog_items (the cheap half of the availability boundary).
        if (!(opts.pageRow ?? PAGE_ROW).ecommerceStoreId) {
            router.queue({ op: 'select', table: catalogItems, fields: ['id'], rows: [] });
        }
        queueDatedCatalog(dated);
        if (dated.length === 0) queueCollections([]);
    }
}

/** Queue a getToday read set (used directly and by the suppressed-insert fallback). */
function queueGetToday(suggestionRows: unknown[]) {
    queueOwnedPage([PAGE_ROW]);
    router.queue({ op: 'select', table: postSuggestions, rows: suggestionRows }); // full-row select
    router.queue({ op: 'select', table: catalogItems, fields: ['id'], rows: [] }); // availability probe
    queueDatedCatalog([]);
    queueCollections([]);
}

beforeEach(() => {
    vi.clearAllMocks();
    router = makeDbRouter();
    setPostSuggestionsLogger(log);
    mockConfig.postSuggestions.enabled = true;
    mockConfig.postSuggestions.workspaceIds = [];
    mockConfig.postSuggestions.dailyCapPerPage = 3;
    mockCheckDailyCap.mockResolvedValue({ allowed: true, used: 0, limit: 3 });
    mockClaimDailyCapSlot.mockResolvedValue(true);
    mockIsConfigured.mockReturnValue(true);
    mockPut.mockResolvedValue({ url: 'https://media/x.png', key: 'generated-posts/ws/x.png' });
    mockChatCreate.mockResolvedValue(CHAT_OK);
    mockImagesGenerate.mockResolvedValue({ data: [{ b64_json: 'aGVsbG8=' }], usage: { input_tokens: 90, output_tokens: 1000 } });
    mockComposePostCard.mockImplementation(async (base: Buffer) => base);
    mockFetchRoundedLogo.mockResolvedValue(null);
});

describe('gate functions', () => {
    it('workspace gate: disabled kills everything; empty allowlist = fleet-wide; non-empty = only listed', () => {
        mockConfig.postSuggestions.enabled = false;
        expect(isPostSuggestionsEnabledForWorkspace(WS)).toBe(false);

        mockConfig.postSuggestions.enabled = true;
        mockConfig.postSuggestions.workspaceIds = [];
        expect(isPostSuggestionsEnabledForWorkspace(WS)).toBe(true);

        mockConfig.postSuggestions.workspaceIds = ['other-workspace'];
        expect(isPostSuggestionsEnabledForWorkspace(WS)).toBe(false);
        mockConfig.postSuggestions.workspaceIds = [WS];
        expect(isPostSuggestionsEnabledForWorkspace(WS)).toBe(true);
    });

    it('generateSuggestion refuses a workspace outside the allowlist', async () => {
        mockConfig.postSuggestions.workspaceIds = ['other-workspace'];
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'gated' });
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
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

    it('whitespace-only KB never offers faq_tip (the unified predicate: blank-but-truthy is NO KB)', () => {
        expect(pickPostType({ hasLiveDatedRow: false, hasCatalog: false, hasHours: false, knowledgeBase: '   \n ' }, null)).toBe('general');
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

    it('foreign/unknown page: page_not_found WITHOUT touching the cap (no cross-tenant slot burn)', async () => {
        queueOwnedPage([]); // page not in this workspace
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'page_not_found' });
        expect(mockCheckDailyCap).not.toHaveBeenCalled();
        expect(mockClaimDailyCapSlot).not.toHaveBeenCalled();
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('cap exhausted (Redis view): refuses without claiming or calling OpenAI', async () => {
        mockCheckDailyCap.mockResolvedValue({ allowed: false, used: 3, limit: 3 });
        queueOwnedPage([PAGE_ROW]);
        queueCapCount(3);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toMatchObject({ ok: false, reason: 'daily_cap' });
        expect(mockClaimDailyCapSlot).not.toHaveBeenCalled();
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('DB-grounded floor: 3 rows already today refuse even when Redis says 0 (counter-loss)', async () => {
        mockCheckDailyCap.mockResolvedValue({ allowed: true, used: 0, limit: 3 });
        queueOwnedPage([PAGE_ROW]);
        queueCapCount(3);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'daily_cap', cap: { allowed: false, used: 3, limit: 3 } });
        expect(mockClaimDailyCapSlot).not.toHaveBeenCalled();
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
        // The dogfood counter-loss signal is logged the moment it recurs.
        expect(log.warn).toHaveBeenCalledWith(
            '[PostSuggestions] Daily-cap counter behind DB rows',
            expect.objectContaining({ dbUsed: 3, redisUsed: 0 }),
        );
    });

    it('Redis down: FAILS CLOSED (cap is the only bound on real spend)', async () => {
        mockCheckDailyCap.mockRejectedValue(new Error('redis down'));
        queueOwnedPage([PAGE_ROW]);
        queueCapCount(0);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'cap_check_unavailable' });
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('DB count erroring: FAILS CLOSED too (both cap reads are load-bearing)', async () => {
        queueOwnedPage([PAGE_ROW]);
        router.queue({ op: 'select', table: postSuggestions, fields: ['value'], error: new Error('db down') });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'cap_check_unavailable' });
        expect(mockClaimDailyCapSlot).not.toHaveBeenCalled();
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('atomic claim refused (concurrent race lost): refuses without paid calls', async () => {
        mockCheckDailyCap.mockResolvedValue({ allowed: true, used: 2, limit: 3 });
        mockClaimDailyCapSlot.mockResolvedValue(false);
        queueOwnedPage([PAGE_ROW]);
        queueCapCount(2);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toMatchObject({ ok: false, reason: 'daily_cap' });
        expect(mockClaimDailyCapSlot).toHaveBeenCalledTimes(1);
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('atomic claim throwing: FAILS CLOSED', async () => {
        mockClaimDailyCapSlot.mockRejectedValue(new Error('redis down'));
        queueOwnedPage([PAGE_ROW]);
        queueCapCount(0);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'cap_check_unavailable' });
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
    });

    it('claims the slot BEFORE the paid calls so a failing call still burns it', async () => {
        mockChatCreate.mockRejectedValue(new Error('api down'));
        queueOwnedPage([PAGE_ROW]);
        queueCapCount(0);
        queueDatedCatalog([]);
        queueCollections([]);
        queuePrevious([]);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r).toEqual({ ok: false, reason: 'generation_failed' });
        expect(mockClaimDailyCapSlot).toHaveBeenCalledTimes(1);
        expect(mockClaimDailyCapSlot.mock.invocationCallOrder[0]).toBeLessThan(mockChatCreate.mock.invocationCallOrder[0]);
    });
});

describe('generateSuggestion — happy path and degrades', () => {
    it('returns text + stored image and decrements remaining', async () => {
        queueFullRun(INSERTED);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.suggestion.text).toBe('بوست تجريبي 🌟');
        expect(r.suggestion.imageUrl).toBe('https://media/x.png');
        expect(r.imageDegraded).toBeUndefined();
        expect(r.remainingToday).toBe(2);
        // One envelope across routes: generate carries the availability list too.
        expect(r.availableTypes).toContain('general');
        expect(r.availableTypes).toContain('faq_tip'); // PAGE_ROW has a KB
        expect(r.availableTypes).not.toContain('promo');
        // JPEG contract: .jpg key + image/jpeg content type (photographic card).
        expect(mockPut).toHaveBeenCalledWith(expect.stringMatching(/^generated-posts\/.+\.jpg$/), expect.any(Buffer), 'image/jpeg');
        // Guard-order pin: the atomic claim precedes the first paid call.
        expect(mockClaimDailyCapSlot.mock.invocationCallOrder[0]).toBeLessThan(mockChatCreate.mock.invocationCallOrder[0]);
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

    it('UNDECODABLE model output (compose returns null) degrades to text-only — corrupt bytes are never uploaded', async () => {
        mockComposePostCard.mockResolvedValue(null);
        queueFullRun({ ...INSERTED, imageUrl: null, imageKey: null });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.suggestion.imageUrl).toBeNull();
        expect(r.imageDegraded).toBe('image_failed');
        expect(mockPut).not.toHaveBeenCalled();
    });
});

/**
 * The angle picker has had cross-day memory since day one; the IMAGE never did,
 * so a service business with no physical product converged on "laptop on a
 * desk" every morning. These pin the memory that closes that gap.
 */
describe('buildRecentBriefsBlock — the image gets the cross-day memory the angle already had', () => {
    it('is EMPTY for a page with no history — nothing to avoid, no wasted tokens', () => {
        expect(buildRecentBriefsBlock([])).toBe('');
    });

    it('lists the recent scenes and demands a different SUBJECT and SETTING', () => {
        const block = buildRecentBriefsBlock([
            'A laptop on a wooden desk beside a coffee cup',
            'An open notebook under warm window light',
        ]);
        expect(block).toContain('A laptop on a wooden desk beside a coffee cup');
        expect(block).toContain('An open notebook under warm window light');
        // Not "vary the lighting" — that is how the same desk comes back.
        expect(block).toMatch(/SUBJECT and SETTING/);
    });

    it('renders one bullet per scene so the list cannot read as a single sentence', () => {
        const block = buildRecentBriefsBlock(['scene one', 'scene two', 'scene three']);
        expect(block.match(/^ {2}- /gm)).toHaveLength(3);
    });
});

/**
 * Shadow measurement of figures the model wrote that its inputs do not contain.
 * D-047 already keeps phone digits out of model hands; this measures whether
 * money and other figures need the same treatment.
 */
describe('findUngroundedNumbers — figures the inputs do not support', () => {
    it('flags a figure that appears nowhere in the inputs', () => {
        expect(findUngroundedNumbers('السعر 45 د فقط', 'رقم 1 — القطع: 22 — الوزن: 2-4 كيلو'))
            .toEqual(['45']);
    });

    it('accepts a figure the inputs DO carry — the 2026-08-10 false alarm', () => {
        // «45 د» lives in fact_rows.price and is rendered into the prompt block.
        expect(findUngroundedNumbers(
            'رواء رقم 2 بـ 45 د',
            'رواء رقم 2 — السلسلة: عادي — القطع: 30 — الوزن: 3-6 كيلو — 45 د',
        )).toEqual([]);
    });

    it('a PHONE NUMBER must not ground an unrelated price (token equality, not substring)', () => {
        // «0932456789» contains the characters "45". A substring test would call
        // the price grounded and miss exactly what this exists to catch.
        expect(findUngroundedNumbers('السعر 45 د', 'اتصل بنا 0932456789')).toEqual(['45']);
    });

    it('normalises Arabic-Indic digits on both sides', () => {
        expect(findUngroundedNumbers('السعر ٤٥ د', 'السعر 45 د')).toEqual([]);
        expect(findUngroundedNumbers('السعر 45 د', 'السعر ٤٥ د')).toEqual([]);
    });

    it('ignores thousands separators so 35,000 matches 35000', () => {
        expect(findUngroundedNumbers('بسعر 35,000 ل.س', 'الدورة بسعر 35000 ليرة')).toEqual([]);
    });

    it('reports each unsupported figure once, in order', () => {
        expect(findUngroundedNumbers('99 ثم 77 ثم 99 مرة أخرى', 'لا أرقام هنا'))
            .toEqual(['99', '77']);
    });

    it('is empty for text with no figures at all', () => {
        expect(findUngroundedNumbers('راسلنا لمعرفة السعر', 'أي بيانات')).toEqual([]);
    });
});

describe('generateSuggestion — logo badge (pre-fetched, parallel, never fatal)', () => {
    const LOGO_PAGE_ROW = { ...PAGE_ROW, instagramProfilePicUrl: 'https://cdn.example/avatar.jpg' };

    it('starts the logo fetch BEFORE the image call resolves and passes the buffer to the compositor', async () => {
        const logoBuf = Buffer.from('rounded-logo');
        mockFetchRoundedLogo.mockResolvedValue(logoBuf);
        queueFullRun(INSERTED, { pageRow: LOGO_PAGE_ROW });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        expect(mockFetchRoundedLogo).toHaveBeenCalledWith('https://cdn.example/avatar.jpg');
        expect(mockComposePostCard).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({ logo: logoBuf }),
        );
        // Parallelism pin (Rule 17.3): the fetch STARTS before the image call
        // is issued — not sequentially after it resolves (the old 5s tail).
        expect(mockFetchRoundedLogo.mock.invocationCallOrder[0])
            .toBeLessThan(mockImagesGenerate.mock.invocationCallOrder[0]);
    });

    /**
     * REGRESSION (2026-08-10, spotted on a real card): the order used to put the
     * Instagram avatar first, so a page whose linked IG was a PERSONAL account
     * got the owner's face stamped on every generated card — while the image
     * prompt forbids the model from drawing people at all. The card's
     * destination is the Facebook Page, so the Page's own picture is the mark.
     */
    it('prefers the FACEBOOK PAGE picture over a linked Instagram avatar', async () => {
        mockFetchRoundedLogo.mockResolvedValue(Buffer.from('logo'));
        queueFullRun(INSERTED, {
            pageRow: { ...LOGO_PAGE_ROW, facebookPageId: '878802365317875' },
        });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        expect(mockFetchRoundedLogo).toHaveBeenCalledWith(
            expect.stringContaining('graph.facebook.com/878802365317875/picture'),
        );
        expect(mockFetchRoundedLogo).not.toHaveBeenCalledWith('https://cdn.example/avatar.jpg');
    });

    it('falls back to the Instagram avatar only when the page has no Facebook id', async () => {
        mockFetchRoundedLogo.mockResolvedValue(Buffer.from('logo'));
        queueFullRun(INSERTED, { pageRow: { ...LOGO_PAGE_ROW, facebookPageId: null } });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        expect(mockFetchRoundedLogo).toHaveBeenCalledWith('https://cdn.example/avatar.jpg');
    });

    it('a logo-fetch REJECTION never fails the generation — composes with logo null', async () => {
        mockFetchRoundedLogo.mockRejectedValue(new Error('cdn down'));
        queueFullRun(INSERTED, { pageRow: LOGO_PAGE_ROW });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.imageDegraded).toBeUndefined();
        expect(mockComposePostCard).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({ logo: null }),
        );
    });

    it('a page with no logo URL skips the fetch entirely', async () => {
        queueFullRun(INSERTED);
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        expect(mockFetchRoundedLogo).not.toHaveBeenCalled();
        expect(mockComposePostCard).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({ logo: null }),
        );
    });
});

describe('generateSuggestion — supersede is transactional (replace = old dies only when new exists)', () => {
    it('supersedes the old ready row INSIDE the tx and removes its image only AFTER commit', async () => {
        queueFullRun(INSERTED, { stale: [{ id: 'old1', imageKey: 'generated-posts/ws/old.png' }] });
        mockRemove.mockImplementation((key: string) => {
            router.events.push(`remove:${key}`);
            return Promise.resolve();
        });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        expect(mockRemove).toHaveBeenCalledWith('generated-posts/ws/old.png');

        const events = router.events;
        const insertIdx = events.indexOf('insert:post_suggestions');
        const updateIdx = events.indexOf('update:post_suggestions');
        const commitIdx = events.indexOf('tx:commit');
        const removeIdx = events.indexOf('remove:generated-posts/ws/old.png');
        // Insert first, supersede second, both inside the tx; S3 delete last
        // (OBJECT_STORAGE.md: upload new → commit DB → delete old).
        expect(insertIdx).toBeGreaterThan(events.indexOf('tx:start'));
        expect(updateIdx).toBeGreaterThan(insertIdx);
        expect(commitIdx).toBeGreaterThan(updateIdx);
        expect(removeIdx).toBeGreaterThan(commitIdx);
    });

    it('a suppressed cron insert (blue/green race) supersedes NOTHING and returns the surviving row', async () => {
        queueFullRun(null); // partial unique index suppressed the insert
        const ready = { ...INSERTED, id: 'sibling', source: 'cron' };
        queueGetToday([ready]); // fallback read finds the sibling's row
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'cron');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.suggestion.id).toBe('sibling');
        // The surviving row and its image are untouched.
        expect(router.events).not.toContain('update:post_suggestions');
        expect(mockRemove).not.toHaveBeenCalled();
    });
});

describe('generateSuggestion — day-to-day variety', () => {
    it("excludes the previous day's angle: the previous-type lookup is the latest row from ANY day", async () => {
        queueFullRun({ ...INSERTED, postType: 'product_spotlight' }, {
            previous: [{ postType: 'promo' }], // yesterday's cron row
            datedCatalog: [{ startsAt: '2026-08-01', endsAt: null }], // promo is a live candidate
        });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual');
        expect(r.ok).toBe(true);
        const insertCall = router.calls.find(c => c.op === 'insert');
        expect((insertCall?.values as { postType?: string } | undefined)?.postType).toBe('product_spotlight');

        // Regression pin for the dead-variety bug: the lookup must NOT be
        // day-scoped (a cron generation is the first row of its day, so a
        // today-filter always yielded null → same angle every morning).
        const prevCall = router.calls.find(c => c.op === 'select' && c.table === 'post_suggestions' && c.fields?.includes('postType'));
        expect(prevCall).toBeDefined();
        expect(referencesColumn(prevCall?.where, postSuggestions.pageId)).toBe(true);
        expect(referencesColumn(prevCall?.where, postSuggestions.suggestedFor)).toBe(false);
    });
});

describe('generateSuggestion — server-side availability enforcement (one derivation, both directions)', () => {
    const insertedPostType = () => {
        const insertCall = router.calls.find(c => c.op === 'insert');
        return (insertCall?.values as { postType?: string } | undefined)?.postType;
    };

    it('requested product_spotlight with an EMPTY fetched catalog DOWNGRADES to the picker — and the response carries the type actually used', async () => {
        // Ecommerce page whose store-context fetch yields nothing: availability
        // ADVERTISES product_spotlight from ecommerceStoreId (the cheap half of
        // the boundary), but generation validates against the fetched catalog.
        const ECOM_ROW = { ...PAGE_ROW, ecommerceStoreId: 'store-1' };
        vi.mocked(getStoreContextForAI).mockResolvedValueOnce({ productCatalog: '' });
        queueFullRun({ ...INSERTED, postType: 'faq_tip' }, { pageRow: ECOM_ROW });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual', { postType: 'product_spotlight' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // The picker's choice (PAGE_ROW's KB → faq_tip) is what gets written and returned.
        expect(insertedPostType()).toBe('faq_tip');
        expect(r.suggestion.postType).toBe('faq_tip');
        // Boundary pin: the advertisement half still lists product_spotlight —
        // enforcement lives in generation, not in the cheap availability read.
        expect(r.availableTypes).toContain('product_spotlight');
        expect(log.info).toHaveBeenCalledWith(
            '[PostSuggestions] Requested angle unavailable — downgraded to variety picker',
            { pageId: PAGE, requested: 'product_spotlight', used: 'faq_tip' },
        );
    });

    it('a requested angle the page CAN deliver is honored — no downgrade, no log', async () => {
        // PAGE_ROW delivers both product_spotlight (catalog block mock) and
        // faq_tip; the picker alone would open on product_spotlight, so an
        // honored faq_tip proves the override path (not a coincidence).
        queueFullRun({ ...INSERTED, postType: 'faq_tip' });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual', { postType: 'faq_tip' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(insertedPostType()).toBe('faq_tip');
        expect(r.suggestion.postType).toBe('faq_tip');
        expect(log.info).not.toHaveBeenCalled();
    });

    it('whitespace-only KB: faq_tip is NOT advertised AND a faq_tip request downgrades — the unified predicate pinned from both directions', async () => {
        const BLANK_KB_ROW = { ...PAGE_ROW, knowledgeBase: '   \n  ' };
        queueFullRun({ ...INSERTED, postType: 'product_spotlight' }, { pageRow: BLANK_KB_ROW });
        const r = await postSuggestionsService.generateSuggestion(WS, PAGE, 'manual', { postType: 'faq_tip' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // Advertisement direction: the availability list applies the same trim.
        expect(r.availableTypes).not.toContain('faq_tip');
        // Enforcement direction: the request downgrades to the picker's choice
        // (catalog block mock → product_spotlight).
        expect(insertedPostType()).toBe('product_spotlight');
        expect(r.suggestion.postType).toBe('product_spotlight');
        expect(log.info).toHaveBeenCalledWith(
            '[PostSuggestions] Requested angle unavailable — downgraded to variety picker',
            { pageId: PAGE, requested: 'faq_tip', used: 'product_spotlight' },
        );
    });
});

describe('runDailyPostSuggestions — cron pre-generation', () => {
    const emptyResult = { eligible: 0, generated: 0, skippedExisting: 0, skippedWasteGuard: 0, failed: 0 };

    it('EMPTY workspace allowlist generates for nobody (stricter than the endpoint) and says so in the log', async () => {
        mockConfig.postSuggestions.workspaceIds = [];
        const result = await postSuggestionsService.runDailyPostSuggestions();
        expect(result).toEqual(emptyResult);
        expect(mockCheckDailyCap).not.toHaveBeenCalled();
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daily run skipped'));
    });

    it('skips a page when ANY of today\'s rows exist — manual included (never supersede the merchant\'s post)', async () => {
        mockConfig.postSuggestions.workspaceIds = [WS];
        router.queue({ op: 'select', table: pages, fields: ['workspaceId'], rows: [{ id: PAGE, workspaceId: WS }] });
        router.queue({ op: 'select', table: postSuggestions, fields: ['id'], rows: [{ id: 'manual-row' }] });
        const result = await postSuggestionsService.runDailyPostSuggestions();
        expect(result).toEqual({ ...emptyResult, eligible: 1, skippedExisting: 1 });
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();

        // Regression pin: the pre-check is source-BLIND (the old source='cron'
        // filter let a post-deploy tick replace a same-day manual post).
        const existingCall = router.calls.find(c => c.op === 'select' && c.table === 'post_suggestions' && c.fields?.includes('id'));
        expect(existingCall).toBeDefined();
        expect(referencesColumn(existingCall?.where, postSuggestions.source)).toBe(false);

        // Observability pin: one structured run-complete heartbeat.
        expect(log.info).toHaveBeenCalledWith(
            '[PostSuggestions] Daily run complete',
            expect.objectContaining({ eligible: 1, skippedExisting: 1, generated: 0, failed: 0 }),
        );
    });

    it('waste guard trips at WARN after 3 unopened cron rows with no engagement anywhere', async () => {
        mockConfig.postSuggestions.workspaceIds = [WS];
        router.queue({ op: 'select', table: pages, fields: ['workspaceId'], rows: [{ id: PAGE, workspaceId: WS }] });
        router.queue({ op: 'select', table: postSuggestions, fields: ['id'], rows: [] }); // no row today
        router.queue({ op: 'select', table: postSuggestions, fields: ['lastEngagedAt'], rows: [{ lastEngagedAt: null }] });
        router.queue({ op: 'select', table: postSuggestions, fields: ['openedAt'], rows: [{ openedAt: null }, { openedAt: null }, { openedAt: null }] });
        const result = await postSuggestionsService.runDailyPostSuggestions();
        expect(result).toEqual({ ...emptyResult, eligible: 1, skippedWasteGuard: 1 });
        expect(makeTrackedOpenAI).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
            '[PostSuggestions] Waste guard tripped — skipping pre-generation',
            expect.objectContaining({ pageId: PAGE }),
        );
    });

    it('waste guard SELF-HEALS: an engagement stamp restarts the streak window and pre-generation resumes', async () => {
        mockConfig.postSuggestions.workspaceIds = [WS];
        router.queue({ op: 'select', table: pages, fields: ['workspaceId'], rows: [{ id: PAGE, workspaceId: WS }] });
        router.queue({ op: 'select', table: postSuggestions, fields: ['id'], rows: [] }); // no row today
        // Merchant engaged (opened/copied/downloaded something) after the old
        // unopened streak → only cron rows created since then count: none.
        router.queue({ op: 'select', table: postSuggestions, fields: ['lastEngagedAt'], rows: [{ lastEngagedAt: '2026-08-08T09:00:00.000Z' }] });
        router.queue({ op: 'select', table: postSuggestions, fields: ['openedAt'], rows: [] });
        queueFullRun({ ...INSERTED, id: 'cron1', source: 'cron' });
        const result = await postSuggestionsService.runDailyPostSuggestions();
        expect(result).toEqual({ ...emptyResult, eligible: 1, generated: 1 });

        // Regression pin for the permanent latch: with a stamp present the
        // streak query is bounded by createdAt > lastEngagedAt.
        const streakCall = router.calls.find(c => c.op === 'select' && c.table === 'post_suggestions' && c.fields?.includes('openedAt'));
        expect(streakCall).toBeDefined();
        expect(referencesColumn(streakCall?.where, postSuggestions.createdAt)).toBe(true);
    });
});

describe('getToday', () => {
    it('foreign/unknown page: null (controller 404s) BEFORE any cap read', async () => {
        queueOwnedPage([]);
        const r = await postSuggestionsService.getToday(WS, PAGE);
        expect(r).toBeNull();
        expect(mockCheckDailyCap).not.toHaveBeenCalled();
    });

    it('returns the ready suggestion, remaining, and availableTypes from ONE page read', async () => {
        mockCheckDailyCap.mockResolvedValue({ allowed: true, used: 1, limit: 3 });
        queueGetToday([INSERTED]);
        const r = await postSuggestionsService.getToday(WS, PAGE);
        expect(r).not.toBeNull();
        if (!r) return;
        expect(r.suggestion?.id).toBe('s1');
        expect(r.remainingToday).toBe(2);
        expect(r.availableTypes).toContain('general');
        expect(r.availableTypes).toContain('faq_tip'); // PAGE_ROW has a KB
        expect(r.availableTypes).not.toContain('promo');
    });

    it('cap-read failure degrades to NULL (= unknown, never a false "exhausted") AND is captured with a stable fingerprint', async () => {
        mockCheckDailyCap.mockRejectedValue(new Error('redis down'));
        queueGetToday([]);
        const r = await postSuggestionsService.getToday(WS, PAGE);
        expect(r).not.toBeNull();
        if (!r) return;
        expect(r.suggestion).toBeNull();
        expect(r.remainingToday).toBeNull();
        expect(captureError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.stringContaining('cap read failed'),
            expect.objectContaining({ level: 'warning', fingerprint: ['post-suggestions-cap-read'] }),
        );
    });
});
