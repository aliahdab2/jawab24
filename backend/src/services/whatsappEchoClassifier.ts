/**
 * WhatsApp Coexistence — did the merchant's PHONE send this echo, or the
 * merchant's APP?
 *
 * On a Coexistence number Meta echoes every message the WhatsApp Business app
 * sends via `smb_message_echoes` — a reply the merchant typed AND the app's own
 * automations (greeting message, away message). The payload carries no author
 * field (`from, to, id, timestamp, type, <type>` — verified against Meta's
 * `smb_message_echoes` reference and the Coexistence onboarding page,
 * 2026-08-29), so authorship has to be inferred here.
 *
 * Why it matters: a human reply MUST arm the handoff pause (that is the point of
 * Coexistence — the merchant jumps in, the AI stands down), but the app's
 * greeting must NOT — read as a handoff it silenced Jawab24 for the whole pause
 * window in every conversation of the first real Coexistence merchant (D-109).
 *
 * The rule is WhatsApp's own definition of its greeting — "sent automatically
 * when a customer messages you for the first time or after 14 days of no
 * activity" — measured against production (2026-08-29):
 *   - every app-greeting echo seen so far arrived 1–4 s after the customer's inbound;
 *   - across 729 human inbox replies in 90 days, none answered a conversation
 *     opener in under 10 s (fastest 10–30 s); every human reply under 10 s was
 *     inside an already-active thread.
 * So: fast + the thread was idle ⇒ the app. Anything else ⇒ a human. The cheaper
 * failure is deliberately on the human side: a misread human reply costs one
 * double reply; a misread greeting costs a pause window of silence.
 *
 * Pure function — the two inputs come from `messagesService.getInboundRecency`.
 * Time is OUR clock on both sides (inbound `created_at` vs echo receipt); Meta's
 * echo `timestamp` is never mixed in.
 */

/** Echo within this many ms of the customer's inbound ⇒ candidate automation. */
export const APP_AUTO_WINDOW_MS = 10_000;
/** WhatsApp re-sends the greeting after this much inactivity — the thread-idle bound. */
export const APP_AUTO_INACTIVITY_DAYS = 14;
/**
 * The inbound row is written by the reply worker, not the webhook, so an echo
 * can land before the row exists. One bounded re-read after this delay covers
 * ordinary queue lag; the outcome is logged either way so the miss rate is
 * measurable in production.
 */
export const ECHO_RECENCY_RETRY_MS = 2_000;

export type EchoAuthorship = 'app_auto' | 'manual';

export interface EchoClassificationInput {
    /**
     * Echo receipt time minus the customer's latest inbound `created_at`, ms.
     * `null` when no inbound row exists for this customer.
     */
    msSinceLastInbound: number | null;
    /** The customer had written in during (now − 14 d, now − window] — an active thread. */
    priorInboundBeforeWindow: boolean;
}

export function classifyEcho(input: EchoClassificationInput): EchoAuthorship {
    const { msSinceLastInbound, priorInboundBeforeWindow } = input;
    // No inbound at all: merchant-initiated outreach (or a row we never stored).
    // Nothing to be fast relative to — a human is the only safe reading.
    if (msSinceLastInbound === null) return 'manual';
    // A small negative gap is the retry path: the inbound row was written while we
    // waited, so its created_at is later than our receipt time. Still "fast".
    if (msSinceLastInbound < -APP_AUTO_WINDOW_MS || msSinceLastInbound > APP_AUTO_WINDOW_MS) return 'manual';
    return priorInboundBeforeWindow ? 'manual' : 'app_auto';
}
