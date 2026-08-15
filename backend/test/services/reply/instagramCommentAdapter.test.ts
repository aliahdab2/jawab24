import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DmSendError } from '../../../src/utils/fbGraphErrors';
import { classifyTokenFailure } from '../../../src/services/pageTokenRecovery';

// Mock dependencies
const mockGetPageByInstagramId = vi.fn();
vi.mock('../../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: (...args: unknown[]) => mockGetPageByInstagramId(...args),
    },
}));

const mockReplyToComment = vi.fn();
const mockSendDirectMessage = vi.fn();
const mockSendMetaImageAttachment = vi.fn();
vi.mock('../../../src/services/instagram', () => ({
    instagramService: {
        replyToComment: (...args: unknown[]) => mockReplyToComment(...args),
        sendDirectMessage: (...args: unknown[]) => mockSendDirectMessage(...args),
    },
}));
vi.mock('../../../src/services/metaMessaging', () => ({
    sendMetaImageAttachment: (...args: unknown[]) => mockSendMetaImageAttachment(...args),
}));
vi.mock('../../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// Mock DB for direct operations — capture .set() arguments for assertions
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbSetArgs = vi.fn();
const mockDbUpdateWhere = vi.fn();
vi.mock('../../../src/db', () => ({
    db: {
        select: () => ({ from: () => ({ where: mockDbSelect }) }),
        insert: () => ({ values: (v: unknown) => ({ returning: mockDbInsert }) }),
        update: () => ({
            set: (...args: unknown[]) => {
                mockDbSetArgs(...args);
                return { where: mockDbUpdateWhere };
            },
        }),
    },
}));

vi.mock('../../../src/db/schema', () => ({
    instagramMedia: {
        id: 'id',
        instagramMediaId: 'instagram_media_id',
        pageId: 'page_id',
        caption: 'caption',
        autoReplyEnabled: 'auto_reply_enabled',
    },
    instagramComments: {
        id: 'id',
        instagramCommentId: 'instagram_comment_id',
        mediaId: 'media_id',
        message: 'message',
        replied: 'replied',
        needsAttention: 'needs_attention',
        flagReason: 'flag_reason',
        aiIntent: 'ai_intent',
        detectedLanguage: 'detected_language',
        replyText: 'reply_text',
        replyMethod: 'reply_method',
        repliedAt: 'replied_at',
        updatedAt: 'updated_at',
        fromId: 'from_id',
        fromUsername: 'from_username',
        createdTime: 'created_time',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((_col: unknown, val: unknown) => val),
}));

import { InstagramCommentAdapter } from '../../../src/services/reply/adapters/instagramCommentAdapter';
import { pageLinkedInstagramCredential } from '../../../src/services/instagramCredential';
import { GRAPH_API_BASE as BASE } from '../../../src/lib/fbAxios';

describe('InstagramCommentAdapter', () => {
    let adapter: InstagramCommentAdapter;

    const mockPage = {
        id: 'page_uuid_1',
        userId: 'user_uuid_1',
        name: 'IG Business Page',
        accessToken: 'ig_token_abc',
        knowledgeBase: 'KB for IG',
        kbActiveVersion: 1,
        instagramAutoReplyEnabled: true,
        ecommerceStoreId: null,
        businessProfile: { category: 'retail' },
    };

    beforeEach(() => {
        adapter = new InstagramCommentAdapter();
        vi.clearAllMocks();
    });

    describe('platform', () => {
        it('should identify as instagram', () => {
            expect(adapter.platform).toBe('instagram');
        });
    });

    describe('getPage', () => {
        it('should return normalized PlatformPage for existing IG account', async () => {
            mockGetPageByInstagramId.mockResolvedValue(mockPage);

            const result = await adapter.getPage('ig_account_123');

            expect(result).not.toBeNull();
            expect(result!.id).toBe('page_uuid_1');
            expect(result!.userId).toBe('user_uuid_1');
            expect(result!.name).toBe('IG Business Page');
            expect(result!.accessToken).toBe('ig_token_abc');
            expect(result!.autoReplyEnabled).toBe(true);
        });

        it('should return null when IG account not found', async () => {
            mockGetPageByInstagramId.mockResolvedValue(null);

            const result = await adapter.getPage('nonexistent_ig');

            expect(result).toBeNull();
        });

        it('should use instagramAutoReplyEnabled for autoReplyEnabled', async () => {
            mockGetPageByInstagramId.mockResolvedValue({
                ...mockPage,
                instagramAutoReplyEnabled: false,
            });

            const result = await adapter.getPage('ig_account_123');

            expect(result!.autoReplyEnabled).toBe(false);
        });

        it('should default autoReplyEnabled to true when undefined', async () => {
            mockGetPageByInstagramId.mockResolvedValue({
                ...mockPage,
                instagramAutoReplyEnabled: undefined,
            });

            const result = await adapter.getPage('ig_account_123');

            expect(result!.autoReplyEnabled).toBe(true);
        });
    });

    describe('findOrCreateContent', () => {
        it('should return existing media when found', async () => {
            mockDbSelect.mockResolvedValue([{
                id: 'media_uuid_1',
                autoReplyEnabled: true,
                caption: 'Check this out!',
            }]);

            const result = await adapter.findOrCreateContent('page_uuid_1', 'ig_media_123');

            expect(result.id).toBe('media_uuid_1');
            expect(result.autoReplyEnabled).toBe(true);
            expect(result.message).toBe('Check this out!');
        });

        it('should create new media when not found', async () => {
            mockDbSelect.mockResolvedValue([]);
            mockDbInsert.mockResolvedValue([{
                id: 'media_uuid_new',
                autoReplyEnabled: true,
                caption: null,
            }]);

            const result = await adapter.findOrCreateContent('page_uuid_1', 'ig_media_456');

            expect(result.id).toBe('media_uuid_new');
            expect(result.autoReplyEnabled).toBe(true);
            expect(result.message).toBeNull();
        });

        it('should default autoReplyEnabled to true for new media', async () => {
            mockDbSelect.mockResolvedValue([]);
            mockDbInsert.mockResolvedValue([{
                id: 'media_uuid_new',
                autoReplyEnabled: true,
                caption: null,
            }]);

            const result = await adapter.findOrCreateContent('page_uuid_1', 'ig_media_789');

            expect(result.autoReplyEnabled).toBe(true);
        });
    });

    describe('storeComment', () => {
        it('should return existing comment with isNew=false', async () => {
            mockDbSelect.mockResolvedValue([{
                id: 'igc_uuid_1',
                replied: true,
                needsAttention: false,
            }]);

            const result = await adapter.storeComment(
                'media_uuid_1', 'ig_comment_123', 'Nice!', 'user_1', 'johndoe',
            );

            expect(result.isNew).toBe(false);
            expect(result.comment.id).toBe('igc_uuid_1');
            expect(result.comment.replied).toBe(true);
        });

        it('should create new comment with isNew=true', async () => {
            mockDbSelect.mockResolvedValue([]);
            mockDbInsert.mockResolvedValue([{
                id: 'igc_uuid_new',
                replied: false,
            }]);

            const result = await adapter.storeComment(
                'media_uuid_1', 'ig_comment_456', 'Beautiful!', 'user_2', 'janedoe',
            );

            expect(result.isNew).toBe(true);
            expect(result.comment.id).toBe('igc_uuid_new');
            expect(result.comment.replied).toBe(false);
        });

        it('should handle missing fromId and fromUsername', async () => {
            mockDbSelect.mockResolvedValue([]);
            mockDbInsert.mockResolvedValue([{
                id: 'igc_uuid_new',
                replied: false,
            }]);

            const result = await adapter.storeComment(
                'media_uuid_1', 'ig_comment_789', 'Hello',
            );

            expect(result.isNew).toBe(true);
            expect(result.comment.id).toBe('igc_uuid_new');
        });
    });

    describe('sendReply', () => {
        it('should call instagramService.replyToComment and return success', async () => {
            mockReplyToComment.mockResolvedValue('reply_id_123');

            const result = await adapter.sendReply({
                platformCommentId: 'ig_comment_123',
                platformPageId: 'ig_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Nice product!',
                accessToken: 'ig_token_abc',
                userSettings: {},
            });

            expect(result.success).toBe(true);
            expect(mockReplyToComment).toHaveBeenCalledWith(
                'ig_comment_123', 'Thank you!', pageLinkedInstagramCredential('ig_token_abc'),
            );
        });

        // Instagram mentions are `@username` — a different syntax and a different id space —
        // so the Facebook-only flag must be inert here. If it ever leaked through, we would
        // post `@[<psid>]` as literal text on an IG comment, in front of customers.
        it('ignores tagCommenter entirely — the reply text is untouched', async () => {
            mockReplyToComment.mockResolvedValue('reply_id_123');

            await adapter.sendReply({
                platformCommentId: 'ig_comment_123',
                platformPageId: 'ig_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Nice product!',
                accessToken: 'ig_token_abc',
                fromId: '1784123456789',
                tagCommenter: true,
                userSettings: {},
            });

            expect(mockReplyToComment).toHaveBeenCalledWith(
                'ig_comment_123', 'Thank you!', pageLinkedInstagramCredential('ig_token_abc'),
            );
        });

        it('should return error on Instagram API failure', async () => {
            mockReplyToComment.mockRejectedValue(new Error('Instagram API rate limit'));

            const result = await adapter.sendReply({
                platformCommentId: 'ig_comment_123',
                platformPageId: 'ig_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Nice!',
                accessToken: 'ig_token_abc',
                userSettings: {},
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to post reply to Instagram');
            expect(result.error).toContain('Instagram API rate limit');
        });

        it('should handle non-Error thrown values', async () => {
            mockReplyToComment.mockRejectedValue('unknown error string');

            const result = await adapter.sendReply({
                platformCommentId: 'ig_comment_123',
                platformPageId: 'ig_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Nice!',
                accessToken: 'ig_token_abc',
                userSettings: {},
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('unknown error string');
        });
    });

    describe('markAsReplied', () => {
        it('should update instagram comment with correct fields', async () => {
            mockDbUpdateWhere.mockResolvedValue(undefined);

            await adapter.markAsReplied(
                'igc_uuid_1', 'Thank you!', 'ai', 'en', false, undefined, 'positive',
            );

            expect(mockDbUpdateWhere).toHaveBeenCalledTimes(1);
            // Verify the .set() payload
            expect(mockDbSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    replied: true,
                    replyText: 'Thank you!',
                    replyMethod: 'ai',
                    detectedLanguage: 'en',
                    needsAttention: false,
                    flagReason: null,
                    aiIntent: 'positive',
                    repliedAt: expect.any(Date),
                    updatedAt: expect.any(Date),
                }),
            );
        });

        it('should default needsAttention to false and flagReason/aiIntent to null', async () => {
            mockDbUpdateWhere.mockResolvedValue(undefined);

            await adapter.markAsReplied(
                'igc_uuid_1', 'Thanks!', 'template', 'ar',
            );

            expect(mockDbSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    replied: true,
                    replyText: 'Thanks!',
                    replyMethod: 'template',
                    detectedLanguage: 'ar',
                    needsAttention: false,
                    flagReason: null,
                    aiIntent: null,
                }),
            );
        });
    });

    describe('flagComment', () => {
        it('should set needsAttention=true with flagReason and aiIntent', async () => {
            mockDbUpdateWhere.mockResolvedValue(undefined);

            await adapter.flagComment('igc_uuid_1', 'offensive', 'OFFENSIVE');

            expect(mockDbUpdateWhere).toHaveBeenCalledTimes(1);
            expect(mockDbSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    needsAttention: true,
                    flagReason: 'offensive',
                    aiIntent: 'OFFENSIVE',
                    updatedAt: expect.any(Date),
                }),
            );
        });

        it('should default flagReason and aiIntent to null when missing', async () => {
            mockDbUpdateWhere.mockResolvedValue(undefined);

            await adapter.flagComment('igc_uuid_1');

            expect(mockDbSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    needsAttention: true,
                    flagReason: null,
                    aiIntent: null,
                }),
            );
        });
    });

    describe('buildGeneratorContext', () => {
        it('should build context without postId and accessToken', () => {
            const page = {
                id: 'page_uuid_1',
                userId: 'user_uuid_1',
                name: 'IG Page',
                accessToken: 'ig_token',
                knowledgeBase: 'KB content',
                kbActiveVersion: 1,
                autoReplyEnabled: true,
                ecommerceStoreId: null,
                businessProfile: null,
            };
            const content = {
                id: 'media_uuid_1',
                autoReplyEnabled: true,
                message: 'Caption text',
            };

            const ctx = adapter.buildGeneratorContext(page, content, 'ig_media_123');

            expect(ctx.userId).toBe('user_uuid_1');
            expect(ctx.text).toBe('');
            expect(ctx.pageName).toBe('IG Page');
            expect(ctx.knowledgeBase).toBe('KB content');
            expect(ctx.postMessage).toBe('Caption text');
            expect(ctx.pageId).toBe('page_uuid_1');
            // Instagram doesn't include postId or accessToken in context
            expect(ctx.postId).toBeUndefined();
            expect(ctx.accessToken).toBeUndefined();
        });
    });

    describe('sendReply', () => {
        const baseOpts = {
            platformCommentId: 'ig-comment-1',
            platformPageId: 'ig-account-1',
            replyText: 'Full AI reply text',
            commentMessage: 'مرحبا',
            accessToken: 'token-123',
            fromId: 'sender-1',
            userSettings: {} as Record<string, unknown>,
        };

        beforeEach(() => {
            mockReplyToComment.mockResolvedValue('reply-id');
            mockSendDirectMessage.mockResolvedValue('msg-id');
            mockSendMetaImageAttachment.mockResolvedValue('img-msg-id');
        });

        // An Instagram LOGIN page reaches this adapter with its own credential on
        // the opts. Every send here — public reply, DM, image — must follow it to
        // graph.instagram.com; falling back to `opts.accessToken` alone would post
        // an Instagram User token to the Facebook host.
        describe('Instagram-direct (Instagram Login) page', () => {
            const directCred = {
                accessToken: 'ig-direct-token',
                baseUrl: 'https://graph.instagram.com/v23.0',
                direct: true,
            };
            const directOpts = { ...baseOpts, accessToken: 'ig-direct-token', instagramCredential: directCred };

            it('posts the public comment reply on the Instagram credential', async () => {
                await adapter.sendReply({ ...directOpts, userSettings: { commentReplyMode: 'public' } });

                expect(mockReplyToComment).toHaveBeenCalledWith('ig-comment-1', 'Full AI reply text', directCred);
            });

            it('sends the private DM and its image on the Instagram host', async () => {
                await adapter.sendReply({
                    ...directOpts,
                    replyImageUrl: 'https://cdn/x.jpg',
                    userSettings: { commentReplyMode: 'private' },
                });

                expect(mockSendDirectMessage).toHaveBeenCalledWith(
                    'ig-account-1', 'sender-1', 'Full AI reply text', directCred,
                );
                expect(mockSendMetaImageAttachment).toHaveBeenCalledWith(
                    'ig-direct-token', 'sender-1', 'https://cdn/x.jpg', undefined,
                    'https://graph.instagram.com/v23.0/ig-account-1/messages',
                );
            });

            // The page-token retry wrapper hands this method a freshly re-minted
            // FACEBOOK token when the stored one died, and the send must adopt it.
            // The credential snapshot predates the re-mint, so the HOST comes from
            // the credential and the TOKEN from opts — never the other way round.
            it('adopts a re-minted token from opts while keeping the resolved host', async () => {
                await adapter.sendReply({
                    ...directOpts,
                    accessToken: 'freshly-reminted',
                    userSettings: { commentReplyMode: 'public' },
                });

                expect(mockReplyToComment).toHaveBeenCalledWith(
                    'ig-comment-1', 'Full AI reply text',
                    { ...directCred, accessToken: 'freshly-reminted' },
                );
            });
        });

        it('public mode: replies on comment only', async () => {
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'public' } };
            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(true);
            expect(mockReplyToComment).toHaveBeenCalledWith('ig-comment-1', 'Full AI reply text', pageLinkedInstagramCredential('token-123'),);
            expect(mockSendDirectMessage).not.toHaveBeenCalled();
        });

        // ⛔ Instagram rides the SAME page token as Facebook (IG is columns on the
        // page row, not a separate credential), so one revoked session kills both.
        // But this branch used to return only a message string, so page-token
        // recovery had nothing to classify and never fired on Instagram's DEFAULT
        // comment mode — the identical defect the Facebook sender carried.
        it('public mode: a REVOKED token comes back classified, so recovery can act', async () => {
            mockReplyToComment.mockRejectedValue(
                new DmSendError('Instagram API error: Error validating access token', { code: 190, subcode: 460 }),
            );
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'public' } };

            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(result.publicFailure).toMatchObject({ code: 190, subcode: 460 });
            // The property that matters, asserted through the production predicate
            // rather than a re-derived expectation (AI_INSTRUCTIONS §19.3).
            expect(classifyTokenFailure(result.publicFailure)).toBe('password_changed');
            // Never `dmFailure`: no DM was attempted, and that field drives the inbox
            // label and the auto-pause bucket.
            expect(result.dmFailure).toBeUndefined();
        });

        it('public mode: a TRANSIENT failure is not mistaken for a dead credential', async () => {
            // The counterweight. Classifying is only safe if it still says "no" to a
            // blip — recovery CLEARS the stored token when it decides a credential is
            // gone, so a false positive takes a healthy page dark.
            mockReplyToComment.mockRejectedValue(
                new DmSendError('Instagram API error: upstream', { code: 190, subcode: 460, isTransport: true }),
            );
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'public' } };

            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(classifyTokenFailure(result.publicFailure)).toBeNull();
        });

        // Privacy invariant: an image must NEVER leave the DM channel. In public mode the
        // reply is a public comment, and the image is neither sent nor leaked.
        it('public mode: an attached image is NOT sent (no DM) — image stays private', async () => {
            const opts = { ...baseOpts, replyImageUrl: 'https://cdn/x.jpg', userSettings: { commentReplyMode: 'public' } };
            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(true);
            expect(mockReplyToComment).toHaveBeenCalledWith('ig-comment-1', 'Full AI reply text', pageLinkedInstagramCredential('token-123'),);
            expect(mockSendMetaImageAttachment).not.toHaveBeenCalled();
            expect(mockSendDirectMessage).not.toHaveBeenCalled();
        });

        it('private mode with an image: sends the text DM first, then the native image', async () => {
            const opts = { ...baseOpts, replyImageUrl: 'https://cdn/x.jpg', userSettings: { commentReplyMode: 'private' } };
            const result = await adapter.sendReply(opts);

            expect(result).toMatchObject({ success: true, imageDelivered: true });
            expect(mockSendDirectMessage).toHaveBeenCalledWith('ig-account-1', 'sender-1', 'Full AI reply text', pageLinkedInstagramCredential('token-123'),);
            expect(mockSendMetaImageAttachment).toHaveBeenCalledWith('token-123', 'sender-1', 'https://cdn/x.jpg', undefined, `${BASE}/me/messages`);
        });

        it('dual mode with an image: text DM + native image + public nudge (nudge carries NO image)', async () => {
            const opts = { ...baseOpts, replyImageUrl: 'https://cdn/x.jpg', userSettings: { commentReplyMode: 'dual' } };
            const result = await adapter.sendReply(opts);

            expect(result).toMatchObject({ success: true, imageDelivered: true });
            expect(mockSendDirectMessage).toHaveBeenCalledWith('ig-account-1', 'sender-1', 'Full AI reply text', pageLinkedInstagramCredential('token-123'),);
            expect(mockSendMetaImageAttachment).toHaveBeenCalledWith('token-123', 'sender-1', 'https://cdn/x.jpg', undefined, `${BASE}/me/messages`);
            // The public nudge is a plain text comment — never the image.
            expect(mockReplyToComment).toHaveBeenCalledWith('ig-comment-1', expect.not.stringContaining('Full AI reply'), pageLinkedInstagramCredential('token-123'),);
        });

        it('image send failure: the text DM still delivers, imageDelivered=false, no throw', async () => {
            mockSendMetaImageAttachment.mockRejectedValueOnce(new Error('image fetch failed'));
            const opts = { ...baseOpts, replyImageUrl: 'https://cdn/x.jpg', userSettings: { commentReplyMode: 'private' } };
            const result = await adapter.sendReply(opts);

            expect(result).toMatchObject({ success: true, imageDelivered: false });
            expect(mockSendDirectMessage).toHaveBeenCalled();
        });

        it('private mode: sends DM only', async () => {
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'private' } };
            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(true);
            expect(mockSendDirectMessage).toHaveBeenCalledWith('ig-account-1', 'sender-1', 'Full AI reply text', pageLinkedInstagramCredential('token-123'),);
            expect(mockReplyToComment).not.toHaveBeenCalled();
        });

        it('dual mode: sends DM + short public nudge', async () => {
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'dual' } };
            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(true);
            expect(mockSendDirectMessage).toHaveBeenCalledWith('ig-account-1', 'sender-1', 'Full AI reply text', pageLinkedInstagramCredential('token-123'),);
            // Public reply should be the nudge text, not the full reply
            expect(mockReplyToComment).toHaveBeenCalledWith('ig-comment-1', expect.not.stringContaining('Full AI reply'), pageLinkedInstagramCredential('token-123'),);
        });

        it('dual mode: uses custom nudge variation', async () => {
            const opts = {
                ...baseOpts,
                userSettings: {
                    commentReplyMode: 'dual',
                    dualReplyNudgeVariations: { ar: ['تم إرسال التفاصيل في رسالة خاصة'] },
                },
            };
            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(true);
            expect(mockReplyToComment).toHaveBeenCalledWith('ig-comment-1', 'تم إرسال التفاصيل في رسالة خاصة', pageLinkedInstagramCredential('token-123'),);
        });

        it('private mode: fails when fromId is missing', async () => {
            const opts = { ...baseOpts, fromId: undefined, userSettings: { commentReplyMode: 'private' } };
            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(result.error).toContain('commenter ID not available');
        });

        // Privacy-first dual-mode fallback: full reply NEVER appears publicly on DM failure.
        // The only public post on failure is the short nudge, and only for window_expired.

        it('dual mode: customer_refused (10/2534014) → no public post, dmFailure populated', async () => {
            const { DmSendError } = await import('../../../src/utils/fbGraphErrors');
            mockSendDirectMessage.mockRejectedValue(new DmSendError('blocked', { code: 10, subcode: 2534014 }));
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'dual' } };

            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('customer_refused');
            expect(mockReplyToComment).not.toHaveBeenCalled();
        });

        it('dual mode: window_expired (10/2018278) → posts nudge only (never full reply)', async () => {
            const { DmSendError } = await import('../../../src/utils/fbGraphErrors');
            mockSendDirectMessage.mockRejectedValue(new DmSendError('window', { code: 10, subcode: 2018278 }));
            const opts = {
                ...baseOpts,
                userSettings: {
                    commentReplyMode: 'dual',
                    dualReplyNudgeVariations: { ar: ['تم إرسال التفاصيل بالخاص'] },
                },
            };

            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(result.dmFailure?.bucket).toBe('window_expired');
            // Nudge posted — full reply NOT posted
            expect(mockReplyToComment).toHaveBeenCalledWith('ig-comment-1', 'تم إرسال التفاصيل بالخاص', pageLinkedInstagramCredential('token-123'),);
            expect(mockReplyToComment).not.toHaveBeenCalledWith('ig-comment-1', opts.replyText, 'token-123');
        });

        it('dual mode: our_fault (190 token) → no public post', async () => {
            const { DmSendError } = await import('../../../src/utils/fbGraphErrors');
            mockSendDirectMessage.mockRejectedValue(new DmSendError('bad token', { code: 190 }));
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'dual' } };

            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(result.dmFailure?.bucket).toBe('our_fault');
            expect(result.suppressedPublic).toBe(true);
            expect(mockReplyToComment).not.toHaveBeenCalled();
        });

        it('dual mode: transient (613 rate limit) → rethrows so BullMQ retries', async () => {
            const { DmSendError } = await import('../../../src/utils/fbGraphErrors');
            const err = new DmSendError('rate', { code: 613 });
            mockSendDirectMessage.mockRejectedValue(err);
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'dual' } };

            await expect(adapter.sendReply(opts)).rejects.toBe(err);
            expect(mockReplyToComment).not.toHaveBeenCalled();
        });

        it('dual mode: unknown bucket → no public post (safe default)', async () => {
            const { DmSendError } = await import('../../../src/utils/fbGraphErrors');
            mockSendDirectMessage.mockRejectedValue(new DmSendError('huh', { code: 99999 }));
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'dual' } };

            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(mockReplyToComment).not.toHaveBeenCalled();
        });

        it('private mode: DM fails → no public fallback (privacy-first)', async () => {
            const { DmSendError } = await import('../../../src/utils/fbGraphErrors');
            mockSendDirectMessage.mockRejectedValue(new DmSendError('blocked', { code: 10, subcode: 2534014 }));
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'private' } };

            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(false);
            expect(result.suppressedPublic).toBe(true);
            expect(result.dmFailure?.bucket).toBe('customer_refused');
            expect(mockReplyToComment).not.toHaveBeenCalled();
        });

        it('REGRESSION GUARD: full replyText never appears in any public post call across all failure buckets', async () => {
            const { DmSendError } = await import('../../../src/utils/fbGraphErrors');
            const buckets = [
                new DmSendError('blocked', { code: 10, subcode: 2534014 }),
                new DmSendError('window', { code: 10, subcode: 2018278 }),
                new DmSendError('bad token', { code: 190 }),
                new DmSendError('huh', { code: 99999 }),
            ];
            const opts = { ...baseOpts, userSettings: { commentReplyMode: 'dual' } };

            for (const err of buckets) {
                mockReplyToComment.mockClear();
                mockSendDirectMessage.mockRejectedValue(err);
                await adapter.sendReply(opts).catch(() => void 0);
                for (const call of mockReplyToComment.mock.calls) {
                    expect(call[1]).not.toBe(opts.replyText);
                }
            }
        });

        it('dual mode: picks Arabic nudge when comment is a pure structured tag on Arabic post', async () => {
            // Before fix: raw "@[id:Name]" has Latin characters → detects English → EN nudge on Arabic page.
            // After fix: stripped text is empty → falls back to post language (Arabic) → AR nudge.
            const opts = {
                ...baseOpts,
                commentMessage: '@[100012345:Hanaa Kanaan]',
                postMessage: 'منشور عربي عن الدورة',
                userSettings: {
                    commentReplyMode: 'dual',
                    dualReplyNudgeVariations: {
                        ar: ['تم إرسال التفاصيل بالخاص'],
                        en: ['Details sent via DM'],
                    },
                },
            };

            await adapter.sendReply(opts);

            expect(mockReplyToComment).toHaveBeenCalledWith(
                'ig-comment-1',
                'تم إرسال التفاصيل بالخاص',
                pageLinkedInstagramCredential('token-123'),
            );
        });

        it('dual mode: picks Arabic nudge when comment is tag + Arabic question', async () => {
            const opts = {
                ...baseOpts,
                commentMessage: '@Ali Ahdab كيف يمكنني التسجيل في الدورة القادمة؟',
                postMessage: 'منشور عربي',
                userSettings: {
                    commentReplyMode: 'dual',
                    dualReplyNudgeVariations: {
                        ar: ['تم إرسال التفاصيل بالخاص'],
                        en: ['Details sent via DM'],
                    },
                },
            };

            await adapter.sendReply(opts);

            expect(mockReplyToComment).toHaveBeenCalledWith(
                'ig-comment-1',
                'تم إرسال التفاصيل بالخاص',
                pageLinkedInstagramCredential('token-123'),
            );
        });

        it('defaults to public mode when commentReplyMode not set', async () => {
            const opts = { ...baseOpts, userSettings: {} };
            const result = await adapter.sendReply(opts);

            expect(result.success).toBe(true);
            expect(mockReplyToComment).toHaveBeenCalled();
            expect(mockSendDirectMessage).not.toHaveBeenCalled();
        });
    });

    describe('getFallbackReply', () => {
        it('should return null (matches Facebook adapter — no canned reply mid-conversation)', () => {
            // Previously returned `t('instagramFallback', lang)` → "Thank you for
            // your comment! 🙏" / "شكراً لتعليقك! 🙏". Sending that mid-conversation
            // (e.g. when the generator skipped the reply because the AI was
            // unavailable, the comment was flagged offensive, or confidence was
            // low) was the same anti-pattern as ai.ts:530. The new contract:
            // return null, so commentProcessor's no-reply branch flags the
            // comment needs_attention and notifies the merchant.
            expect(adapter.getFallbackReply()).toBeNull();
        });
    });
});
