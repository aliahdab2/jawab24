import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * Call-site regression for the pre-launch review's frontend M3 finding: the
 * "My Pages" → "Channels" nav rename used `isWhatsAppEnabled()` instead of the
 * canary-aware `isWhatsAppVisible(isAdmin)`, leaking the rename to every user
 * during the admin-only pilot window. `resolveNavKey` is shared by the desktop
 * sidebar and the mobile nav, so pinning it covers both surfaces.
 *
 * Sidebar's heavy module-scope deps are mocked out — only the pure
 * `resolveNavKey` export is under test. `featureFlags` stays REAL so the test
 * exercises the actual flag logic via `vi.stubEnv`.
 */

vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), asPath: '/' }) }));
vi.mock('@/lib/store', () => ({ useAuthStore: vi.fn(), useUIStore: vi.fn() }));
vi.mock('@/hooks', () => ({ useWorkspaceRole: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/features/demo', () => ({ useIsDemoUser: vi.fn() }));
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false }));
vi.mock('@/components/ui', () => ({
    BrandLogo: () => null,
    NotificationBell: () => null,
    ThemeToggleButton: () => null,
}));

import { resolveNavKey, getNavigationGroups } from '../Sidebar';

const tNav = (k: string) => `nav:${k}`;
const tPricing = (k: string) => `pricing:${k}`;

const enableWhatsApp = () => {
    vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123456');
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-abc');
};

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('resolveNavKey — nav.pages rename is canary-aware', () => {
    it('dark deploy (no config id): "Pages" for everyone, admins included', () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        expect(resolveNavKey('nav.pages', tNav, tPricing, true)).toBe('nav:pages');
        expect(resolveNavKey('nav.pages', tNav, tPricing, false)).toBe('nav:pages');
    });

    it('canary window: "Channels" for admins, "Pages" for regular users (M3 regression)', () => {
        enableWhatsApp();
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true');
        expect(resolveNavKey('nav.pages', tNav, tPricing, true)).toBe('nav:channels');
        expect(resolveNavKey('nav.pages', tNav, tPricing, false)).toBe('nav:pages');
    });

    it('full launch (canary cleared): "Channels" for everyone', () => {
        enableWhatsApp();
        expect(resolveNavKey('nav.pages', tNav, tPricing, false)).toBe('nav:channels');
    });
});

describe('resolveNavKey — other keys unaffected', () => {
    it('resolves nav.* / pricing.* prefixes and passes unknown keys through', () => {
        expect(resolveNavKey('nav.settings', tNav, tPricing, false)).toBe('nav:settings');
        expect(resolveNavKey('pricing.title', tNav, tPricing, false)).toBe('pricing:title');
        expect(resolveNavKey('other', tNav, tPricing, false)).toBe('other');
    });
});

/**
 * The Partner entry is the ONLY way a reseller reaches /partner: the page has
 * no other link, and the app WebView has no address bar, so a missing entry
 * means the portal is unreachable on mobile entirely.
 */
describe('getNavigationGroups — Partner entry', () => {
    const hrefs = (options: Parameters<typeof getNavigationGroups>[0]) =>
        getNavigationGroups(options).flatMap((g) => g.items.map((i) => i.href));

    it('is hidden from an ordinary merchant', () => {
        expect(hrefs({ isPartner: false })).not.toContain('/partner');
        // Absent option, not merely false — the flag arrives undefined on a
        // session persisted before this shipped.
        expect(hrefs({})).not.toContain('/partner');
    });

    it('is shown to a partner', () => {
        expect(hrefs({ isPartner: true })).toContain('/partner');
    });

    it('reaches the native app too — the reseller has no browser bar there', () => {
        expect(hrefs({ isPartner: true, isNative: true })).toContain('/partner');
    });

    it('does not depend on admin or workspace-role privileges', () => {
        // Ahmad is a rep, not a Jawab24 admin, and often only a member of the
        // workspace he signed up with. Gating on either would hide the portal.
        expect(hrefs({ isPartner: true, isAdmin: false, canManageTeam: false }))
            .toContain('/partner');
    });

    it('resolves its label through the nav namespace', () => {
        const item = getNavigationGroups({ isPartner: true })
            .flatMap((g) => g.items)
            .find((i) => i.href === '/partner');
        expect(item).toBeDefined();
        expect(resolveNavKey(item!.key, tNav, tPricing, false)).toBe('nav:partner');
    });
});
