import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    isWhatsAppEnabled,
    isWhatsAppVisible,
    isWhatsAppMarketable,
    usesChannelWording,
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

/**
 * The one policy point behind «صفحات» ⇄ «قنوات التواصل» on the nav item, the
 * /pages screen, and the /business empty states. It exists because those three
 * screens each branched on `isWhatsAppVisible` independently, which went stale
 * the day Instagram-direct shipped: a merchant who can connect an Instagram
 * account without a Facebook Page was still being told the screen holds "Pages".
 *
 * Each caller must keep reading THIS function — a screen that reverts to its
 * own flag drifts out of step with the button that navigates to it.
 */
describe('usesChannelWording (صفحات ⇄ قنوات)', () => {
    it('is false when Facebook Pages are the only channel', () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED', '');
        expect(usesChannelWording(false)).toBe(false);
        expect(usesChannelWording(true)).toBe(false);
    });

    it('is true on WhatsApp alone, honouring the admin-only canary', () => {
        enableWhatsApp();
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true');
        vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED', '');
        expect(usesChannelWording(true)).toBe(true);
        expect(usesChannelWording(false)).toBe(false);
    });

    it('is true on Instagram-direct alone, for every user', () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED', 'true');
        expect(usesChannelWording(false)).toBe(true);
        expect(usesChannelWording(true)).toBe(true);
    });

    it('does not let the WhatsApp canary suppress the Instagram-direct rename', () => {
        enableWhatsApp();
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true');
        vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED', 'true');
        expect(usesChannelWording(false)).toBe(true);
    });
});
