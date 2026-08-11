import { t } from './i18n';

const ATTACHMENT_TYPE_MAP: Record<string, string> = {
    audio:    'attachmentAudio',
    image:    'attachmentImage',
    video:    'attachmentVideo',
    file:     'attachmentFile',
    post:     'attachmentPost',
    ig_post:  'attachmentPost',
    reel:     'attachmentPost',
    ig_reel:  'attachmentPost',
    fallback: 'attachmentFallback',
};

export function getAttachmentPlaceholder(
    type: string,
    lang: 'ar' | 'en' = 'ar',
): string {
    const key = ATTACHMENT_TYPE_MAP[type] ?? ATTACHMENT_TYPE_MAP['fallback'];
    return t(key as Parameters<typeof t>[0], lang);
}

export function getTextOnlyNudge(lang: 'ar' | 'en' = 'ar'): string {
    return t('nonTextNudge', lang);
}

/**
 * Non-enrichable attachment types that carry NO question to answer, so the
 * text-only nudge ("resend your question as text") is the wrong reply.
 *
 * `story_mention` = the customer tagged the page in THEIR OWN Instagram story.
 * Nudging them is wrong twice over: there was no استفسار to rephrase, and a
 * story mention is unprompted promotion for the merchant. Observed in prod
 * 2026-08-11 — one resort sent that nudge to 15 guests in a day (the page's
 * entire `[مرفق]` volume), and 11 of those rows were then flagged
 * `sla_no_reply`, padding the merchant's Needs Attention queue with story tags
 * instead of real questions.
 *
 * ⛔ `ig_story` is deliberately NOT here, and must not be added. It looks like a
 * sibling of `story_mention` and is not: it is a customer REPLYING to the
 * merchant's story, which on Instagram is one of the normal ways a purchase
 * conversation opens. Checked against production before shipping — the messages
 * that follow an `ig_story` row are «كم الواحد؟», «السعر», «الغيها الطلبيه ولا
 * في مشكله». Suppressing it would silently swallow buying questions and hide
 * them from Needs Attention at the same time.
 *
 * Stickers are NOT listed here either: they return earlier, before the stub is
 * even stored (see nonTextHandler).
 */
export const NO_INTENT_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
    'story_mention',
]);
