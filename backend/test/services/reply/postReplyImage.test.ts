import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendMetaImageAttachment = vi.fn();
vi.mock('../../../src/services/metaMessaging', () => ({
    sendMetaImageAttachment: (...args: unknown[]) => mockSendMetaImageAttachment(...args),
}));

const mockCaptureError = vi.fn();
vi.mock('../../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

import { deliverReplyImageBestEffort } from '../../../src/services/reply/postReplyImage';

describe('deliverReplyImageBestEffort', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sends the native image to the PSID and returns true on success', async () => {
        mockSendMetaImageAttachment.mockResolvedValue('msg-id');
        const delivered = await deliverReplyImageBestEffort('tok', 'psid-1', 'https://cdn/x.jpg', {
            platform: 'facebook', component: 'sender',
        });
        expect(delivered).toBe(true);
        expect(mockSendMetaImageAttachment).toHaveBeenCalledWith('tok', 'psid-1', 'https://cdn/x.jpg', undefined, undefined);
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('never throws on a send failure — logs it and returns false (text already delivered)', async () => {
        mockSendMetaImageAttachment.mockRejectedValue(new Error('meta could not fetch image'));
        const delivered = await deliverReplyImageBestEffort('tok', 'psid-1', 'https://cdn/x.jpg', {
            platform: 'instagram', component: 'instagramCommentAdapter', extra: { platformCommentId: 'c-1' },
        });
        expect(delivered).toBe(false);
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        // Grouped by a stable fingerprint so an at-scale rejection surfaces as one issue.
        const opts = mockCaptureError.mock.calls[0][2] as { fingerprint: string[]; tags: Record<string, string> };
        expect(opts.fingerprint).toEqual(['post-reply-image-attachment-failed']);
        expect(opts.tags).toMatchObject({ platform: 'instagram', component: 'instagramCommentAdapter' });
    });
});
