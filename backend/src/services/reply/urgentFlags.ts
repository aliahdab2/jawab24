/**
 * Registry of high-stakes flags that warrant urgent push notifications.
 * Translations live in packages/shared/src/i18n/{en,ar}/flagReason.json.
 *
 * Extracted into its own file to avoid circular imports between
 * messageProcessor.ts (which imports notificationService) and
 * notifications.ts (which needs these flag keys).
 */
import { parseFlagReason } from '@jawab24/shared';

export const URGENT_FLAGS = new Set([
    'cancellation_request',
    'refund_request',
    'exchange_request',
    'angry_customer',
]);

/**
 * Deterministic backstop for high-stakes business-action intents (cancel / refund
 * / exchange). The AI model is instructed to emit these flags (ai-worker
 * systemPrompt), but it occasionally misses a phrasing — and a missed cancel/
 * refund/exchange request means the merchant never gets the urgent alert. This
 * keyword detector guarantees the flag is set when the customer's words are
 * unambiguous, in Arabic or English. Deliberately NARROW (explicit action verbs
 * only) so it never fires on a generic complaint or a product question.
 */
const BUSINESS_ACTION_PATTERNS: ReadonlyArray<{ flag: string; re: RegExp }> = [
    { flag: 'exchange_request', re: /ابدل|أبدل|نبدل|تبدل|تبديل|استبدال|استبدل|بدّل|\b(?:exchange|swap)\b/i },
    { flag: 'refund_request', re: /استرجاع|استرداد|فلوسي|ارجعوا?\s*فلوس|رد(?:وا)?\s*(?:لي\s*)?المبلغ|\b(?:refund|money\s*back)\b/i },
    { flag: 'cancellation_request', re: /الغاء|إلغاء|الغي|ألغي|الغو|ألغو|نلغي|تلغي|كنسل|\bcancel/i },
];

/**
 * Detect high-stakes business-action flags from the customer's raw message,
 * independent of the model's classification. Returns the matched flag keys
 * (subset of cancellation_request / refund_request / exchange_request).
 */
export function detectBusinessActionFlags(text: string | undefined | null): string[] {
    if (!text) return [];
    return BUSINESS_ACTION_PATTERNS.filter(p => p.re.test(text)).map(p => p.flag);
}

/** @deprecated Use URGENT_FLAGS set directly. Kept for any external consumers. */
export const URGENT_FLAG_MAP: Record<string, true> = Object.fromEntries(
    [...URGENT_FLAGS].map(k => [k, true as const]),
);

/** Check if any flag in the comma-separated reason string is urgent */
export function isUrgentFlag(flagReason: string | undefined): boolean {
    if (!flagReason) return false;
    return flagReason.split(',').some(f => URGENT_FLAGS.has(f.trim()));
}

/**
 * Whether a flagged comment/message warrants an urgent push (loud channel /
 * heads-up). True when the flag is high-stakes OR the AI classified the content
 * as OFFENSIVE — offensive/abusive public content is reputation-urgent even when
 * no flagReason string was attached (the offensive skip path may pass an empty
 * flagReason and only the intent). Kept separate from URGENT_FLAGS so the
 * business-action flag set (used for order-number enrichment + frontend styling)
 * stays focused.
 */
export function isUrgentNotification(flagReason: string | undefined, aiIntent?: string | null): boolean {
    return isUrgentFlag(flagReason) || aiIntent === 'OFFENSIVE';
}

/**
 * Build a human-readable notification reason.
 * For high-stakes flags, returns a label like "Cancellation Request — order #5678".
 * For non-urgent flags, returns the original flagReason unchanged.
 */
export function buildNotificationReason(flagReason: string | undefined, messageText: string): string {
    if (!flagReason) return 'AI flagged this reply';

    const flags = parseFlagReason(flagReason);
    const urgentFlag = flags.find(f => URGENT_FLAGS.has(f));
    if (!urgentFlag) return flagReason;

    // Try to extract order number from the customer's message
    const orderMatch = messageText.match(/#?\b\d{3,10}\b/);
    const orderSuffix = orderMatch ? ` — order ${orderMatch[0]}` : '';

    // Return snake_case key so translateFlagReason can look it up in the
    // shared JSON and translate into the user's language.
    return urgentFlag + orderSuffix;
}
