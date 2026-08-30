import { describe, it, expect } from 'vitest';
import { isImageMessageBody, extractImageDescription, extractImageDescriptions, isAnyImageMessage } from '@jawab24/shared';
import { t } from '../utils/i18n';
import { getAttachmentPlaceholder } from '../utils/attachmentLabels';

/**
 * Drift guard: the image-message body format is DEFINED by the backend i18n
 * template (`attachmentImageDescribed`) but DETECTED by the shared matcher
 * (ai-worker prompt directive, frontend display stripping). If someone edits
 * the i18n template without updating the shared regex (or vice versa), image
 * messages silently stop being recognized — this test makes that a build
 * failure instead.
 */
describe('image-message marker protocol (i18n ↔ shared matcher)', () => {
    const DESC = 'لقطة شاشة لمنشور المتجر عن منتج ما';

    it.each(['ar', 'en'] as const)('the %s i18n template produces a body the shared matcher recognizes', (lang) => {
        const body = t('attachmentImageDescribed', lang, { description: DESC });
        expect(isImageMessageBody(body)).toBe(true);
        expect(extractImageDescription(body)).toBe(DESC);
        expect(isAnyImageMessage(body)).toBe(true);
    });

    it.each(['ar', 'en'] as const)('the bare %s image placeholder is recognized as an image (but not a described one)', (lang) => {
        const placeholder = getAttachmentPlaceholder('image', lang);
        expect(isAnyImageMessage(placeholder)).toBe(true);
        expect(isImageMessageBody(placeholder)).toBe(false);
        expect(extractImageDescription(placeholder)).toBeNull();
    });

    it('ordinary customer text is not matched', () => {
        for (const text of ['بكم هذا المنتج؟', 'hello', '[Voice Message]', '[منشور مُشارَك]']) {
            expect(isAnyImageMessage(text)).toBe(false);
        }
    });
});

// `extractImageDescriptions` is the un-anchored sibling used by the price guard: the
// reply pipeline consolidates one debounce window into a single customer text, so a
// described photo can sit beside typed text or another photo.
describe('extractImageDescriptions (consolidated customer turn)', () => {
    it('returns every described image in order, ignoring bare placeholders and typed text', () => {
        const text = '[صورة: إيصال بمبلغ 3750 ليرة]\nوصلكم؟\n[Image]\n[Image: second screenshot, 250 دج]';
        expect(extractImageDescriptions(text)).toEqual(['إيصال بمبلغ 3750 ليرة', 'second screenshot, 250 دج']);
    });

    it('agrees with the anchored matcher on a lone described image', () => {
        const body = t('attachmentImageDescribed', 'ar', { description: 'لقطة شاشة' });
        expect(extractImageDescriptions(body)).toEqual([extractImageDescription(body)]);
    });

    it('returns nothing for text without a described image', () => {
        expect(extractImageDescriptions('بكم؟ 500؟')).toEqual([]);
        expect(extractImageDescriptions('[صورة]')).toEqual([]);
    });
});
