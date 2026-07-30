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
    nonce: string;
    /** Epoch ms. Same 10-minute window as the nonce cookie. */
    exp: number;
}

export const WHATSAPP_STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string): Buffer {
    // Domain-separated so this HMAC can never be confused with other
    // jwt-secret-keyed tokens (e.g. unsubscribe tokens in utils/tokens.ts).
    return createHmac('sha256', config.jwt.secret).update(`wa-connect:${payload}`).digest();
}

export function mintWhatsAppConnectState(
    input: Pick<WhatsAppConnectState, 'userId' | 'workspaceId' | 'pageId' | 'coexistence' | 'locale'>,
): { state: string; nonce: string } {
    const nonce = randomBytes(16).toString('hex');
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
