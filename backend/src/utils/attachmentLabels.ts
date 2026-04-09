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
