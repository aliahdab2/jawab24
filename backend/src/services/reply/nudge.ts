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

/** Maximum nudge length — Facebook comment character limit for short messages */
export const NUDGE_MAX_LENGTH = 80;

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
    tr: [
        'Detayları özel mesajla gönderdik 📩',
        'Size özel mesaj attık ✉️',
        'Detaylar özel mesajınızda 💬',
        'Bilgileri DM olarak ilettik 📨',
        'Detaylar özel olarak paylaşıldı 🙌',
    ],
    fr: [
        'Détails envoyés en message privé 📩',
        'Réponse envoyée dans votre boîte ✉️',
        'Consultez vos messages privés 💬',
        'Plus d\'infos envoyées en MP 📨',
        'Détails partagés en privé 🙌',
    ],
    es: [
        'Detalles enviados por mensaje privado 📩',
        'Respuesta enviada a tu bandeja ✉️',
        'Revisa tus mensajes privados 💬',
        'Más info enviada por DM 📨',
        'Detalles compartidos en privado 🙌',
    ],
    de: [
        'Details per Privatnachricht gesendet 📩',
        'Antwort in Ihrem Postfach ✉️',
        'Schauen Sie in Ihre Nachrichten 💬',
        'Mehr Infos per DM gesendet 📨',
        'Details privat geteilt 🙌',
    ],
    sv: [
        'Detaljer skickade via privat meddelande 📩',
        'Svar skickat till din inkorg ✉️',
        'Kolla dina privata meddelanden 💬',
        'Mer info skickad via DM 📨',
        'Detaljer delade privat 🙌',
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
    return variations[Math.floor(Math.random() * variations.length)].slice(0, NUDGE_MAX_LENGTH);
}
