import { api } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

/**
 * True when this window is rendered inside another document — a platform
 * dashboard frame. The REAL condition for "can this tab reach facebook.com",
 * as opposed to the embedded-session flag in sessionStorage, which browsers
 * without storage partitioning clone into a tab opened via `window.open` (the
 * break-out tab itself).
 */
export function isFramed(): boolean {
    return typeof window !== 'undefined' && window.self !== window.top;
}

/**
 * Open a path as a NEW top-level browser tab, escaping the platform iframe —
 * with the merchant's session carried across.
 *
 * Connecting a Facebook page needs the full first-party app: facebook.com sends
 * `X-Frame-Options: DENY`, so the OAuth dialog cannot render inside the platform
 * frame. Breaking out is therefore unavoidable.
 *
 * What is NOT acceptable is where the merchant lands. An embedded session lives
 * as a Bearer token in the frame's `sessionStorage`, never as a cookie, so a
 * plain `window.open('/pages')` opens a tab with no session — and an
 * auto-provisioned merchant has no password, no linked Facebook account and no
 * phone, so the login page it lands on is a DEAD END. That is the same
 * "sign-in prompt" defect Zid rejected app 7367 for, moved one screen later.
 *
 * So: mint a single-use handoff code first and land on `/auth/sync`, which
 * trades it for a real browser session. The code carries the embedded SCOPE
 * (backend: `mintBrowserHandoffCode`), so the tab is still pinned to this
 * workspace and still admin-stripped — a break-out, not an escalation. Ruling
 * D-067.
 *
 * Lives in `lib/` rather than inside the page because it is a session-bridging
 * concern with three browser traps encoded in it, and because a page-private
 * function cannot be tested — the popup-blocked branch below silently undoes the
 * whole feature and has to stay pinned.
 *
 * @param path in-app destination, e.g. `/pages`
 */
export async function openTopLevelAuthenticated(path: string): Promise<void> {
    if (typeof window === 'undefined') return;

    // Opened SYNCHRONOUSLY inside the click handler: a popup opened after an
    // `await` has lost the user gesture and is blocked by default. `noopener` is
    // not passed because it makes window.open return null, leaving nothing to
    // point at the URL — the opener is severed manually instead.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;

    const go = (url: string) => {
        if (tab) {
            tab.location.href = url;
            return;
        }
        // Popup blocked (or the frame is sandboxed without allow-popups).
        // Navigate the TOP window, not `window.location` — inside the platform
        // frame that navigates the FRAME, which renders /pages back inside the
        // iframe and hits facebook.com's X-Frame-Options one screen later: the
        // dead end this whole function exists to remove. Assigning
        // `top.location.href` cross-origin is permitted, and we are inside a
        // click handler so top-navigation is allowed.
        (window.top ?? window).location.href = url;
    };

    try {
        const { data } = await api.post<{ code: string }>('/auth/browser-handoff');
        go(`/auth/sync?code=${encodeURIComponent(data.code)}&redirect=${encodeURIComponent(path)}`);
    } catch (err) {
        captureError(err, 'Embedded break-out handoff failed', { tags: { context: 'embedded-breakout' } });
        // Last resort: the destination without a session. It shows a login wall
        // the merchant may not be able to pass, so it is a reported failure, not
        // a path we are happy with — but it beats leaving a blank tab open.
        go(path);
    }
}
