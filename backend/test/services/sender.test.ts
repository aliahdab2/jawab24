import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { facebookService } from '../../src/services/facebook';
import { detectLanguageCode } from '../../src/utils/language';

vi.mock('axios');
vi.mock('../../src/services/facebook');
vi.mock('../../src/utils/language');
vi.mock('../../src/config', () => ({
    config: {
        facebook: { graphApiVersion: 'v18.0' },
    },
}));

// Import after mocks are set up
import { ReplySender } from '../../src/services/reply/sender';

const GRAPH_API = 'https://graph.facebook.com/v18.0';

describe('ReplySender', () => {
    let sender: ReplySender;
    const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
    };

    const baseOptions = {
        facebookCommentId: 'fb_comment_123',
        replyText: 'Thank you for your feedback!',
        commentMessage: 'Great product!',
        accessToken: 'access_token_abc',
        fromId: 'user_456',
        replyMode: 'public' as const,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        sender = new ReplySender();
        sender.setLogger(mockLogger);
        vi.mocked(detectLanguageCode).mockReturnValue('ar');
        vi.mocked(axios.post).mockResolvedValue({ data: { id: 'reply_id' } });
        vi.mocked(facebookService.sendPrivateReplyToComment).mockResolvedValue(undefined);
    });

    // ─── Demo Mode ───────────────────────────────────────────────────

    describe('Demo Mode', () => {
        it('should return success immediately in demo mode', async () => {
            const result = await sender.sendCommentReply({
                ...baseOptions,
                isDemo: true,
            });

            expect(result).toEqual({ success: true });
        });

        it('should not call Facebook APIs in demo mode', async () => {
            await sender.sendCommentReply({
                ...baseOptions,
                isDemo: true,
            });

            expect(axios.post).not.toHaveBeenCalled();
            expect(facebookService.sendPrivateReplyToComment).not.toHaveBeenCalled();
        });
    });

    // ─── Public Mode ─────────────────────────────────────────────────

    describe('Public Mode', () => {
        it('should call axios.post with correct Graph API URL', async () => {
            await sender.sendCommentReply(baseOptions);

            expect(axios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'Thank you for your feedback!' },
                { params: { access_token: 'access_token_abc' } }
            );
        });

        it('should return success when API call succeeds', async () => {
            const result = await sender.sendCommentReply(baseOptions);

            expect(result).toEqual({ success: true });
        });

        it('should return failure when API call throws', async () => {
            vi.mocked(axios.post).mockRejectedValue(new Error('Network error'));

            const result = await sender.sendCommentReply(baseOptions);

            expect(result).toEqual({
                success: false,
                error: 'Failed to post public reply to Facebook',
            });
        });

        it('should not call sendPrivateMessage in public mode', async () => {
            await sender.sendCommentReply(baseOptions);

            expect(facebookService.sendPrivateReplyToComment).not.toHaveBeenCalled();
        });
    });

    // ─── Private Mode ────────────────────────────────────────────────

    describe('Private Mode', () => {
        const privateOptions = { ...baseOptions, replyMode: 'private' as const };

        it('should call sendPrivateReplyToComment with comment ID and text', async () => {
            await sender.sendCommentReply(privateOptions);

            expect(facebookService.sendPrivateReplyToComment).toHaveBeenCalledWith(
                'access_token_abc',
                'fb_comment_123',
                'Thank you for your feedback!'
            );
        });

        it('should return success when DM succeeds', async () => {
            const result = await sender.sendCommentReply(privateOptions);

            expect(result).toEqual({ success: true });
        });

        it('should fall back to public reply when fromId is missing', async () => {
            const result = await sender.sendCommentReply({
                ...privateOptions,
                fromId: undefined,
            });

            // private_replies uses comment ID not fromId, so it still works
            expect(result).toEqual({ success: true });
        });

        it('should fall back to public reply when DM throws', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(
                new Error('DM blocked')
            );

            const result = await sender.sendCommentReply(privateOptions);

            // Falls back to public reply which succeeds (axios.post is mocked to succeed)
            expect(result).toEqual({ success: true });
        });
    });

    // ─── Dual Mode ───────────────────────────────────────────────────

    describe('Dual Mode', () => {
        const dualOptions = {
            ...baseOptions,
            replyMode: 'dual' as const,
            dualReplyNudge: 'تحقق من رسائلك!',
        };

        it('should send DM first, then post public nudge', async () => {
            await sender.sendCommentReply(dualOptions);

            expect(facebookService.sendPrivateReplyToComment).toHaveBeenCalledWith(
                'access_token_abc',
                'fb_comment_123',
                'Thank you for your feedback!'
            );
            expect(axios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'تحقق من رسائلك!' },
                { params: { access_token: 'access_token_abc' } }
            );
        });

        it('should use nudge text (not full reply) for public comment', async () => {
            await sender.sendCommentReply(dualOptions);

            const axiosCall = vi.mocked(axios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({ message: 'تحقق من رسائلك!' });
        });

        it('should return success when both DM and public succeed', async () => {
            const result = await sender.sendCommentReply(dualOptions);

            expect(result).toEqual({ success: true });
        });

        it('should still work when fromId is missing (uses comment ID)', async () => {
            const result = await sender.sendCommentReply({
                ...dualOptions,
                fromId: undefined,
            });

            // private_replies uses comment ID not fromId, so it still works
            expect(result).toEqual({ success: true });
        });

        it('should fall back to full public reply when DM fails', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(
                new Error('DM blocked')
            );

            const result = await sender.sendCommentReply(dualOptions);

            // DM failed, dual mode falls back to public reply with full text (not nudge)
            expect(result.success).toBe(true);
            // Public reply was posted with full reply text, not the nudge
            const axiosCall = vi.mocked(axios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({ message: 'Thank you for your feedback!' });
        });

        it('should log warning when public reply fails in dual mode', async () => {
            vi.mocked(axios.post).mockRejectedValue(new Error('API error'));

            await sender.sendCommentReply(dualOptions);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Dual mode: Public reply failed',
                { commentId: 'fb_comment_123' }
            );
        });
    });

    // ─── Nudge text (tested via dual mode) ─────────────────────────

    describe('Nudge text in dual mode', () => {
        const dualBase = {
            ...baseOptions,
            replyMode: 'dual' as const,
        };

        it('should use provided nudge text', async () => {
            await sender.sendCommentReply({
                ...dualBase,
                dualReplyNudge: 'راجع الرسائل',
            });

            const axiosCall = vi.mocked(axios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({ message: 'راجع الرسائل' });
        });

        it('should use i18n default when no nudge provided', async () => {
            await sender.sendCommentReply(dualBase);

            const axiosCall = vi.mocked(axios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({
                message: 'أرسلنا لك التفاصيل برسالة خاصة 📩',
            });
        });

        // Note: truncation is handled by pickNudgeVariation() in nudge.ts, not sender
    });

    // ─── postPublicReply Direct ──────────────────────────────────────

    describe('postPublicReply', () => {
        it('should return true on success', async () => {
            const result = await sender.postPublicReply(
                'comment_123',
                'Hello!',
                'token_abc'
            );

            expect(result).toBe(true);
        });

        it('should return false and log error on failure', async () => {
            vi.mocked(axios.post).mockRejectedValue(new Error('API down'));

            const result = await sender.postPublicReply(
                'comment_123',
                'Hello!',
                'token_abc'
            );

            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to post reply to Facebook',
                expect.objectContaining({ commentId: 'comment_123' })
            );
        });
    });
});
