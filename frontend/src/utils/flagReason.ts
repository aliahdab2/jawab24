/**
 * Flag reason utilities — shared between CommentCard, MessageCard, and modals.
 *
 * Translates backend flagReason strings (comma-separated snake_case keys)
 * into user-facing labels using the flagReason i18n namespace.
 */

/** Flags that indicate the reply failed due to missing Business Info */
const KB_FLAGS = new Set(['info_not_in_kb', 'price_not_in_kb']);

/**
 * Returns true when the primary flag on a comment/message is KB-related,
 * meaning the user should be guided to add info to Business Info.
 */
export function isKbRelatedFlag(flagReason: string | null | undefined): boolean {
    return KB_FLAGS.has(getPrimaryFlag(flagReason) ?? '');
}

/** Flags that represent urgent/high-stakes customer requests */
const URGENT_FLAGS = new Set([
    'cancellation_request',
    'refund_request',
    'exchange_request',
    'angry_customer',
]);

/** Visual config for flag tags on cards */
export interface FlagTagStyle {
    /** Semantic CSS class (from globals.css) */
    cssClass: string;
    /** Whether this flag is urgent (shows pulse animation) */
    urgent: boolean;
}

/**
 * Get the visual style for a flag tag.
 * Urgent flags get red styling; non-urgent get amber/warning.
 */
export function getFlagTagStyle(flagKey: string): FlagTagStyle {
    // Strip SLA suffix (e.g. "sla_no_reply:60" → "sla_no_reply") for lookup
    const baseKey = flagKey.replace(/:.*$/, '');
    if (URGENT_FLAGS.has(baseKey)) {
        return { cssClass: 'status-error', urgent: true };
    }
    return { cssClass: 'status-warning', urgent: false };
}

/**
 * Parse a comma-separated flagReason string into the most important flag key.
 * Urgent flags take priority over non-urgent ones.
 */
export function getPrimaryFlag(flagReason: string | null | undefined): string | null {
    if (!flagReason) return null;
    const flags = flagReason.split(',').map(f => f.trim()).filter(Boolean);
    if (flags.length === 0) return null;
    // Prefer urgent flags
    return flags.find(f => URGENT_FLAGS.has(f)) || flags[0];
}

/**
 * Translate a comma-separated flagReason string using i18n keys.
 * Falls back to the raw reason if no translation exists.
 *
 * @param flagReason - Backend flagReason string (e.g. "cancellation_request,low_confidence")
 * @param t - Translation function from useTranslations('flagReason')
 * @param locale - Current locale (for separator: Arabic uses ، )
 */
export function translateFlagReason(
    flagReason: string | null | undefined,
    t: (key: string, params?: Record<string, string>) => string,
    locale: string,
): string {
    if (!flagReason) return '';
    const separator = locale === 'ar' ? '، ' : ', ';
    return flagReason
        .split(',')
        .map(f => {
            const trimmed = f.trim();
            // Structured SLA format: "sla_no_reply:60"
            const slaMatch = trimmed.match(/^sla_no_reply:(\d+)$/);
            if (slaMatch) {
                return t('slaNoReply', { minutes: slaMatch[1] });
            }
            // Legacy SLA format: "SLA: no reply after 60 min"
            const legacySlaMatch = trimmed.match(/^SLA: no reply after (\d+) min$/);
            if (legacySlaMatch) {
                return t('slaNoReply', { minutes: legacySlaMatch[1] });
            }
            // Standard flag key
            const translated = t(trimmed);
            // next-intl returns the key path when no translation found
            return translated === trimmed ? trimmed : translated;
        })
        .join(separator);
}
