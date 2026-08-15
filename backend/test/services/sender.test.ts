import { describe, it, expect, vi, beforeEach } from 'vitest';
import { facebookService } from '../../src/services/facebook';
import { fbAxios } from '../../src/lib/fbAxios';
import { classifyTokenFailure } from '../../src/services/pageTokenRecovery';
import { detectLanguageCode } from '../../src/utils/language';
import { DmSendError } from '../../src/utils/fbGraphErrors';
import { sendMetaImageAttachment } from '../../src/services/metaMessaging';

vi.mock('../../src/lib/fbAxios');
vi.mock('../../src/services/facebook');
vi.mock('../../src/services/metaMessaging');
vi.mock('../../src/utils/language');
vi.mock('../../src/services/reply/commentMentionGuard', () => ({
    commentMentionGuard: { mentionPlan: vi.fn(), verifyAndRepair: vi.fn(), setLogger: vi.fn() },
}));
vi.mock('../../src/config', () => ({
    config: {
        facebook: { graphApiVersion: 'v18.0' },
    },
}));

// Stub Redis directly (rather than relying on config.redis) — the import chain
// reply/adapters/shared → messages → conversationPause loads lib/redis which
// would otherwise instantiate a real client at module load.
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), setex: vi.fn(), set: vi.fn(), del: vi.fn() },
    redisScanDelete: vi.fn(),
    isRedisAuthFailed: () => false,
}));

// Import after mocks are set up
import { ReplySender } from '../../src/services/reply/sender';
import { commentMentionGuard } from '../../src/services/reply/commentMentionGuard';

// Helpers: build DmSendErrors that classify into each bucket.
const makeCustomerRefusedError = () => new DmSendError('blocked', { code: 10, subcode: 2534014 });
const makeWindowExpiredError = () => new DmSendError('window expired', { code: 10, subcode: 2018278 });
const makeOurFaultError = () => new DmSendError('bad token', { code: 190 });
const makeTransientError = () => new DmSendError('rate limit', { code: 613 });
const makeUnknownError = () => new DmSendError('huh', { code: 99999 });

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
        vi.mocked(fbAxios.post).mockResolvedValue({ data: { id: 'reply_id' } });
        vi.mocked(facebookService.sendPrivateReplyToComment).mockResolvedValue({ recipientId: 'user_456' });
        vi.mocked(facebookService.sendPrivateReplyWithImage).mockResolvedValue({ recipientId: 'user_456', format: 'card' });
        vi.mocked(sendMetaImageAttachment).mockResolvedValue('img_msg_id');
    });

    // ─── Image delivery — ONE message on a cold comment→DM (Meta allows only one) ──
    // The image rides the SAME private reply as the text (card or text+button), because a
    // second follow-up message is rejected until the customer replies. See sendPrivateReplyWithImage.
    describe('Image delivery', () => {
        it('public mode: an attached image is NEVER sent (image stays private to the DM channel)', async () => {
            const result = await sender.sendCommentReply({ ...baseOptions, replyMode: 'public', replyImageUrl: 'https://cdn/x.jpg' });
            expect(facebookService.sendPrivateReplyWithImage).not.toHaveBeenCalled();
            // Public mode still posts the text reply as a public comment (via fbAxios).
            expect(fbAxios.post).toHaveBeenCalled();
            expect(result.imageDelivered).toBeFalsy();
        });

        it('private mode with an image: delivers text + image in ONE private reply (no separate image message)', async () => {
            const result = await sender.sendCommentReply({ ...baseOptions, replyMode: 'private', replyImageUrl: 'https://cdn/x.jpg' });
            expect(facebookService.sendPrivateReplyWithImage).toHaveBeenCalledWith(
                'access_token_abc', 'fb_comment_123', 'Thank you for your feedback!', 'https://cdn/x.jpg', null, undefined, undefined,
            );
            // The doomed second-message image send is never used on this path anymore.
            expect(sendMetaImageAttachment).not.toHaveBeenCalled();
            expect(facebookService.sendPrivateReplyToComment).not.toHaveBeenCalled();
            expect(result).toMatchObject({ success: true, dmRecipientId: 'user_456', imageDelivered: true });
        });

        it('image reply failure (non-transient): falls back to a plain-text reply, imageDelivered=false, no throw', async () => {
            vi.mocked(facebookService.sendPrivateReplyWithImage).mockRejectedValueOnce(makeUnknownError());
            const result = await sender.sendCommentReply({ ...baseOptions, replyMode: 'private', replyImageUrl: 'https://cdn/x.jpg' });
            // Fallback: the customer still gets the text.
            expect(facebookService.sendPrivateReplyToComment).toHaveBeenCalledWith(
                'access_token_abc', 'fb_comment_123', 'Thank you for your feedback!', undefined,
            );
            expect(result).toMatchObject({ success: true, dmRecipientId: 'user_456', imageDelivered: false });
        });

        it('image reply failure (transient): rethrows so the whole job retries (no text fallback, no partial send)', async () => {
            vi.mocked(facebookService.sendPrivateReplyWithImage).mockRejectedValueOnce(makeTransientError());
            await expect(
                sender.sendCommentReply({ ...baseOptions, replyMode: 'private', replyImageUrl: 'https://cdn/x.jpg' }),
            ).rejects.toThrow();
            // Never fall back to text on a transient error — the whole job retries instead.
            expect(facebookService.sendPrivateReplyToComment).not.toHaveBeenCalled();
        });

        // Regression: without this the card embeds the raw storage URL, which 404s for every
        // past recipient the moment the merchant replaces or clears the Post Reply image.
        it('forwards the stable image view link to the card', async () => {
            await sender.sendCommentReply({
                ...baseOptions,
                replyMode: 'private',
                replyImageUrl: 'https://cdn/x.jpg',
                imageViewUrl: 'https://jawab24.com/api/post-reply-image/facebook/post-1',
            });
            expect(facebookService.sendPrivateReplyWithImage).toHaveBeenCalledWith(
                'access_token_abc', 'fb_comment_123', 'Thank you for your feedback!', 'https://cdn/x.jpg', null, undefined,
                'https://jawab24.com/api/post-reply-image/facebook/post-1',
            );
        });

        it('no image: uses the plain-text DM path (no image reply)', async () => {
            await sender.sendCommentReply({ ...baseOptions, replyMode: 'private' });
            expect(facebookService.sendPrivateReplyToComment).toHaveBeenCalled();
            expect(facebookService.sendPrivateReplyWithImage).not.toHaveBeenCalled();
        });
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

            expect(fbAxios.post).not.toHaveBeenCalled();
            expect(facebookService.sendPrivateReplyToComment).not.toHaveBeenCalled();
        });
    });

    // ─── Public Mode ─────────────────────────────────────────────────

    describe('Public Mode', () => {
        it('should call fbAxios.post with correct Graph API URL', async () => {
            await sender.sendCommentReply(baseOptions);

            expect(fbAxios.post).toHaveBeenCalledWith(
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
            vi.mocked(fbAxios.post).mockRejectedValue(new Error('Network error'));

            const result = await sender.sendCommentReply(baseOptions);

            expect(result).toMatchObject({
                success: false,
                error: 'Failed to post public reply to Facebook',
            });
            // A bare Error carries no Graph payload, so it classifies as `unknown`
            // rather than a token problem — the conservative direction.
            expect(result.publicFailure?.bucket).toBe('unknown');
            // Never `dmFailure`: no DM was attempted, and that field decides both the
            // inbox label and the auto-pause bucket.
            expect(result.dmFailure).toBeUndefined();
        });

        // ⛔ The regression that made the whole comment-path recovery inert.
        //
        // `public` is the DEFAULT comment mode (schema default, workspaceSettings
        // fallback, and the adapter's own `|| 'public'`). It was also the only mode
        // that swallowed the Graph error — so when a page token was revoked, the post
        // 400'd with code 190 and the result carried nothing recovery could classify.
        // The in-request re-mint shipped, was tested, and did nothing here.
        it('carries the Graph code/subcode of a REVOKED token, so recovery can classify it', async () => {
            const revoked = Object.assign(new Error('Request failed with status code 400'), {
                isAxiosError: true,
                response: {
                    status: 400,
                    data: { error: { message: 'Error validating access token', code: 190, error_subcode: 460, type: 'OAuthException' } },
                },
            });
            vi.mocked(fbAxios.post).mockRejectedValue(revoked);

            const result = await sender.sendCommentReply(baseOptions);

            expect(result.success).toBe(false);
            expect(result.publicFailure).toMatchObject({ code: 190, subcode: 460 });
            // The property that actually matters: the production predicate must read
            // this as the password-change case. Asserted through `classifyTokenFailure`
            // itself rather than by re-deriving it here (AI_INSTRUCTIONS §19.3).
            expect(classifyTokenFailure(result.publicFailure)).toBe('password_changed');
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
                'Thank you for your feedback!',
                undefined,
            );
        });

        it('should return success when DM succeeds', async () => {
            const result = await sender.sendCommentReply(privateOptions);

            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
            expect(result.dmRecipientId).toBe('user_456');
        });

        it('DM succeeds → no public comment is posted', async () => {
            await sender.sendCommentReply(privateOptions);
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        // Privacy-first: when DM fails, we DO NOT post the full reply publicly.
        // The reply was generated for DM (channel=dm) and may contain prices/offers.

        it('customer_refused → no public post, suppressedPublic, dmFailure populated', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeCustomerRefusedError());

            const result = await sender.sendCommentReply(privateOptions);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('customer_refused');
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('window_expired → no public post in private mode (nudge is dual-only)', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeWindowExpiredError());

            const result = await sender.sendCommentReply(privateOptions);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('window_expired');
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('our_fault → no public post, dmFailure populated', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeOurFaultError());

            const result = await sender.sendCommentReply(privateOptions);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('our_fault');
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('transient → rethrows so BullMQ retries the job', async () => {
            const err = makeTransientError();
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(err);

            await expect(sender.sendCommentReply(privateOptions)).rejects.toBe(err);
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('unknown bucket → no public post (safe default)', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeUnknownError());

            const result = await sender.sendCommentReply(privateOptions);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('unknown');
            expect(fbAxios.post).not.toHaveBeenCalled();
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
                'Thank you for your feedback!',
                undefined,
            );
            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'تحقق من رسائلك!' },
                { params: { access_token: 'access_token_abc' } }
            );
        });

        it('should use nudge text (not full reply) for public comment', async () => {
            await sender.sendCommentReply(dualOptions);

            const axiosCall = vi.mocked(fbAxios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({ message: 'تحقق من رسائلك!' });
        });

        // Dual is the common merchant config, and its success return is a SEPARATE code
        // path from private mode — imageDelivered must survive it or the "image attached"
        // badge silently dies for dual-mode merchants while every other test stays green.
        it('dual mode with an image: image+text in ONE private reply → public nudge, and imageDelivered survives the dual return', async () => {
            const result = await sender.sendCommentReply({ ...dualOptions, replyImageUrl: 'https://cdn/x.jpg' });

            expect(facebookService.sendPrivateReplyWithImage).toHaveBeenCalledWith(
                'access_token_abc', 'fb_comment_123', 'Thank you for your feedback!', 'https://cdn/x.jpg', null, undefined, undefined,
            );
            expect(sendMetaImageAttachment).not.toHaveBeenCalled();
            // The public nudge carries the nudge text only — never the image.
            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'تحقق من رسائلك!' },
                { params: { access_token: 'access_token_abc' } },
            );
            expect(result).toMatchObject({ success: true, dmRecipientId: 'user_456', imageDelivered: true });
        });

        it('should return success when both DM and public succeed', async () => {
            const result = await sender.sendCommentReply(dualOptions);

            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
            expect(result.dmRecipientId).toBe('user_456');
        });

        it('should still work when fromId is missing (uses comment ID)', async () => {
            const result = await sender.sendCommentReply({
                ...dualOptions,
                fromId: undefined,
            });

            // private_replies uses comment ID not fromId, so it still works
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        // Privacy-first dual-mode fallback: full reply NEVER appears publicly on DM failure.
        // The only public post on failure is the short nudge, and only for window_expired.

        it('customer_refused → no public post, suppressedPublic, dmFailure populated', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeCustomerRefusedError());

            const result = await sender.sendCommentReply(dualOptions);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('customer_refused');
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('window_expired → posts nudge only (never the full reply)', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeWindowExpiredError());

            const result = await sender.sendCommentReply(dualOptions);

            expect(result.success).toBe(false);
            expect(result.dmFailure?.bucket).toBe('window_expired');
            // The nudge string was posted publicly — not the DM text
            const axiosCall = vi.mocked(fbAxios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({ message: 'تحقق من رسائلك!' });
            // Counter-assertion: full reply never appears publicly
            expect(axiosCall[1]).not.toEqual({ message: dualOptions.replyText });
        });

        it('window_expired without a dualReplyNudge → no public post (safer than posting default)', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeWindowExpiredError());

            const result = await sender.sendCommentReply({ ...dualOptions, dualReplyNudge: undefined });

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('our_fault → no public post (merchant integration issue)', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeOurFaultError());

            const result = await sender.sendCommentReply(dualOptions);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('our_fault');
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('transient → rethrows so BullMQ retries', async () => {
            const err = makeTransientError();
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(err);

            await expect(sender.sendCommentReply(dualOptions)).rejects.toBe(err);
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('unknown bucket → no public post (safe default)', async () => {
            vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(makeUnknownError());

            const result = await sender.sendCommentReply(dualOptions);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('REGRESSION GUARD: full replyText never appears in any public post call across all failure buckets', async () => {
            const buckets = [
                makeCustomerRefusedError(),
                makeWindowExpiredError(),
                makeOurFaultError(),
                makeUnknownError(),
            ];
            for (const err of buckets) {
                vi.mocked(fbAxios.post).mockClear();
                vi.mocked(facebookService.sendPrivateReplyToComment).mockRejectedValue(err);
                await sender.sendCommentReply(dualOptions).catch(() => void 0);
                for (const call of vi.mocked(fbAxios.post).mock.calls) {
                    const body = call[1] as { message?: string } | undefined;
                    expect(body?.message).not.toBe(dualOptions.replyText);
                }
            }
        });

        it('should log warning when nudge post fails (happy-path DM succeeded)', async () => {
            vi.mocked(fbAxios.post).mockRejectedValue(new Error('API error'));

            await sender.sendCommentReply(dualOptions);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                '[Sender] Dual mode: nudge post failed',
                { facebookCommentId: 'fb_comment_123' }
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

            const axiosCall = vi.mocked(fbAxios.post).mock.calls[0];
            expect(axiosCall[1]).toEqual({ message: 'راجع الرسائل' });
        });

        it('should use i18n default when no nudge provided', async () => {
            await sender.sendCommentReply(dualBase);

            const axiosCall = vi.mocked(fbAxios.post).mock.calls[0];
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

            // Returns the created comment's id — the mention path needs it to read the
            // result back; callers that only want success check it against null.
            expect(result).toBe('reply_id');
        });

        it('should return false and log error on failure', async () => {
            vi.mocked(fbAxios.post).mockRejectedValue(new Error('API down'));

            const result = await sender.postPublicReply(
                'comment_123',
                'Hello!',
                'token_abc'
            );

            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to post reply to Facebook',
                expect.objectContaining({ commentId: 'comment_123' })
            );
        });
    });

    // ─── Post Reply "mention the commenter" (tagCommenter) ────────────────────────
    // The mention rides the PUBLIC comment only — the DM already reaches the customer.
    // Meta renders `@[PSID]` for someone who commented on the post; when the page forbids
    // tagging it stays literal, which is what the guard repairs.
    describe('Mention the commenter', () => {
        const taggedOptions = {
            ...baseOptions,
            fromId: '1784123456789',
            platformPageId: '878802365317875',
            tagCommenter: true,
        };

        beforeEach(() => {
            vi.mocked(commentMentionGuard.mentionPlan).mockResolvedValue('verify');
            vi.mocked(commentMentionGuard.verifyAndRepair).mockResolvedValue({ rendered: true });
        });

        it('prefixes the public reply with the mention token', async () => {
            await sender.sendCommentReply({ ...taggedOptions, replyMode: 'public' });

            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: '@[1784123456789] Thank you for your feedback!' },
                expect.anything(),
            );
        });

        it('tags the dual-mode nudge, not the DM', async () => {
            await sender.sendCommentReply({
                ...taggedOptions, replyMode: 'dual', dualReplyNudge: 'شيّك الخاص',
            });

            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: '@[1784123456789] شيّك الخاص' },
                expect.anything(),
            );
            // The private reply text is untouched — no mention syntax inside a DM.
            expect(facebookService.sendPrivateReplyToComment).toHaveBeenCalledWith(
                'access_token_abc', 'fb_comment_123', 'Thank you for your feedback!', undefined,
            );
        });

        it('verifies the posted comment against the UNTAGGED text (the repair text)', async () => {
            await sender.sendCommentReply({ ...taggedOptions, replyMode: 'public' });

            expect(commentMentionGuard.verifyAndRepair).toHaveBeenCalledWith(
                expect.objectContaining({
                    postedCommentId: 'reply_id',
                    pageId: '878802365317875',
                    psid: '1784123456789',
                    plainText: 'Thank you for your feedback!',
                }),
            );
        });

        it('posts untagged on a page already known to reject mentions', async () => {
            vi.mocked(commentMentionGuard.mentionPlan).mockResolvedValue('skip');

            await sender.sendCommentReply({ ...taggedOptions, replyMode: 'public' });

            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'Thank you for your feedback!' },
                expect.anything(),
            );
            expect(commentMentionGuard.verifyAndRepair).not.toHaveBeenCalled();
        });

        it('posts untagged when the option is off (every non-Post-Reply comment)', async () => {
            await sender.sendCommentReply({ ...taggedOptions, tagCommenter: false, replyMode: 'public' });

            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'Thank you for your feedback!' },
                expect.anything(),
            );
            expect(commentMentionGuard.mentionPlan).not.toHaveBeenCalled();
        });

        // The efficiency fix: a page proven to render mentions skips the read-back entirely.
        it('tags WITHOUT verifying on a page already proven to render mentions', async () => {
            vi.mocked(commentMentionGuard.mentionPlan).mockResolvedValue('trust');

            await sender.sendCommentReply({ ...taggedOptions, replyMode: 'public' });

            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: '@[1784123456789] Thank you for your feedback!' },
                expect.anything(),
            );
            expect(commentMentionGuard.verifyAndRepair).not.toHaveBeenCalled();
        });

        // Without a page id there is no memo to key and no page to blame — degrade quietly.
        it('posts untagged when the page id is missing', async () => {
            await sender.sendCommentReply({ ...taggedOptions, platformPageId: undefined, replyMode: 'public' });

            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'Thank you for your feedback!' },
                expect.anything(),
            );
            expect(commentMentionGuard.mentionPlan).not.toHaveBeenCalled();
        });

        // Graph answered 200 but without an id: the comment IS posted, so this must read as
        // success — not a failed send that BullMQ would retry into a duplicate comment.
        it('counts as success when Graph returns no comment id (nothing to verify)', async () => {
            vi.mocked(fbAxios.post).mockResolvedValue({ data: {} });

            const result = await sender.sendCommentReply({ ...taggedOptions, replyMode: 'public' });

            expect(result.success).toBe(true);
            expect(commentMentionGuard.verifyAndRepair).not.toHaveBeenCalled();
        });

        // An unusable id must degrade to a normal reply — never to raw text in public.
        it('posts untagged when the commenter id is not a PSID', async () => {
            await sender.sendCommentReply({ ...taggedOptions, fromId: 'user_456', replyMode: 'public' });

            expect(fbAxios.post).toHaveBeenCalledWith(
                `${GRAPH_API}/fb_comment_123/comments`,
                { message: 'Thank you for your feedback!' },
                expect.anything(),
            );
        });
    });
});
