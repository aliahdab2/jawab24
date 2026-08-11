/**
 * The playground must preview EXACTLY what production would send — Rule 19.2.
 *
 * `buildPlaygroundContext` (the merchant test reply «اختبار الرد الذكي», the admin
 * playground, the eval harness and the cache-warm job) and `enrichPageContext` (the
 * production reply path) resolve the merchant's persona independently. If they ever
 * disagree, the merchant is shown a reply their customers would never receive, the eval
 * grades a prompt production never sends, and the warm job writes reply-cache entries
 * under a `bv:` key segment production never resolves.
 *
 * These run against a REAL Postgres so they exercise the actual settings stores, the
 * actual drift-heal, and the actual defaults — the layers that unit mocks paper over.
 *
 * Production feeds `enrichPageContext` the settings of the PAGE'S OWN workspace
 * (`commentProcessor.ts` / `messageProcessor.ts` both call
 * `workspaceSettingsService.getSettings(page.workspaceId)` and refuse a page without a
 * workspace), so these tests call it the same way. The assertion is parity between the
 * two functions — a stronger and more durable claim than "unchanged from before".
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestUser, createTestWorkspace, createTestPage } from './setup';
import { buildPlaygroundContext } from '../../src/services/reply/playgroundContext';
import { enrichPageContext } from '../../src/services/reply/contextEnricher';
import { settingsService } from '../../src/services/settings';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';

// Silence Redis — these tests are about the DB-backed resolution, not caching.
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        scan: vi.fn().mockResolvedValue(['0', []]),
    },
}));

const AR_PERSONA = 'الاسم: سارة. اطلبي اسم الزبون ورقم واتساب لإتمام الطلب.';
const EN_PERSONA = 'Name: Sara. Always ask for the customer name and WhatsApp number.';

/** What production resolves for this page and message. */
async function productionPersona(page: Record<string, unknown>, message: string) {
    const wsSettings = await workspaceSettingsService.getSettings(page.workspaceId as string);
    const enriched = await enrichPageContext(page, wsSettings, message, undefined);
    return { brandVoiceNotes: enriched.brandVoiceNotes, replyStyle: wsSettings.replyStyle };
}

/** What the merchant is shown — the customer-facing test reply passes no persona. */
async function playgroundPersona(page: Record<string, unknown>, message: string) {
    const { playgroundInput } = await buildPlaygroundContext({
        page: page as never,
        question: message,
        channel: 'dm',
    });
    return {
        brandVoiceNotes: playgroundInput.brandVoiceNotes,
        replyStyle: playgroundInput.replyStyle,
    };
}

describe('Playground ↔ production parity — the merchant persona', () => {
    it('a merchant who saved a persona the normal way: preview == production', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: ws.id });
        settingsService.clearWorkspaceIdCache();

        // Saved exactly as the settings UI saves it (legacy row + pipeline sync).
        await settingsService.updateSettings(user.id, {
            brandVoiceNotesMulti: { ar: AR_PERSONA, en: EN_PERSONA },
            replyStyle: 'casual',
        } as never, ws.id);

        expect(await playgroundPersona(page, 'كم السعر؟'))
            .toEqual(await productionPersona(page, 'كم السعر؟'));
    });

    it('the language variant matches production too (English question → English persona)', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: ws.id });
        settingsService.clearWorkspaceIdCache();

        await settingsService.updateSettings(user.id, {
            brandVoiceNotesMulti: { ar: AR_PERSONA, en: EN_PERSONA },
        } as never, ws.id);

        const preview = await playgroundPersona(page, 'what is the price?');
        expect(preview).toEqual(await productionPersona(page, 'what is the price?'));
        expect(preview.brandVoiceNotes).toBe(EN_PERSONA);
    });

    it('a merchant with NO persona saved: both resolve nothing, and the default tone', async () => {
        // The eval/demo fixture shape — DEMO_SETTINGS sets no persona and no replyStyle,
        // so this pins that the two stores' defaults agree (they do: '' / {} / professional).
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: ws.id });
        settingsService.clearWorkspaceIdCache();

        const preview = await playgroundPersona(page, 'كم السعر؟');
        expect(preview).toEqual(await productionPersona(page, 'كم السعر؟'));
        expect(preview.brandVoiceNotes).toBeUndefined();
        expect(preview.replyStyle).toBe('professional');
    });

    it('a workspace never written through the settings UI: parity holds via the drift-heal', async () => {
        // The JSONB is empty here, so `getSettings` heals it from the owner's legacy row.
        // Both paths read that same healed object, so they must still agree.
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: ws.id });
        settingsService.clearWorkspaceIdCache();

        expect(await playgroundPersona(page, 'كم السعر؟'))
            .toEqual(await productionPersona(page, 'كم السعر؟'));
    });

    it('MULTI-WORKSPACE: the preview follows the PAGE\'s workspace, as production does', async () => {
        // The regression this whole change exists for. The page lives in wsB; the owner's
        // other workspace wsA carries a different persona. `resolveWorkspaceId` could pick
        // either — production always picks the page's, so the preview must too.
        const user = await createTestUser();
        const wsA = await createTestWorkspace(user.id, { name: 'Other workspace' });
        const wsB = await createTestWorkspace(user.id, { name: 'This page\'s workspace' });
        const page = await createTestPage(user.id, { workspaceId: wsB.id });
        settingsService.clearWorkspaceIdCache();

        await workspaceSettingsService.updateSettings(wsA.id, {
            brandVoiceNotesMulti: { ar: 'الاسم: رنيم — مساحة عمل أخرى تماماً.' },
            replyStyle: 'enthusiastic',
        } as never);
        await workspaceSettingsService.updateSettings(wsB.id, {
            brandVoiceNotesMulti: { ar: AR_PERSONA },
            replyStyle: 'casual',
        } as never);

        const preview = await playgroundPersona(page, 'كم السعر؟');
        expect(preview).toEqual(await productionPersona(page, 'كم السعر؟'));
        expect(preview.brandVoiceNotes).toBe(AR_PERSONA);
        expect(preview.replyStyle).toBe('casual');
    });
});
