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
 * Flag metadata keyed by reason code. Mirrors backend FlagMeta in @jawab24/shared.
 * Only reasons that carry params need an entry here.
 */
export interface FlagMetaShape {
    sla_no_reply?: { minutes: number };
    dm_failed?: { bucket?: string };
    [key: string]: Record<string, unknown> | undefined;
}

/**
 * Translate a comma-separated flagReason string using i18n keys.
 *
 * For reasons that carry params (sla_no_reply minutes, dm_failed bucket),
 * flagMeta is the source of truth. Legacy string encodings (`sla_no_reply:60`,
 * `DM failed: unknown`) are recognized as a fallback for rows written before
 * the flag_meta column existed; new writes should always populate flagMeta.
 *
 * @param flagReason - Backend flagReason (comma-separated keys, e.g. "dm_failed,low_confidence")
 * @param t - Translation function from useTranslations('flagReason')
 * @param locale - Current locale (for separator: Arabic uses ، )
 * @param flagMeta - Structured params/debug info keyed by reason code
 */
export function translateFlagReason(
    flagReason: string | null | undefined,
    t: (key: string, params?: Record<string, string>) => string,
    locale: string,
    flagMeta?: FlagMetaShape | null,
): string {
    if (!flagReason) return '';
    const separator = locale === 'ar' ? '، ' : ', ';
    return flagReason
        .split(',')
        .map(f => translateSingleFlag(f.trim(), t, flagMeta))
        .join(separator);
}

function translateSingleFlag(
    key: string,
    t: (k: string, params?: Record<string, string>) => string,
    flagMeta?: FlagMetaShape | null,
): string {
    // Structured path: flag_reason is a bare key and params live in flag_meta.
    if (key === 'sla_no_reply') {
        const minutes = flagMeta?.sla_no_reply?.minutes;
        if (typeof minutes === 'number') {
            return t('sla_no_reply', { minutes: String(minutes) });
        }
        // Fall through to plain translation (renders the generic label if no meta)
    }
    if (key === 'dm_failed') {
        const bucket = flagMeta?.dm_failed?.bucket;
        if (typeof bucket === 'string') {
            const bucketKey = `dm_failed_${bucket}`;
            const bucketLabel = t(bucketKey);
            if (bucketLabel !== bucketKey) return bucketLabel;
        }
        // Fall through to generic "dm_failed" label
    }

    // Legacy encodings — pre-flag_meta rows. Remove once backfill migration has
    // run in all environments and no legacy rows remain.
    const slaLegacy = key.match(/^sla_no_reply:(\d+)$/);
    if (slaLegacy) return t('sla_no_reply', { minutes: slaLegacy[1] });
    const slaLegacyLong = key.match(/^SLA: no reply after (\d+) min$/);
    if (slaLegacyLong) return t('sla_no_reply', { minutes: slaLegacyLong[1] });
    const dmLegacy = key.match(/^DM failed: (\w+)$/);
    if (dmLegacy) {
        const bucketKey = `dm_failed_${dmLegacy[1]}`;
        const bucketLabel = t(bucketKey);
        return bucketLabel !== bucketKey ? bucketLabel : t('dm_failed');
    }

    // Plain key
    const translated = t(key);
    return translated === key ? key : translated;
}
