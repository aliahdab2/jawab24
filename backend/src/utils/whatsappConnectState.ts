import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config';

/**
 * Signed OAuth `state` for the WhatsApp redirect connect flow.
 *
 * The callback that receives this is a PUBLIC route hit by a top-level 302 from
 * facebook.com — no Authorization header, no X-Workspace-Id. Everything the
 * callback needs to act (who, which workspace, which card, which onboarding
 * path) must therefore ride in `state`, and none of it can be trusted unless
 * it is tamper-proof. HMAC over the payload with the JWT secret makes the
 * state self-authenticating; the nonce is ALSO stored in a signed cookie and
 * matched on return (double-submit), so a state minted for one browser cannot
 * be replayed from another.
 *
 * Carries IDs only — never tokens. The payload travels through Meta's URLs
 * and browser history in plaintext (base64url is encoding, not encryption).
 */
export interface WhatsAppConnectState {
    userId: string;
    workspaceId: string;
    /** Page card to attach to, or null → create a WhatsApp-only card. */
    pageId: string | null;
    /** The onboarding path REQUESTED (Meta's outcome still wins at connect time). */
    coexistence: boolean;
    /** Return-redirect locale. Constrained to known locales — it becomes part of a 302 target. */
    locale: 'ar' | 'en';
    /**
     * Minted for the NATIVE app, which opens the dialog in a Capacitor Browser
     * tab (mirroring the proven Facebook page-connect flow). Two consequences
     * at callback time, both keyed off this signed flag so a web state can
     * never claim them:
     *  - the nonce cookie is NOT checked: `start` sets it in the app WebView's
     *    cookie jar while the callback arrives in the BROWSER's jar, so the
     *    double-submit pair cannot exist. The HMAC state (unforgeable, TTL'd,
     *    carrying the ids) plus the live ownership re-verify remain — exactly
     *    the trade the shipped Facebook mobile flow already makes.
     *  - the return leg is the /auth/app-sync App Link instead of a web page,
     *    so Android reopens the app and closes the browser tab.
     */
    app?: boolean;
    nonce: string;
    /** Epoch ms. Same 10-minute window as the nonce cookie. */
    exp: number;
}

/**
 * 30 minutes — the state is verified at CALLBACK time, i.e. AFTER the merchant
 * walks Meta's whole wizard (business creation, number, OTP…). The popup flow's
 * abandonment sweep learned this the hard way: 10 minutes is SHORTER than a
 * real first-time signup, and expiring mid-wizard throws away completed work.
 */
export const WHATSAPP_STATE_TTL_MS = 30 * 60 * 1000;

function sign(payload: string): Buffer {
    // Domain-separated so this HMAC can never be confused with other
    // jwt-secret-keyed tokens (e.g. unsubscribe tokens in utils/tokens.ts).
    return createHmac('sha256', config.jwt.secret).update(`wa-connect:${payload}`).digest();
}

/**
 * @param sharedNonce Pass to mint SIBLING states bound to one nonce cookie —
 * the path-question modal pre-mints both onboarding variants at open time so
 * the chosen one can be navigated to synchronously with the tap, and a single
 * cookie slot must validate whichever the merchant picks.
 */
export function mintWhatsAppConnectState(
    input: Pick<WhatsAppConnectState, 'userId' | 'workspaceId' | 'pageId' | 'coexistence' | 'locale'> & Pick<Partial<WhatsAppConnectState>, 'app'>,
    sharedNonce?: string,
): { state: string; nonce: string } {
    const nonce = sharedNonce ?? randomBytes(16).toString('hex');
    const full: WhatsAppConnectState = { ...input, nonce, exp: Date.now() + WHATSAPP_STATE_TTL_MS };
    const payload = Buffer.from(JSON.stringify(full)).toString('base64url');
    return { state: `${payload}.${sign(payload).toString('base64url')}`, nonce };
}

/** Returns the verified payload, or null for ANY defect (bad shape, bad signature, expired). */
export function verifyWhatsAppConnectState(state: string): WhatsAppConnectState | null {
    const dot = state.lastIndexOf('.');
    if (dot <= 0) return null;
    const payload = state.slice(0, dot);
    let given: Buffer;
    try {
        given = Buffer.from(state.slice(dot + 1), 'base64url');
    } catch {
        return null;
    }
    const expected = sign(payload);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    const s = parsed as Partial<WhatsAppConnectState>;
    if (
        typeof s.userId !== 'string' || !s.userId
        || typeof s.workspaceId !== 'string' || !s.workspaceId
        || (s.pageId !== null && typeof s.pageId !== 'string')
        || typeof s.coexistence !== 'boolean'
        || (s.locale !== 'ar' && s.locale !== 'en')
        || typeof s.nonce !== 'string' || !s.nonce
        || typeof s.exp !== 'number'
    ) return null;
    if (Date.now() > s.exp) return null;
    return s as WhatsAppConnectState;
}
