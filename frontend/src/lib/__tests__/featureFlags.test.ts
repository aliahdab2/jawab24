import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    isWhatsAppEnabled,
    isWhatsAppVisible,
    isWhatsAppMarketable,
} from '../featureFlags';

/**
 * Canary-window matrix for the WhatsApp feature flags.
 *
 * Regression context (pre-launch review, frontend M3): several call sites used
 * `isWhatsAppEnabled()` where `isWhatsAppVisible(isAdmin)` was required, so the
 * admin-only pilot window (NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY=true) leaked
 * the WhatsApp surface (nav rename, channel badges, dashboard headings) to
 * every user. These tests pin the intended visibility semantics of each tier.
 *
 * The flag functions re-read process.env on every call (deliberate, for tests)
 * so `vi.stubEnv` is enough — no module reset needed.
 */

const enableWhatsApp = () => {
    vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123456');
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-abc');
};

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('isWhatsAppEnabled', () => {
    it('is false while the config id is unset (dark deploy)', () => {
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123456');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        expect(isWhatsAppEnabled()).toBe(false);
    });

    it('is true once FB app id + config id are both set', () => {
        enableWhatsApp();
        expect(isWhatsAppEnabled()).toBe(true);
    });
});

describe('isWhatsAppVisible (canary window)', () => {
    it('hides from everyone while dark, regardless of admin', () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        expect(isWhatsAppVisible(true)).toBe(false);
        expect(isWhatsAppVisible(false)).toBe(false);
    });

    it('during canary: visible to admins ONLY', () => {
        enableWhatsApp();
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true');
        expect(isWhatsAppVisible(true)).toBe(true);
        // The M3 regression: a non-admin must see ZERO WhatsApp UI in canary.
        expect(isWhatsAppVisible(false)).toBe(false);
    });

    it('after full launch (canary flag cleared): visible to everyone', () => {
        enableWhatsApp();
        expect(isWhatsAppVisible(false)).toBe(true);
        expect(isWhatsAppVisible(true)).toBe(true);
    });
});

describe('isWhatsAppMarketable (public marketing surfaces)', () => {
    it('stays off during the canary window even though the config is live', () => {
        enableWhatsApp();
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true');
        expect(isWhatsAppMarketable()).toBe(false);
    });

    it('turns on at full launch', () => {
        enableWhatsApp();
        expect(isWhatsAppMarketable()).toBe(true);
    });
});
