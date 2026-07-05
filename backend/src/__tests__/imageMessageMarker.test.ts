import { describe, it, expect } from 'vitest';
import { isImageMessageBody, extractImageDescription, isAnyImageMessage } from '@jawab24/shared';
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
