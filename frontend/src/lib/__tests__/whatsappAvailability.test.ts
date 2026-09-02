import { describe, it, expect, afterEach, vi } from 'vitest';
import type { UsageSummary } from '@jawab24/shared';
import {
    isWhatsAppConnectable,
    isWhatsAppBlockedForMarketplace,
    isWhatsAppMarketableFor,
} from '../whatsappAvailability';

// Minimal usage shape — only the fields isWhatsAppConnectable reads.
const usage = (whatsappUnavailable?: { reason: 'zid_marketplace' }): UsageSummary =>
    ({ subscription: { whatsappUnavailable } } as unknown as UsageSummary);

describe('isWhatsAppConnectable', () => {
    it('is false when the WhatsApp feature is not visible, regardless of usage', () => {
        expect(isWhatsAppConnectable(false, undefined)).toBe(false);
        expect(isWhatsAppConnectable(false, usage())).toBe(false);
    });

    it('is undefined while usage is still loading (so actionable surfaces render nothing yet)', () => {
        // Mutation: return `false` instead of `undefined` here and the /pages
        // "no flash" contract breaks — the row would hide during load for
        // everyone. The `=== undefined` branch is load-bearing.
        expect(isWhatsAppConnectable(true, undefined)).toBeUndefined();
    });

    it('is true when visible and the account has no Zid block', () => {
        expect(isWhatsAppConnectable(true, usage())).toBe(true);
    });

    it('is false when visible but the account is a Zid store (D-117)', () => {
        // Mutation: drop the `!usage?.subscription?.whatsappUnavailable` read and
        // this returns true — a Zid merchant would be offered WhatsApp.
        expect(isWhatsAppConnectable(true, usage({ reason: 'zid_marketplace' }))).toBe(false);
    });

    it('with null usage (no block field present) resolves to available — only `undefined` is the loading sentinel; the backend is the real gate', () => {
        expect(isWhatsAppConnectable(true, null)).toBe(true);
    });
});

describe('isWhatsAppBlockedForMarketplace', () => {
    it('is true only for a Zid-blocked account (D-117 copy swap)', () => {
        // Mutation: invert or drop the read and either every merchant loses the
        // WhatsApp copy, or Zid merchants keep seeing it — both wrong.
        expect(isWhatsAppBlockedForMarketplace(usage({ reason: 'zid_marketplace' }))).toBe(true);
        expect(isWhatsAppBlockedForMarketplace(usage())).toBe(false);
    });

    it('is false while usage loads and for null usage — copy is passive, default text is acceptable', () => {
        expect(isWhatsAppBlockedForMarketplace(undefined)).toBe(false);
        expect(isWhatsAppBlockedForMarketplace(null)).toBe(false);
    });
});

describe('isWhatsAppMarketableFor (marketing surfaces: /pricing, /pricing/scale, checkout)', () => {
    // The env flags re-read process.env on every call, so vi.stubEnv suffices.
    const publiclyLaunched = () => {
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123456');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-abc');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', '');
    };

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is true after public launch for an account with no Zid block', () => {
        publiclyLaunched();
        expect(isWhatsAppMarketableFor(usage())).toBe(true);
    });

    it('is false for a Zid-connected account even after public launch (D-117)', () => {
        // Mutation: drop the isWhatsAppBlockedForMarketplace read and this
        // returns true — the plan cards would again advertise WhatsApp to a
        // Zid merchant (the /pricing/scale regression, 2026-09-02).
        publiclyLaunched();
        expect(isWhatsAppMarketableFor(usage({ reason: 'zid_marketplace' }))).toBe(false);
    });

    it('is false while WhatsApp is dark or canary-gated, regardless of usage', () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        expect(isWhatsAppMarketableFor(usage())).toBe(false);

        publiclyLaunched();
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true');
        expect(isWhatsAppMarketableFor(usage())).toBe(false);
    });

    it('defaults to shown while usage loads (passive copy — never gate an action on this)', () => {
        publiclyLaunched();
        expect(isWhatsAppMarketableFor(undefined)).toBe(true);
        expect(isWhatsAppMarketableFor(null)).toBe(true);
    });
});
