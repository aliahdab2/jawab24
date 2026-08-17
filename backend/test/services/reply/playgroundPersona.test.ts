/**
 * The playground must preview what production would actually send.
 *
 * Two defects, fixed in that order:
 *
 * 1. buildPlaygroundContext read the persona and the tone from the request body alone,
 *    and neither playground UI sends them — so a merchant testing their own page was
 *    previewed WITHOUT their persona and always at the default "professional" tone. A
 *    named persona («سارة») never introduced itself on that screen even though a real
 *    Messenger DM would have used it.
 *
 * 2. The fallback then read the OWNER row (settingsService.getSettings(page.userId)).
 *    Production does not: messageProcessor and commentProcessor refuse a page with no
 *    workspace and read workspaceSettingsService.getSettings(page.workspaceId). The owner
 *    row overlays its pipeline fields from resolveWorkspaceId(userId) — an unordered
 *    `limit(1)` over the user's memberships — so a merchant holding more than one
 *    workspace could be previewed with a DIFFERENT workspace's persona.
 *
 * These tests pin the fallback, its precedence, and — the case that separates the two
 * stores — that the page's own workspace wins over the owner row when they disagree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/settings', () => ({
    settingsService: { getSettings: vi.fn() },
}));
vi.mock('../../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: { getSettings: vi.fn() },
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
import { workspaceSettingsService } from '../../../src/services/workspaceSettings';

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
    replyStyle: 'casual',
    brandVoiceNotesMulti: { ar: 'سارة — لهجة ليبية ودودة', en: 'Sara — friendly Libyan dialect' },
    brandVoiceNotes: '',
};

/** The owner row carries commentReplyMode; the persona must NOT be taken from it. */
const OWNER_ROW = { commentReplyMode: 'public' };

const build = (opts: Record<string, unknown> = {}) =>
    buildPlaygroundContext({
        page: PAGE as never,
        question: 'مين معي؟',
        channel: 'dm',
        ...opts,
    } as never);

describe('buildPlaygroundContext — previews the merchant\'s stored persona and tone', () => {
    beforeEach(() => {
        vi.mocked(settingsService.getSettings).mockResolvedValue(OWNER_ROW as never);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(STORED as never);
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

    it('reads the PAGE\'S workspace, not the owner row — they diverge for a multi-workspace merchant', async () => {
        // resolveWorkspaceId(userId) is an unordered limit(1), so the owner row can carry
        // the OTHER workspace's persona. The page belongs to ws-1; that persona must win.
        vi.mocked(settingsService.getSettings).mockResolvedValue({
            ...OWNER_ROW,
            replyStyle: 'enthusiastic',
            brandVoiceNotesMulti: { ar: 'رنيم — متجر آخر تماماً' },
            brandVoiceNotes: '',
        } as never);
        const { playgroundInput } = await build();
        expect(playgroundInput.brandVoiceNotes).toBe('سارة — لهجة ليبية ودودة');
        expect(playgroundInput.replyStyle).toBe('casual');
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
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            brandVoiceNotesMulti: {}, brandVoiceNotes: '',
        } as never);
        const { playgroundInput } = await build();
        expect(playgroundInput.brandVoiceNotes).toBeFalsy();
        expect(playgroundInput.replyStyle).toBeUndefined();
    });

    it('a settings failure never breaks the playground — it degrades to the old behaviour', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockRejectedValue(new Error('db down'));
        const { playgroundInput } = await build();
        expect(playgroundInput.brandVoiceNotes).toBeUndefined();
        expect(playgroundInput.replyStyle).toBeUndefined();
    });

    it('the owner row is still what decides comment reply mode', async () => {
        vi.mocked(settingsService.getSettings).mockResolvedValue({ commentReplyMode: 'private' } as never);
        const { commentReplyMode } = await build({ channel: 'comment' });
        expect(commentReplyMode).toBe('private');
    });
});

describe('buildPlaygroundContext — reply mode resolution (D-085)', () => {
    beforeEach(() => {
        vi.mocked(settingsService.getSettings).mockResolvedValue(OWNER_ROW as never);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(STORED as never);
    });

    it('resolves to sales by default (no page override, no workspace value)', async () => {
        const { playgroundInput } = await build();
        expect(playgroundInput.replyMode).toBe('sales');
    });

    it('the PAGE override wins over the workspace default — the harness must match production, not resolve the workspace value (Rule 19.2)', async () => {
        // A page pinned to info inside a sales workspace: production honors the
        // pin, so the playground/eval must too — a page object missing the
        // replyMode column would silently preview the wrong mode here.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ ...STORED, replyMode: 'sales' } as never);
        const { playgroundInput } = await build({ page: { ...PAGE, replyMode: 'info' } as never });
        expect(playgroundInput.replyMode).toBe('info');
    });

    it('inherits the workspace value when the page has no override', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ ...STORED, replyMode: 'info' } as never);
        const { playgroundInput } = await build();
        expect(playgroundInput.replyMode).toBe('info');
    });

    it('an explicit caller value still wins — the eval passes replyMode per case', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ ...STORED, replyMode: 'info' } as never);
        const { playgroundInput } = await build({ replyMode: 'sales' });
        expect(playgroundInput.replyMode).toBe('sales');
    });
});
