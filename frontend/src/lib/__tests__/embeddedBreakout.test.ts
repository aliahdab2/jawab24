import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openTopLevelAuthenticated } from '../embeddedBreakout';

const mockPost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { post: mockPost } }));

const mockCaptureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));

/** A stand-in for the tab `window.open` hands back. */
function makeTab() {
    return { opener: {} as unknown, location: { href: '' } };
}

describe('openTopLevelAuthenticated', () => {
    let openSpy: ReturnType<typeof vi.spyOn>;
    let topLocation: { href: string };

    beforeEach(() => {
        vi.clearAllMocks();
        mockPost.mockResolvedValue({ data: { code: 'handoff-code' } });
        openSpy = vi.spyOn(window, 'open');

        // Stand the page inside a platform frame: window.top is a DIFFERENT
        // window, exactly as it is when Zid frames us.
        topLocation = { href: 'https://dashboard.zid.sa/apps/embedded' };
        vi.spyOn(window, 'top', 'get').mockReturnValue({ location: topLocation } as unknown as Window);
    });

    afterEach(() => vi.restoreAllMocks());

    it('opens the tab SYNCHRONOUSLY, before awaiting the mint', async () => {
        const tab = makeTab();
        openSpy.mockReturnValue(tab as unknown as Window);
        let resolveMint: (v: unknown) => void = () => {};
        mockPost.mockReturnValue(new Promise((res) => { resolveMint = res; }));

        const pending = openTopLevelAuthenticated('/pages');

        // A popup opened after an `await` has lost the user gesture and is
        // blocked by default — so it must already exist at this point.
        expect(openSpy).toHaveBeenCalledWith('', 'jawab24');
        resolveMint({ data: { code: 'handoff-code' } });
        await pending;
    });

    it('severs the opener, and does NOT pass noopener', async () => {
        const tab = makeTab();
        openSpy.mockReturnValue(tab as unknown as Window);

        await openTopLevelAuthenticated('/pages');

        // `noopener` would make window.open return null, leaving nothing to
        // point at the URL — so it is severed by hand instead. The NAMED
        // target makes repeat clicks reuse one tab instead of piling up
        // duplicates.
        expect(openSpy).toHaveBeenCalledWith('', 'jawab24');
        expect(tab.opener).toBeNull();
    });

    it('points the tab at /auth/sync carrying the code and the destination', async () => {
        const tab = makeTab();
        openSpy.mockReturnValue(tab as unknown as Window);

        await openTopLevelAuthenticated('/pages');

        expect(mockPost).toHaveBeenCalledWith('/auth/browser-handoff');
        expect(tab.location.href).toBe('/auth/sync?code=handoff-code&redirect=%2Fpages');
    });

    // Mutation-checked: dropping `localePrefix` from the handoff URL fails this.
    it("carries the frame's locale into the handoff URL, so the tab opens in the merchant's language", async () => {
        const tab = makeTab();
        openSpy.mockReturnValue(tab as unknown as Window);

        await openTopLevelAuthenticated('/pages?connectFacebook=true', { locale: 'ar' });

        // Without the prefix the tab opened on the default locale and _app.tsx
        // then re-routed to the browser's persisted first-party language — an
        // Arabic merchant landed on /en/pages (2026-08-30).
        expect(tab.location.href).toBe('/ar/auth/sync?code=handoff-code&redirect=%2Fpages%3FconnectFacebook%3Dtrue');
    });

    it('when the popup is blocked, navigates the TOP window — never the frame', async () => {
        openSpy.mockReturnValue(null);
        const frameHref = window.location.href;

        await openTopLevelAuthenticated('/pages');

        // Navigating `window.location` here renders /pages back INSIDE the
        // platform iframe, where facebook.com's X-Frame-Options kills the
        // connect one screen later — the dead end this function exists to
        // remove. The frame must be left alone.
        expect(topLocation.href).toBe('/auth/sync?code=handoff-code&redirect=%2Fpages');
        expect(window.location.href).toBe(frameHref);
    });

    it('falls back to the bare destination and REPORTS when the mint fails', async () => {
        const tab = makeTab();
        openSpy.mockReturnValue(tab as unknown as Window);
        mockPost.mockRejectedValue(new Error('500'));

        await openTopLevelAuthenticated('/pages');

        // A login wall the merchant may not pass, so it is a reported failure —
        // but it beats leaving a blank tab open.
        expect(tab.location.href).toBe('/pages');
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error), 'Embedded break-out handoff failed', expect.anything(),
        );
    });

    it('reports the failure and still navigates TOP when the popup was also blocked', async () => {
        openSpy.mockReturnValue(null);
        mockPost.mockRejectedValue(new Error('500'));

        await openTopLevelAuthenticated('/pages');

        expect(topLocation.href).toBe('/pages');
        expect(mockCaptureError).toHaveBeenCalled();
    });
});
