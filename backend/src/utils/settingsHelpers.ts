/**
 * Shared helpers for settings services.
 * Used by both SettingsService (per-user) and WorkspaceSettingsService (per-workspace).
 */

/**
 * Check if the current time (in the given timezone) falls within business hours.
 *
 * Re-exported from `@jawab24/shared` rather than reimplemented: the settings UI
 * renders the same "open / closed" state next to the merchant's hours, and when
 * the two carried separate copies they disagreed — this one treated `end` as
 * inclusive, the card as exclusive, so at exactly 18:00 the pipeline replied
 * while the badge read "Outside Hours". One definition, one answer.
 */
export { isWithinBusinessHours } from '@jawab24/shared';

/**
 * Resolve which language version to use for a customer-facing reply.
 *
 * - If autoDetectLanguage is ON and the detected language is supported → use it
 * - Otherwise → use the default reply language (or first supported as last resort)
 */
export function resolveLanguage(
    opts: {
        autoDetectLanguage: boolean;
        supportedLanguages: string[] | null;
        defaultLanguage: string;
    },
    detectedLanguage?: string,
): string {
    const supported = opts.supportedLanguages ?? ['en', 'ar'];
    const fallback = supported.includes(opts.defaultLanguage)
        ? opts.defaultLanguage
        : (supported[0] ?? 'en');

    if (!opts.autoDetectLanguage || !detectedLanguage || detectedLanguage === 'unknown') {
        return fallback;
    }

    return supported.includes(detectedLanguage) ? detectedLanguage : fallback;
}
