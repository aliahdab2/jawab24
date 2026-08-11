/**
 * The playground must preview what production would actually send.
 *
 * Production takes the persona and the reply tone from the OWNER'S SETTINGS
 * (messageProcessor → enrichPageContext → resolveBrandVoiceNotes / settings.replyStyle).
 * buildPlaygroundContext used to read both from the request body alone, and neither
 * playground UI sends them — so a merchant testing their own page was previewed
 * WITHOUT their persona and always at the default "professional" tone. A named persona
 * («سارة») never introduced itself on that screen even though a real Messenger DM would
 * have used it, which made the playground a misleading witness for the exact settings
 * it exists to demonstrate.
 *
 * These tests pin the fallback and its precedence; the language-variant choice itself is
 * production's own resolveBrandVoiceNotes, exercised here rather than re-implemented.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/settings', () => ({
    settingsService: { getSettings: vi.fn() },
}));
vi.mock('../../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: { getSettings: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../../src/services/ecommerce', () => ({
    getEnrichedKnowledgeBase: vi.fn().mockResolvedValue(null),
    getStoreContextForAI: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../src/services/catalog', () => ({
    catalogService: { getCatalogForPrompt: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../../src/services/factCollections', () => ({
    factCollectionsService: { buildFactCollectionsContext: vi.fn().mockResolvedValue({ block: null, gated: false }) },
}));

import { buildPlaygroundContext } from '../../../src/services/reply/playgroundContext';
import { settingsService } from '../../../src/services/settings';

const PAGE = {
    id: 'page-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    name: 'متجر البخور',
    knowledgeBase: 'توصيل بنغازي 10 دينار.',
    kbActiveVersion: 1,
};

/** The shape merchants actually store: per-language persona + a chosen tone. */
const STORED = {
    commentReplyMode: 'public',
    replyStyle: 'casual',
    brandVoiceNotesMulti: { ar: 'سارة — لهجة ليبية ودودة', en: 'Sara — friendly Libyan dialect' },
    brandVoiceNotes: '',
};

const build = (opts: Record<string, unknown> = {}) =>
    buildPlaygroundContext({
        page: PAGE as never,
        question: 'مين معي؟',
        channel: 'dm',
        ...opts,
    } as never);

describe('buildPlaygroundContext — previews the merchant\'s stored persona and tone', () => {
    beforeEach(() => {
        vi.mocked(settingsService.getSettings).mockResolvedValue(STORED as never);
    });

    it('falls back to the stored persona when the caller sends none (the playground UIs send none)', async () => {
        const { playgroundInput } = await build();
        expect(playgroundInput.brandVoiceNotes).toBe('سارة — لهجة ليبية ودودة');
    });

    it('falls back to the stored reply style instead of silently previewing "professional"', async () => {
        const { playgroundInput } = await build();
        expect(playgroundInput.replyStyle).toBe('casual');
    });

    it('picks the persona variant matching the customer message language, as production does', async () => {
        const { playgroundInput } = await build({ question: 'who am I talking to?' });
        expect(playgroundInput.brandVoiceNotes).toBe('Sara — friendly Libyan dialect');
    });

    it('an explicit caller value still wins — the admin console and the eval try unsaved personas', async () => {
        const { playgroundInput } = await build({
            brandVoiceNotes: 'رنيم من شركة أخرى',
            replyStyle: 'enthusiastic',
        });
        expect(playgroundInput.brandVoiceNotes).toBe('رنيم من شركة أخرى');
        expect(playgroundInput.replyStyle).toBe('enthusiastic');
    });

    it('a merchant with no persona saved is unchanged — no persona, no invented tone', async () => {
        vi.mocked(settingsService.getSettings).mockResolvedValue({
            commentReplyMode: 'public', brandVoiceNotesMulti: {}, brandVoiceNotes: '',
        } as never);
        const { playgroundInput } = await build();
        expect(playgroundInput.brandVoiceNotes).toBeFalsy();
        expect(playgroundInput.replyStyle).toBeUndefined();
    });

    it('a settings failure never breaks the playground — it degrades to the old behaviour', async () => {
        vi.mocked(settingsService.getSettings).mockRejectedValue(new Error('db down'));
        const { playgroundInput } = await build();
        expect(playgroundInput.brandVoiceNotes).toBeUndefined();
        expect(playgroundInput.replyStyle).toBeUndefined();
    });
});
