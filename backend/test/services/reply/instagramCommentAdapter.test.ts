import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockGetPageByInstagramId = vi.fn();
vi.mock('../../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: (...args: unknown[]) => mockGetPageByInstagramId(...args),
    },
}));

const mockReplyToComment = vi.fn();
vi.mock('../../../src/services/instagram', () => ({
    instagramService: {
        replyToComment: (...args: unknown[]) => mockReplyToComment(...args),
    },
}));

// Mock DB for direct operations
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
vi.mock('../../../src/db', () => ({
    db: {
        select: () => ({ from: () => ({ where: mockDbSelect }) }),
        insert: () => ({ values: (v: unknown) => ({ returning: mockDbInsert }) }),
        update: () => ({ set: (s: unknown) => ({ where: mockDbUpdate }) }),
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
                'ig_comment_123', 'Thank you!', 'ig_token_abc',
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
        it('should update instagram comment in DB', async () => {
            mockDbUpdate.mockResolvedValue(undefined);

            await adapter.markAsReplied(
                'igc_uuid_1', 'Thank you!', 'ai', 'en', undefined, false, undefined, 'positive',
            );

            expect(mockDbUpdate).toHaveBeenCalledTimes(1);
        });
    });

    describe('flagComment', () => {
        it('should set needsAttention and flagReason', async () => {
            mockDbUpdate.mockResolvedValue(undefined);

            await adapter.flagComment('igc_uuid_1', 'offensive', 'OFFENSIVE');

            expect(mockDbUpdate).toHaveBeenCalledTimes(1);
        });

        it('should handle missing flagReason and aiIntent', async () => {
            mockDbUpdate.mockResolvedValue(undefined);

            await adapter.flagComment('igc_uuid_1');

            expect(mockDbUpdate).toHaveBeenCalledTimes(1);
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

    describe('getFallbackReply', () => {
        it('should return a thank you message with emoji', () => {
            const fallback = adapter.getFallbackReply();

            expect(fallback).not.toBeNull();
            expect(fallback).toContain('Thank you');
        });
    });
});
