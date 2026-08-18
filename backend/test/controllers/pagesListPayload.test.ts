import { describe, it, expect } from 'vitest';
import { serializeListPage } from '../../src/controllers/pages';

/**
 * The `GET /pages` wire contract.
 *
 * This endpoint is read by nine merchant surfaces, so its payload is paid
 * repeatedly on every screen. Measured across 132 production pages,
 * `knowledge_base` + `suggested_knowledge_base` were 48% of the response bytes
 * and `business_profile` a further 18% — while the only list-side readers of that
 * text just asked "is it filled?".
 *
 * These tests pin BOTH directions of the trim, because each has a silent failure
 * mode: shipping the text again is invisible (just slow), and dropping a field the
 * settings screen needs blanks its override markers with no error.
 */

/** A row shaped like `pages` + the derived fields `getPages` adds. */
function makeRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'page-1',
        name: 'Test Page',
        facebookPageId: '12345',
        accessToken: 'plaintext-fb-token',
        whatsappAccessToken: null,
        instagramAccessToken: null,
        whatsappDisconnectReason: null,
        knowledgeBase: 'x'.repeat(500),
        suggestedKnowledgeBase: 'auto-synced from facebook',
        businessProfile: { merchant: { hours: 'daily' } },
        replyMode: 'info',
        brandVoiceNotesMulti: { ar: 'نبرة ودّية' },
        leadStages: null,
        leadFields: null,
        ecommerceStoreId: null,
        ...overrides,
    };
}

describe('serializeListPage — GET /pages payload', () => {
    it('omits the fat business-info fields', () => {
        const out = serializeListPage(makeRow()) as Record<string, unknown>;

        expect(out).not.toHaveProperty('knowledgeBase');
        expect(out).not.toHaveProperty('suggestedKnowledgeBase');
        expect(out).not.toHaveProperty('businessProfile');
    });

    it('replaces the text with a kbFilled boolean', () => {
        const filled = serializeListPage(makeRow()) as Record<string, unknown>;
        expect(filled.kbFilled).toBe(true);

        // Text identical to the Facebook auto-sync snapshot is NOT merchant-provided
        // info — the same rule the setup checklist applies (isBusinessInfoProvided).
        const autoOnly = serializeListPage(makeRow({
            knowledgeBase: 'auto-synced from facebook',
            suggestedKnowledgeBase: 'auto-synced from facebook',
        })) as Record<string, unknown>;
        expect(autoOnly.kbFilled).toBe(false);

        // Too short to be usable info.
        const tooShort = serializeListPage(makeRow({
            knowledgeBase: 'hi', suggestedKnowledgeBase: null,
        })) as Record<string, unknown>;
        expect(tooShort.kbFilled).toBe(false);
    });

    /**
     * ⚠️ The highest-risk regression in this change. `ReplyStyleCard` reads
     * `p.replyMode` and `p.brandVoiceNotesMulti` off EVERY page in the list to
     * render its per-page override markers. Dropping either one blanks those
     * markers with no error and no warning — nothing else would catch it.
     */
    it('still carries the per-page fields the settings screen reads', () => {
        const out = serializeListPage(makeRow()) as Record<string, unknown>;

        expect(out.replyMode).toBe('info');
        expect(out.brandVoiceNotesMulti).toEqual({ ar: 'نبرة ودّية' });
        expect(out.id).toBe('page-1');
        expect(out.name).toBe('Test Page');
        // Derived by serializePage from the token it then strips.
        expect(out.isConnected).toBe(true);
    });

    it('still strips every credential, as serializePage does', () => {
        const out = serializeListPage(makeRow()) as Record<string, unknown>;

        expect(out).not.toHaveProperty('accessToken');
        expect(out).not.toHaveProperty('whatsappAccessToken');
        expect(out).not.toHaveProperty('instagramAccessToken');
    });

    /**
     * Growth guard. `pagesService.getPages` selects the whole row, so a new column
     * on `pages` joins this response by itself — no code change, no review. That is
     * how an Instagram access token (0169), a jsonb blob (0171) and reply_mode
     * (0172) all arrived unnoticed.
     *
     * When this fails, decide deliberately: a field the LIST needs goes in the
     * expected set below; a fat one gets destructured out in serializeListPage.
     */
    it('pins the key set so a new column cannot join silently', () => {
        const out = serializeListPage(makeRow()) as Record<string, unknown>;

        expect(Object.keys(out).sort()).toEqual([
            'brandVoiceNotesMulti',
            'ecommerceStoreId',
            'facebookPageId',
            'id',
            'instagramDirect',
            'instagramDirectConnected',
            'isConnected',
            'kbFilled',
            'leadFields',
            'leadStages',
            'name',
            'replyMode',
            'whatsappConnected',
            'whatsappDisconnectReason',
            'whatsappNeedsReconnect',
        ]);
    });
});
