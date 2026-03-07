/**
 * Nudge Variation Utilities
 *
 * In dual reply mode, the public comment is a short "nudge" pointing to the DM.
 * To avoid Facebook spam detection from identical repeated comments, we rotate
 * through multiple variations of the same message.
 *
 * Flow:
 * 1. User saves a custom nudge message in settings
 * 2. AI generates ~10 variations (stored per-language in DB)
 * 3. At send time, pickNudgeVariation() randomly selects one
 */

/** Default nudge variations (fallback when no custom variations exist) */
export const DEFAULT_NUDGE_VARIATIONS: Record<string, string[]> = {
    ar: [
        'أرسلنا لك التفاصيل برسالة خاصة 📩',
        'تم الرد عليك بالخاص ✉️',
        'شيّك الرسائل الخاصة للتفاصيل 💬',
        'أرسلنا لك التفاصيل بالخاص 📨',
        'التفاصيل وصلتك بالرسائل الخاصة 🙌',
    ],
    en: [
        'Details sent via private message 📩',
        'Full reply sent to your inbox ✉️',
        'We sent you a private message 💬',
        'More info sent via DM 📨',
        'Details shared privately 🙌',
    ],
};

/**
 * Pick a random nudge variation for the given language.
 * Fallback chain: custom for lang > any custom > defaults for lang > Arabic defaults.
 */
export function pickNudgeVariation(
    variationsMulti: Record<string, string[]> | undefined | null,
    language: string,
): string {
    const custom = variationsMulti || {};
    const forLang = custom[language];
    const variations = (forLang && forLang.length > 0 ? forLang : null)
        || Object.values(custom).find(v => Array.isArray(v) && v.length > 0)
        || DEFAULT_NUDGE_VARIATIONS[language]
        || DEFAULT_NUDGE_VARIATIONS['ar'];
    return variations[Math.floor(Math.random() * variations.length)].slice(0, 80);
}
