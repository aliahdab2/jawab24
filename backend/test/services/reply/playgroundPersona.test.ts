/**
 * Production regression (measured 2026-08-07): the merchant-facing test reply
 * ("اختبار الرد الذكي", POST /pages/:id/test-reply) generated its reply WITHOUT
 * the merchant's own brand voice or reply style, so it showed merchants a reply
 * their real customers would never receive.
 *
 * Same question, same page, same day:
 *   test button   → «تمام يهمني، نبي نجرب» answered with a self-serve link,
 *                   NO contact ask.
 *   real Messenger→ «تمام، ابعث لي اسمك ورقم واتساب…» — correct, because the
 *                   stored persona carries that instruction.
 *
 * Root cause: `brandVoiceNotes` / `replyStyle` were grouped in
 * `PlaygroundContextOptions` under "Admin-only overrides (not available in
 * customer-facing test)" — modelled as admin EXPERIMENT inputs. The
 * customer-facing caller passes neither and nothing fell back to the merchant's
 * stored values, while every other path (production `enrichPageContext`, the
 * cache-warm script, the admin playground) resolved them.
 *
 * These tests pin: stored values reach `playgroundInput`; an explicit override
 * still wins; nothing stored stays `undefined`; and — the parity pin Rule 19.3
 * asks for — the test-reply path and the PRODUCTION path resolve brand voice
 * through the SAME function, asserted by calling production's
 * `enrichPageContext` rather than by re-stating its rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/settings', () => ({
    settingsService: { getSettings: vi.fn() },
}));
vi.mock('../../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: { getSettings: vi.fn() },
}));
vi.mock('../../../src/services/ecommerce', () => ({
    getEnrichedKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    getStoreContextForAI: vi.fn().mockResolvedValue({ storePolicies: undefined, productCatalog: undefined }),
}));
vi.mock('../../../src/services/catalog', () => ({
    catalogService: { buildCatalogPromptBlock: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../src/services/factCollections', () => ({
    factCollectionsService: {
        buildFactCollectionsContext: vi.fn().mockResolvedValue({ block: undefined, gated: false }),
    },
}));
// Production's enrichPageContext walks the e-commerce integration registry first.
vi.mock('../../../src/integrations', () => ({
    integrationRegistry: { getEnabled: () => [] },
}));

import { buildPlaygroundContext } from '../../../src/services/reply/playgroundContext';
import { enrichPageContext, resolveBrandVoiceNotes } from '../../../src/services/reply/contextEnricher';
import { settingsService } from '../../../src/services/settings';
import { workspaceSettingsService } from '../../../src/services/workspaceSettings';

const PAGE = {
    id: 'page-1',
    name: 'متجر تجريبي',
    userId: 'user-1',
    workspaceId: 'ws-1',
    knowledgeBase: 'kb',
    kbActiveVersion: null,
    ecommerceStoreId: null,
};

/** The real-world shape: a persona whose instruction is the whole defect. */
const STORED_PERSONA = 'الاسم: سارة. اطلبي اسم الزبون ورقم واتساب لإتمام الطلب.';
const STORED_PERSONA_EN = 'Name: Sarah. Always ask for the customer name and WhatsApp number.';

/** Only the fields the persona resolution reads — the rest come from DEFAULTS. */
function workspaceSettings(overrides: Record<string, unknown> = {}) {
    return {
        defaultReplyLanguage: 'ar',
        supportedLanguages: ['ar', 'en'],
        timezone: 'Asia/Damascus',
        replyStyle: 'professional',
        brandVoiceNotes: '',
        brandVoiceNotesMulti: {},
        ...overrides,
    };
}

/** The customer-facing test-reply call: page + question + channel, nothing else. */
function customerFacingCall(question: string, channel: 'comment' | 'dm' = 'dm') {
    return buildPlaygroundContext({ page: PAGE, question, channel });
}

beforeEach(() => {
    vi.clearAllMocks();
    // commentReplyMode only — the persona must NOT come from this legacy row.
    vi.mocked(settingsService.getSettings).mockResolvedValue(
        { commentReplyMode: 'public' } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>,
    );
    vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(
        workspaceSettings() as unknown as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>,
    );
});

function mockWorkspace(overrides: Record<string, unknown>) {
    vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(
        workspaceSettings(overrides) as unknown as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>,
    );
}

describe('buildPlaygroundContext — brandVoiceNotes', () => {
    it('applies the merchant\'s stored brand voice on the customer-facing path (no caller value)', async () => {
        mockWorkspace({ brandVoiceNotesMulti: { ar: STORED_PERSONA } });

        const { playgroundInput } = await customerFacingCall('عندكم توصيل؟');

        expect(playgroundInput.brandVoiceNotes).toBe(STORED_PERSONA);
    });

    it('lets an explicitly supplied brand voice win (admin experimentation preserved)', async () => {
        mockWorkspace({ brandVoiceNotesMulti: { ar: STORED_PERSONA } });

        const { playgroundInput } = await buildPlaygroundContext({
            page: PAGE, question: 'عندكم توصيل؟', channel: 'dm',
            brandVoiceNotes: 'admin experiment voice',
        });

        expect(playgroundInput.brandVoiceNotes).toBe('admin experiment voice');
    });

    it('stays undefined when the merchant stored no brand voice (unchanged from before the fix)', async () => {
        const { playgroundInput } = await customerFacingCall('عندكم توصيل؟');

        expect(playgroundInput.brandVoiceNotes).toBeUndefined();
    });

    it('degrades to the pre-fix behaviour when the settings read fails — never throws', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockRejectedValue(new Error('redis + db down'));

        const { playgroundInput } = await customerFacingCall('عندكم توصيل؟');

        expect(playgroundInput.brandVoiceNotes).toBeUndefined();
        expect(playgroundInput.replyStyle).toBeUndefined();
    });

    it('reads the WORKSPACE store, not the legacy per-user row (page.userId may not be the workspace owner)', async () => {
        vi.mocked(settingsService.getSettings).mockResolvedValue({
            commentReplyMode: 'public',
            brandVoiceNotesMulti: { ar: 'persona from a DIFFERENT workspace' },
            replyStyle: 'enthusiastic',
        } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);
        mockWorkspace({ brandVoiceNotesMulti: { ar: STORED_PERSONA }, replyStyle: 'casual' });

        const { playgroundInput } = await customerFacingCall('عندكم توصيل؟');

        expect(playgroundInput.brandVoiceNotes).toBe(STORED_PERSONA);
        expect(playgroundInput.replyStyle).toBe('casual');
    });
});

describe('buildPlaygroundContext — replyStyle', () => {
    it('applies the merchant\'s stored reply style on the customer-facing path', async () => {
        mockWorkspace({ replyStyle: 'casual' });

        const { playgroundInput } = await customerFacingCall('عندكم توصيل؟');

        expect(playgroundInput.replyStyle).toBe('casual');
    });

    it('lets an explicitly supplied reply style win', async () => {
        mockWorkspace({ replyStyle: 'casual' });

        const { playgroundInput } = await buildPlaygroundContext({
            page: PAGE, question: 'عندكم توصيل؟', channel: 'dm',
            replyStyle: 'enthusiastic',
        });

        expect(playgroundInput.replyStyle).toBe('enthusiastic');
    });

    it('carries the stored default (\'professional\') rather than undefined — matching production', async () => {
        // Production always passes userSettings.replyStyle, which defaults to
        // 'professional'; the prompt is byte-identical either way
        // (styleMap[replyStyle || ''] || styleMap.professional) but the test path
        // must not be the only caller that omits the field.
        const { playgroundInput } = await customerFacingCall('عندكم توصيل؟');

        expect(playgroundInput.replyStyle).toBe('professional');
    });
});

describe('test reply vs production — brand voice resolves through the SAME function', () => {
    // Rule 19.3: import the production predicate, never restate its rule. Both
    // assertions below call production code with the same stored settings and
    // demand the same answer, so a divergent re-implementation on either side
    // (or a different language-pick rule) fails here. Brand voice is also a
    // reply-cache key segment (`bv:`), so divergence strands warmed entries.
    const stored = { brandVoiceNotesMulti: { ar: STORED_PERSONA, en: STORED_PERSONA_EN } };

    it.each([
        ['an Arabic question', 'كم سعر التوصيل؟', STORED_PERSONA],
        ['an English question', 'How much is delivery?', STORED_PERSONA_EN],
    ])('picks the same entry as resolveBrandVoiceNotes for %s', async (_label, question, expected) => {
        mockWorkspace(stored);

        const { playgroundInput } = await customerFacingCall(question);

        expect(playgroundInput.brandVoiceNotes).toBe(expected);
        expect(playgroundInput.brandVoiceNotes)
            .toBe(resolveBrandVoiceNotes(workspaceSettings(stored), question));
    });

    it('matches what production\'s enrichPageContext resolves for the same settings + message', async () => {
        mockWorkspace(stored);
        const question = 'كم سعر التوصيل؟';

        const { playgroundInput } = await customerFacingCall(question);
        const production = await enrichPageContext(
            PAGE as unknown as Record<string, unknown>,
            workspaceSettings(stored),
            question,
            PAGE.knowledgeBase,
        );

        expect(playgroundInput.brandVoiceNotes).toBe(production.brandVoiceNotes);
        expect(production.brandVoiceNotes).toBe(STORED_PERSONA);
    });
});
