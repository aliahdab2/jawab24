import { foldArabicDigits } from './utils/arabic-normalize';

/**
 * Max length for customer-facing message templates (greeting, away message,
 * limit-fallback). Tied to Instagram DM limit (1000 chars) — the strictest
 * platform we send to. Anything longer would be rejected by Meta when
 * delivering to IG threads.
 */
export const MAX_TEMPLATE_MESSAGE_LENGTH = 1000;

/**
 * Post Reply (per-post keyword trigger) limits — the SINGLE source of truth for
 * both the backend validator (`services/reply/postReplyRule.ts`) and the frontend
 * modal (`PostTriggerModal.tsx`), so the field caps and the server enforcement can
 * never drift.
 */
export const POST_REPLY_MAX_KEYWORDS = 10;
export const POST_REPLY_MAX_KEYWORD_LEN = 100;
// The merchant may write up to 1000 chars. Delivery on a cold comment→DM (one message
// allowed) depends on length + whether an image is attached — see POST_REPLY_CARD_CAPTION_MAX.
export const POST_REPLY_MAX_REPLY_LEN = 1000;
/**
 * Image types accepted from ANY merchant upload in the product. One list, so a
 * new upload surface cannot quietly widen the allowlist: every caller validates
 * the declared mime against this AND the buffer's magic bytes
 * (`bufferMatchesMime`) before the bytes are stored.
 */
export const UPLOADED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Post Reply image upload limits (DM-modes only). */
export const POST_REPLY_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded
export const POST_REPLY_IMAGE_MIME_TYPES = UPLOADED_IMAGE_MIME_TYPES;

/**
 * Post Reply CTA button (DM-modes only, Facebook only). A tappable link button under the
 * private reply (ManyChat's "auto-DM a link" pattern). Both label and URL are required
 * together or the button is absent. Limits mirror Meta's URL-button constraints:
 *  - label ≤ 20 chars (Messenger button `title` cap)
 *  - when the button rides a button template (no image attached), the reply text that
 *    accompanies it is capped at 640 (Meta's button-template `text` limit); with an image
 *    the button rides the generic image card instead, so the full reply cap still applies.
 */
export const POST_REPLY_BUTTON_LABEL_MAX = 20;
export const POST_REPLY_BUTTON_TEXT_MAX = 640;

/**
 * For an image Post Reply on a cold comment→DM, the caption length at/under which the card
 * shows the FULL caption. Above it, the card shows a teaser + a «Read more» postback button,
 * and the full text is delivered as a follow-up DM when the customer taps (the tap opens Meta's
 * 24h window); the image stays in the card (tappable to full size) and is not re-sent. Equals
 * Meta's generic-template title limit (80). Single source of truth for the backend sender AND
 * the frontend modal preview so they can't drift.
 */
export const POST_REPLY_CARD_CAPTION_MAX = 80;

/**
 * Postback payload for the Post Reply «Read more» button — `pr_more:<source>:<postId>`.
 * Meta caps payloads at 1000 chars, so we carry only an id and look the full text + image
 * up from `posts` at tap time (always current, no stashing).
 */
export const READ_MORE_PAYLOAD_PREFIX = 'pr_more';

export function buildReadMorePayload(source: 'facebook' | 'instagram', postId: string): string {
    return `${READ_MORE_PAYLOAD_PREFIX}:${source}:${postId}`;
}

export function parseReadMorePayload(
    payload: string | null | undefined,
): { source: 'facebook' | 'instagram'; postId: string } | null {
    if (!payload) return null;
    const parts = payload.split(':');
    if (parts.length !== 3 || parts[0] !== READ_MORE_PAYLOAD_PREFIX) return null;
    const [, source, postId] = parts;
    if ((source !== 'facebook' && source !== 'instagram') || !postId) return null;
    return { source, postId };
}

/**
 * Max length for the Reply Personality / brand-voice note. Unlike the template
 * messages above, this is NOT sent to customers — it's injected into the AI
 * system prompt. This single value is the source of truth for BOTH the editor
 * field's max length AND the prompt-injection slice, so a merchant's full
 * persona always reaches the model (no silent truncation). Sized to fit a
 * structured persona — identity, voice, signature phrases, style, and goal —
 * with headroom, while bounding prompt cost.
 */
export const MAX_BRAND_VOICE_LENGTH = 800;

/** Default AI model used across backend and ai-worker services */
export const DEFAULT_AI_MODEL = 'gpt-4.1-mini';

/**
 * Days a `past_due` subscription keeps replying while an external processor
 * retries the payment (declined card, bank flag). Covers Stripe's first retry
 * window without granting a week of free service every month; matches Shopify.
 *
 * Lives here rather than in the subscriptions service because the support console
 * must date the same fuse the reply gate burns, and `admin/health.ts` is
 * deliberately DB-free — importing the service would drag `db`/`redis` into a
 * module whose whole value is being unit-testable with plain fixtures. A second
 * literal `3` in the console would drift the day the grace changes.
 */
export const PAST_DUE_GRACE_DAYS = 3;

/**
 * Placeholder timezone a settings row carries until the merchant sets a real one.
 *
 * NOT a sensible guess — no global default can be — which is why the business-hours
 * card seeds the merchant's detected zone the moment they switch hours on, and why
 * any code comparing against this value is asking "has this ever been set?" rather
 * than "where is this merchant?". Must stay identical to the `settings.timezone`
 * column default (backend/src/db/schema.ts) and the workspace-JSONB read default,
 * otherwise a row and its workspace disagree about when a merchant's day starts.
 */
export const PLACEHOLDER_TIMEZONE = 'Asia/Riyadh';

/**
 * Per-customer model overrides are validated against this allowlist before
 * being applied. Backend's `aiModelResolver` falls back to `DEFAULT_AI_MODEL`
 * for any value not in this set, so a typo in the `settings.ai_model` DB
 * column is a silent fallback, not a runtime error.
 *
 * **OpenAI-only intentionally.** The ai-worker's provider abstraction also
 * supports Claude models (`ai-worker/src/services/providers/index.ts`), but
 * `ANTHROPIC_API_KEY` is not provisioned in production env files — verified
 * by inspecting the live ai-worker container. Allowing Claude IDs here would
 * silently break replies for any customer routed to one. Re-add Claude entries
 * only after the key is wired up in `env/ai.env` AND an end-to-end test
 * against the real Anthropic API has passed.
 */
export const ALLOWED_AI_MODELS = [
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4.1',
    'gpt-4o-mini',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
] as const;

export type AllowedAiModel = (typeof ALLOWED_AI_MODELS)[number];

export function isAllowedAiModel(model: string | null | undefined): model is AllowedAiModel {
    return !!model && (ALLOWED_AI_MODELS as readonly string[]).includes(model);
}

/**
 * Offline (non-card) payment rail — Syria pays through Sham Cash, and the same
 * shape serves any future manual rail (Libya's bank transfers go through support
 * by hand today). The merchant transfers to our wallet, then submits the transfer
 * reference so we can match it against the wallet statement.
 *
 * THE REFERENCE IS THE ANTI-REPLAY KEY, not a nicety: without uniqueness on it,
 * one screenshot renews a subscription forever.
 */
export const OFFLINE_PAYMENT_RAILS = ['sham_cash'] as const;
export type OfflinePaymentRail = typeof OFFLINE_PAYMENT_RAILS[number];

export const OFFLINE_PAYMENT_REFERENCE_MAX = 64;
export const OFFLINE_PAYMENT_SENDER_NAME_MAX = 120;
export const OFFLINE_PAYMENT_NOTE_MAX = 500;

/** Receipt screenshot: OPTIONAL evidence. The reference is what reconciles. */
export const OFFLINE_PAYMENT_RECEIPT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded
export const OFFLINE_PAYMENT_RECEIPT_MIME_TYPES = UPLOADED_IMAGE_MIME_TYPES;

/**
 * How many submissions one user may leave awaiting review. Not a business rule —
 * an abuse bound, so a single account cannot fill the receipts table.
 */
export const OFFLINE_PAYMENT_MAX_PENDING_PER_USER = 3;

export const OFFLINE_PAYMENT_STATUSES = ['pending_review', 'approved', 'rejected'] as const;
export type OfflinePaymentStatus = typeof OFFLINE_PAYMENT_STATUSES[number];

/**
 * Normalized form of a transfer reference — what the uniqueness constraint sees.
 * Merchants retype the same reference with spaces, dashes, or Arabic-Indic
 * digits; all three spellings must collide, or the replay guard is decorative.
 */
export function normalizeTransferReference(raw: string): string {
    return foldArabicDigits(raw.trim())
        .toUpperCase()
        .replace(/[\s\-_./\\]+/g, '');
}
