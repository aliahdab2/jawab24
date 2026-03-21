/** Placeholder text stored in DB so the merchant sees what the customer sent */
const ATTACHMENT_PLACEHOLDERS: Record<string, { en: string; ar: string }> = {
    audio:    { en: '[Voice Message]',  ar: '[رسالة صوتية]' },
    image:    { en: '[Image]',          ar: '[صورة]' },
    video:    { en: '[Video]',          ar: '[فيديو]' },
    file:     { en: '[File]',           ar: '[ملف]' },
    fallback: { en: '[Attachment]',     ar: '[مرفق]' },
};

/** Polite nudge reply asking the customer to resend as text */
const TEXT_ONLY_NUDGE: Record<string, string> = {
    ar: 'شكراً لتواصلك! حالياً نستطيع الرد على الرسائل النصية فقط. يرجى إعادة إرسال استفسارك كرسالة نصية وسنسعد بمساعدتك 🙏',
    en: 'Thanks for reaching out! We can currently only process text messages. Please resend your question as a text message and we\'ll be happy to help 🙏',
};

export function getAttachmentPlaceholder(
    type: string,
    lang: 'ar' | 'en' = 'ar',
): string {
    return (ATTACHMENT_PLACEHOLDERS[type] ?? ATTACHMENT_PLACEHOLDERS['fallback'])[lang];
}

export function getTextOnlyNudge(lang: 'ar' | 'en' = 'ar'): string {
    return TEXT_ONLY_NUDGE[lang] ?? TEXT_ONLY_NUDGE['en'];
}
