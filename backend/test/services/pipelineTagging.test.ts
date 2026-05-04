/**
 * Verifies every entry point tags ai_usage_log rows with the correct pipeline.
 *
 * The original failure mode was: ai_usage_log.pipeline was always NULL because
 * no caller set it. These tests pin the tag at each entry point so a future
 * refactor can't silently drop the literal and revive that failure mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator } from '../../src/services/reply/generator';
import { buildPlaygroundContext } from '../../src/services/reply/playgroundContext';

vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn().mockResolvedValue({
            reply: 'mocked reply', language: 'en', cached: false,
            intent: 'QUESTION', confidence: 'high', flags: [],
        }),
    },
}));

vi.mock('../../src/services/ecommerceToolLoop', () => ({
    generateReplyWithTools: vi.fn(),
}));

vi.mock('../../src/utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('en'),
    detectCommentLanguage: vi.fn().mockReturnValue('en'),
    detectLanguage: vi.fn().mockReturnValue({ language: 'en', confidence: 0.9, script: 'Latin', isRTL: false }),
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: vi.fn().mockResolvedValue([]),
        getCustomerSummary: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/posts', () => ({
    postsService: { findOrCreateFromWebhook: vi.fn() },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
        logAiUsage: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/settings', () => ({
    settingsService: { getSettings: vi.fn().mockResolvedValue({ commentReplyMode: 'public' }) },
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: { getSettings: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../src/services/ecommerce', () => ({
    getEnrichedKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    getStoreContextForAI: vi.fn().mockResolvedValue({ storePolicies: undefined, productCatalog: undefined }),
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('pipeline tagging — every entry point sets the right tag', () => {
    describe('ReplyGenerator.generateForComment', () => {
        it("tags ai_usage_log rows as 'comment_reply'", async () => {
            const { aiService } = await import('../../src/services/ai');
            const generator = new ReplyGenerator();

            await generator.generateForComment(
                { userId: 'u', text: 'how much?', pageName: 'P', pageId: 'page-1', knowledgeBase: 'kb' },
                true,
            );

            expect(aiService.generateReply).toHaveBeenCalledTimes(1);
            const callArg = vi.mocked(aiService.generateReply).mock.calls[0]![0]!;
            expect(callArg.context?.pipeline).toBe('comment_reply');
        });
    });

    describe('ReplyGenerator.generateForMessage', () => {
        it("tags ai_usage_log rows as 'dm_reply'", async () => {
            const { aiService } = await import('../../src/services/ai');
            const generator = new ReplyGenerator();

            await generator.generateForMessage(
                { userId: 'u', text: 'hello', pageId: 'page-1', senderId: 'sender-1', pageName: 'P', knowledgeBase: 'kb' },
                true,
            );

            expect(aiService.generateReply).toHaveBeenCalledTimes(1);
            const callArg = vi.mocked(aiService.generateReply).mock.calls[0]![0]!;
            expect(callArg.context?.pipeline).toBe('dm_reply');
        });
    });

    describe('buildPlaygroundContext source → pipeline mapping', () => {
        const basePage = {
            id: 'page-1', name: 'Test Page', userId: 'user-1', workspaceId: 'ws-1',
            knowledgeBase: 'kb', kbActiveVersion: 1, ecommerceStoreId: null,
        };

        it("defaults to 'playground' when source is omitted (admin UI path)", async () => {
            const { playgroundInput } = await buildPlaygroundContext({
                page: basePage, question: 'how much?', channel: 'comment', postMessage: 'post',
            });
            expect(playgroundInput.pipeline).toBe('playground');
        });

        it("maps source='playground' → pipeline 'playground'", async () => {
            const { playgroundInput } = await buildPlaygroundContext({
                page: basePage, question: 'how much?', channel: 'comment', postMessage: 'post',
                source: 'playground',
            });
            expect(playgroundInput.pipeline).toBe('playground');
        });

        it("maps source='eval' → pipeline 'eval' (the eval-script path)", async () => {
            const { playgroundInput } = await buildPlaygroundContext({
                page: basePage, question: 'how much?', channel: 'comment', postMessage: 'post',
                source: 'eval',
            });
            expect(playgroundInput.pipeline).toBe('eval');
        });
    });
});
