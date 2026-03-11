/**
 * Single source of truth for high-stakes flags.
 * Maps snake_case flag → { en: English label, ar: Arabic translation }.
 *
 * Extracted into its own file to avoid circular imports between
 * messageProcessor.ts (which imports notificationService) and
 * notifications.ts (which needs these flag mappings).
 */
export const URGENT_FLAG_MAP: Record<string, { en: string; ar: string }> = {
    cancellation_request: { en: 'Cancellation Request', ar: 'طلب إلغاء' },
    refund_request:       { en: 'Refund Request',       ar: 'طلب استرجاع' },
    exchange_request:     { en: 'Exchange Request',     ar: 'طلب استبدال' },
    angry_customer:       { en: 'Angry Customer',       ar: 'عميل غاضب' },
};

const URGENT_FLAGS = new Set(Object.keys(URGENT_FLAG_MAP));

/** Check if any flag in the comma-separated reason is urgent */
export function isUrgentFlag(flagReason: string | undefined): boolean {
    if (!flagReason) return false;
    return flagReason.split(',').some(f => URGENT_FLAGS.has(f.trim()));
}

/**
 * Build a human-readable notification reason.
 * For high-stakes flags, returns a label like "Cancellation Request — order #5678".
 * For non-urgent flags, returns the original flagReason unchanged.
 */
export function buildNotificationReason(flagReason: string | undefined, messageText: string): string {
    if (!flagReason) return 'AI flagged this reply';

    const flags = flagReason.split(',').map(f => f.trim());
    const urgentFlag = flags.find(f => URGENT_FLAGS.has(f));
    if (!urgentFlag) return flagReason;

    // Try to extract order number from the customer's message
    const orderMatch = messageText.match(/#?\b\d{3,10}\b/);
    const orderSuffix = orderMatch ? ` — order ${orderMatch[0]}` : '';

    return (URGENT_FLAG_MAP[urgentFlag]?.en || urgentFlag) + orderSuffix;
}
