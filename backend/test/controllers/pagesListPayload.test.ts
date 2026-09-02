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
     * The profile is dropped, so the list must answer the ONE question its
     * consumer has about it: can info mode route a customer anywhere? Gated by
     * `isFieldAuthoritative` exactly as `formatBusinessInfoPrompt` gates the
     * Phones line — an unconfirmed Facebook number is NOT a channel, because the
     * prompt will not publish it. Measured on prod 2026-08-20: that distinction
     * is the difference between 17 pages and 7.
     */
    it('replaces the profile with a hasContactChannel boolean', () => {
        // No phones, no WhatsApp → nothing to route to.
        expect((serializeListPage(makeRow()) as Record<string, unknown>).hasContactChannel).toBe(false);

        // A merchant-typed phone → routable.
        const typed = serializeListPage(makeRow({
            businessProfile: { merchant: { phones: [{ number: '0111222333' }] } },
        })) as Record<string, unknown>;
        expect(typed.hasContactChannel).toBe(true);

        // The same number, but synced from Facebook and never confirmed. The
        // prompt omits it, so the card must not promise it either — this is the
        // case that made 10 of 17 prod pages fail the predicate.
        const fbSynced = serializeListPage(makeRow({
            businessProfile: {
                merchant: { phones: [{ number: '0111222333' }] },
                merchantProvenance: { phones: { source: 'fb_sync' } },
            },
        })) as Record<string, unknown>;
        expect(fbSynced.hasContactChannel).toBe(false);

        // WhatsApp alone is a channel too.
        const wa = serializeListPage(makeRow({
            businessProfile: { merchant: { channels: { whatsapp: ['0999888777'] } } },
        })) as Record<string, unknown>;
        expect(wa.hasContactChannel).toBe(true);

        // A row with no profile at all must not throw.
        expect((serializeListPage(makeRow({ businessProfile: null })) as Record<string, unknown>)
            .hasContactChannel).toBe(false);

        // Email is a channel INFO-DESK routes to (the prompt publishes it beside
        // WhatsApp), so a page whose only contact is an email must not be told it
        // has none.
        const emailOnly = serializeListPage(makeRow({
            businessProfile: { merchant: { email: 'hi@shop.com' } },
        })) as Record<string, unknown>;
        expect(emailOnly.hasContactChannel).toBe(true);
    });

    /**
     * ⚠️ SHARED-INFRA GUARD. `business_profile` is schemaless jsonb with four
     * writers, and since D-087 this serializer looks INSIDE it on every
     * pages-list request. A value that makes the predicate throw does not cost
     * one page its warning — it 500s `GET /pages` for the whole workspace, which
     * is the dashboard, settings, the inbox pickers and the leads picker at once.
     * Prod on 2026-08-20 held 0 such rows across all 134; "unreached" is not
     * "impossible".
     */
    it('survives every malformed profile shape the column can hold', () => {
        const shapes: unknown[] = [
            { merchant: { phones: '0911000210' } },   // a bare STRING — used to throw on .map
            { merchant: { phones: 42 } },
            { merchant: { phones: { number: '09' } } },
            { merchant: { phone: 42 } },
            { merchant: { channels: 'whatsapp' } },
            { merchant: 'text' },
            { merchantProvenance: 'text' },
            'text',
            42,
            [],
        ];
        for (const businessProfile of shapes) {
            expect(() => serializeListPage(makeRow({ businessProfile }))).not.toThrow();
            expect((serializeListPage(makeRow({ businessProfile })) as Record<string, unknown>)
                .hasContactChannel).toBe(false);
        }
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
            'hasContactChannel',
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

    it('derives whatsappNeedsReconnect from the reason column — the ONE shared rule', () => {
        // Executes the REAL predicate (services/pages.ts whatsappNeedsReconnect):
        // every controller suite stubs the module factory, so this is the unit
        // suite that keeps the production one-liner itself honest. The severed
        // state means "reason recorded, token kept" (Z net, 2026-09-01) — the
        // value must track the reason, never token presence.
        const severed = serializeListPage(makeRow({
            whatsappAccessToken: 'wa-token',
            whatsappDisconnectReason: 'app_uninstalled',
        })) as Record<string, unknown>;
        expect(severed.whatsappNeedsReconnect).toBe(true);

        const healthy = serializeListPage(makeRow({ whatsappAccessToken: 'wa-token' })) as Record<string, unknown>;
        expect(healthy.whatsappNeedsReconnect).toBe(false);
    });
});
