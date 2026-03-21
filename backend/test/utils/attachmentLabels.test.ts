import { describe, it, expect } from 'vitest';
import { getAttachmentPlaceholder, getTextOnlyNudge } from '../../src/utils/attachmentLabels';

describe('attachmentLabels', () => {
    describe('getAttachmentPlaceholder', () => {
        it('returns Arabic voice message placeholder by default', () => {
            expect(getAttachmentPlaceholder('audio')).toBe('[رسالة صوتية]');
        });

        it('returns English voice message placeholder', () => {
            expect(getAttachmentPlaceholder('audio', 'en')).toBe('[Voice Message]');
        });

        it('returns correct placeholder for each type in Arabic', () => {
            expect(getAttachmentPlaceholder('image', 'ar')).toBe('[صورة]');
            expect(getAttachmentPlaceholder('video', 'ar')).toBe('[فيديو]');
            expect(getAttachmentPlaceholder('file', 'ar')).toBe('[ملف]');
            expect(getAttachmentPlaceholder('fallback', 'ar')).toBe('[مرفق]');
        });

        it('returns correct placeholder for each type in English', () => {
            expect(getAttachmentPlaceholder('image', 'en')).toBe('[Image]');
            expect(getAttachmentPlaceholder('video', 'en')).toBe('[Video]');
            expect(getAttachmentPlaceholder('file', 'en')).toBe('[File]');
            expect(getAttachmentPlaceholder('fallback', 'en')).toBe('[Attachment]');
        });

        it('falls back to [Attachment] for unknown types', () => {
            expect(getAttachmentPlaceholder('sticker', 'en')).toBe('[Attachment]');
            expect(getAttachmentPlaceholder('unknown', 'ar')).toBe('[مرفق]');
        });
    });

    describe('getTextOnlyNudge', () => {
        it('returns Arabic nudge by default', () => {
            const nudge = getTextOnlyNudge();
            expect(nudge).toContain('الرسائل النصية');
        });

        it('returns Arabic nudge explicitly', () => {
            const nudge = getTextOnlyNudge('ar');
            expect(nudge).toContain('نستطيع الرد على الرسائل النصية فقط');
        });

        it('returns English nudge', () => {
            const nudge = getTextOnlyNudge('en');
            expect(nudge).toContain('text messages');
        });
    });
});
