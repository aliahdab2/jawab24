/**
 * Meta messaging referral parsing — Click-to-Messenger ads, m.me / ig.me links.
 *
 * A referral arrives in one of three documented shapes (Messenger Platform
 * webhook reference, verified against Meta's docs 2026-08-04):
 *
 *   1. standalone `messaging_referrals` event → `entry[].messaging[].referral`
 *      (m.me links and ads when the thread already exists);
 *   2. `postback.referral` — Get Started / CTA tap that opens a new thread
 *      from an ad or m.me link;
 *   3. `message.referral` — the first message a customer sends from a
 *      Click-to-Messenger ad.
 *
 * All three carry the same referral object:
 *   {
 *     ref?: string,                    // free-form param from the ad / m.me link
 *     source?: 'ADS' | 'SHORTLINK' | 'CUSTOMER_CHAT_PLUGIN' | …,
 *     type?: 'OPEN_THREAD',
 *     ad_id?: string,                  // only for ad referrals
 *     referer_uri?: string,            // only for CUSTOMER_CHAT_PLUGIN
 *     ads_context_data?: { ad_title?, photo_url?, video_url?, post_id?, product_id? }
 *   }
 *
 * Everything here is defensive: webhook payloads are untrusted input, and a
 * malformed referral must NEVER break message processing — parsers return null
 * instead of throwing, callers skip silently (debug log at the call site).
 */

/** Normalized referral extracted from a webhook messaging event. */
export interface NormalizedReferral {
    /** Meta referral source, verbatim ('ADS', 'SHORTLINK', …), or null. */
    source: string | null;
    /** Free-form `ref` campaign param, or null. */
    ref: string | null;
    /** Meta ad id when the referral came from an ad, or null. */
    adId: string | null;
    /** Whether the ad carried ads_context_data metadata (ad_title / photo_url) — diagnostic only, not stored. */
    hasAdContext: boolean;
}

function asTrimmedString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Normalize a raw `referral` object from a webhook payload. Returns null for
 * anything malformed or carrying no attribution value (no source, ref, or ad_id).
 */
export function normalizeReferral(raw: unknown): NormalizedReferral | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const source = asTrimmedString(r.source);
    const ref = asTrimmedString(r.ref);
    // Meta documents ad_id as a string; be tolerant of a numeric id anyway —
    // it's still a valid attribution key.
    const adId = asTrimmedString(r.ad_id)
        ?? (typeof r.ad_id === 'number' && Number.isFinite(r.ad_id) ? String(r.ad_id) : null);
    // A referral with none of the attribution fields is useless — skip it.
    if (!source && !ref && !adId) return null;
    const ctx = typeof r.ads_context_data === 'object' && r.ads_context_data !== null && !Array.isArray(r.ads_context_data)
        ? (r.ads_context_data as Record<string, unknown>)
        : null;
    return {
        source,
        ref,
        adId,
        hasAdContext: !!ctx && !!(asTrimmedString(ctx.ad_title) || asTrimmedString(ctx.photo_url)),
    };
}

/**
 * Pull the referral out of a messaging event, wherever Meta put it. Checks the
 * three documented locations in order: standalone event → postback → message.
 */
export function extractEventReferral(event: {
    referral?: unknown;
    postback?: { referral?: unknown } | null;
    message?: { referral?: unknown } | null;
}): NormalizedReferral | null {
    return normalizeReferral(event.referral)
        ?? normalizeReferral(event.postback?.referral)
        ?? normalizeReferral(event.message?.referral);
}
