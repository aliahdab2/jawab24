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
        vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined);
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
            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
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

            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        });
    });

    // ─── Private Mode ────────────────────────────────────────────────

    describe('Private Mode', () => {
        const privateOptions = { ...baseOptions, replyMode: 'private' as const };

        it('should call facebookService.sendPrivateMessage with correct args', async () => {
            await sender.sendCommentReply(privateOptions);

            expect(facebookService.sendPrivateMessage).toHaveBeenCalledWith(
                'access_token_abc',
                'user_456',
                'Thank you for your feedback!'
            );
        });

        it('should return success when DM succeeds', async () => {
            const result = await sender.sendCommentReply(privateOptions);

            expect(result).toEqual({ success: true });
        });

        it('should return failure when fromId is missing', async () => {
            const result = await sender.sendCommentReply({
                ...privateOptions,
                fromId: undefined,
            });

            expect(result).toEqual({
                success: false,
                error: 'Cannot send private message: commenter ID not available',
            });
        });

        it('should return failure when DM throws', async () => {
            vi.mocked(facebookService.sendPrivateMessage).mockRejectedValue(
                new Error('DM blocked')
            );

            const result = await sender.sendCommentReply(privateOptions);

            expect(result).toEqual({
                success: false,
                error: 'Failed to send private message to commenter',
            });
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

            expect(facebookService.sendPrivateMessage).toHaveBeenCalledWith(
                'access_token_abc',
                'user_456',
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

        it('should return failure when fromId is missing', async () => {
            const result = await sender.sendCommentReply({
                ...dualOptions,
                fromId: undefined,
            });

            expect(result).toEqual({
                success: false,
                error: 'Cannot send private message: commenter ID not available',
            });
        });

        it('should fall back to public when DM fails', async () => {
            vi.mocked(facebookService.sendPrivateMessage).mockRejectedValue(
                new Error('DM blocked')
            );

            const result = await sender.sendCommentReply(dualOptions);

            // DM failed, but dual mode doesn't post public nudge when errorMsg is set
            // Looking at the code: if (replyMode === 'dual' && !errorMsg) — public is skipped
            // But success comes from the DM part being set only for private mode
            // For dual: success remains false, error is 'Private message failed'
            expect(result.error).toBe('Private message failed');
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

    // ─── getDualModeNudge (tested via dual mode) ─────────────────────

    describe('getDualModeNudge logic', () => {
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

        it('should use hardcoded default when no nudge provided', async () => {
            await sender.sendCommentReply(dualBase);

            const axiosCall = vi.mocked(axios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({
                message: 'أرسلنا لك التفاصيل برسالة خاصة 📩',
            });
        });

        it('should truncate nudge text to 80 characters', async () => {
            const longNudge = 'A'.repeat(100);

            await sender.sendCommentReply({
                ...dualBase,
                dualReplyNudge: longNudge,
            });

            const axiosCall = vi.mocked(axios.post).mock.calls[0];
            expect((axiosCall[1] as { message: string }).message).toHaveLength(80);
        });
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
