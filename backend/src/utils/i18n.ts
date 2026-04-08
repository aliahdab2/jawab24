/**
 * Centralized backend i18n for customer-facing strings.
 *
 * All system-level messages sent to end customers (Messenger, Instagram, SMS)
 * live here. Merchant-customizable messages (away, greeting) stay in the DB.
 *
 * To add a new language: add the locale to `Locale`, then add translations
 * to every key in `messages`. TypeScript will enforce completeness.
 */

type Locale = 'ar' | 'en';
type Messages = Record<Locale, string>;

const messages = {
    // ─── Attachment placeholders (stored in DB so merchant sees what was sent) ───
    attachmentAudio:    { ar: '[رسالة صوتية]', en: '[Voice Message]' },
    attachmentImage:    { ar: '[صورة]',        en: '[Image]' },
    attachmentVideo:    { ar: '[فيديو]',       en: '[Video]' },
    attachmentFile:     { ar: '[ملف]',         en: '[File]' },
    attachmentFallback: { ar: '[مرفق]',        en: '[Attachment]' },

    // ─── Non-text nudge (photo/video/file — voice is handled by Whisper) ────────
    nonTextNudge: {
        ar: 'شكراً لتواصلك! حالياً نستطيع الرد على الرسائل النصية والصوتية. يرجى إعادة إرسال استفسارك كرسالة نصية أو صوتية وسنسعد بمساعدتك 🙏',
        en: 'Thanks for reaching out! We can currently process text and voice messages. Please resend your question as a text or voice message and we\'ll be happy to help 🙏',
    },

    // ─── Price fallback (when AI hallucinates pricing) ──────────────────────────
    priceFallback: {
        ar: 'شكراً لاهتمامك! خليني أتأكد من تفاصيل الأسعار وبرجعلك بأقرب وقت.',
        en: 'Thank you for your interest! Let me confirm the pricing details and get back to you shortly.',
    },

    // ─── Default away message (fallback when workspace has none set) ─────────────
    defaultAway: {
        ar: 'شكراً لتواصلك معنا! نحن حالياً خارج أوقات العمل، وسنرد عليك في أقرب وقت ممكن.',
        en: 'Thanks for your message! We\'re currently away and will get back to you as soon as possible.',
    },

    // ─── Dual-mode default nudge (public comment when DM also sent) ─────────────
    dualNudgeDefault: {
        ar: 'أرسلنا لك التفاصيل برسالة خاصة 📩',
        en: 'Details sent via private message 📩',
    },

    // ─── Instagram fallback reply ───────────────────────────────────────────────
    instagramFallback: {
        ar: 'شكراً لتعليقك! 🙏',
        en: 'Thank you for your comment! 🙏',
    },

    // ─── Shared post nudge (when customer shares a post with no text) ───────────
    sharedPostNudge: {
        ar: 'شفنا المنشور! كيف نقدر نساعدك؟ اكتب لنا استفسارك 🙏',
        en: 'We saw the post you shared! How can we help? Send us your question 🙏',
    },

    // ─── Shared post placeholder (stored in DB) ────────────────────────────────
    attachmentPost: { ar: '[منشور مُشارَك]', en: '[Shared Post]' },

    // ─── Team invite SMS ───────────────────────────────────────────────────────
    inviteSms: {
        ar: 'لديك دعوة للانضمام إلى فريق على Jawab24. اقبل الدعوة من هنا: {link}',
        en: 'You\'ve been invited to join a team on Jawab24. Accept here: {link}',
    },
} as const satisfies Record<string, Messages>;

export type MessageKey = keyof typeof messages;

/**
 * Get a customer-facing string by key and locale.
 * Falls back to English if the locale is not found.
 * Optional `vars` replaces `{key}` placeholders in the string.
 */
export function t(key: MessageKey, lang: string, vars?: Record<string, string>): string {
    let text: string = messages[key][lang as Locale] ?? messages[key].en;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{${k}}`, v);
        }
    }
    return text;
}
