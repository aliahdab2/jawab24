/**
 * Regression tests for the localized fallback returned when AI quota is
 * exhausted (or AI is disabled for comments). Customers writing in Arabic must
 * receive the Arabic fallback; customers writing in English get the English one.
 *
 * Bug history: prior to 2026-04-26, all three fallback sites in generator.ts
 * returned hardcoded English strings, so Arabic customers got an English reply
 * the moment a workspace ran out of AI quota. The fix routes through
 * `t('commentFallback' | 'messageFallback', lang)` with `lang` resolved by
 * `resolveFallbackLanguage()`. These tests pin that behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator } from '../../../src/services/reply/generator';
import { t } from '../../../src/utils/i18n';

vi.mock('../../../src/services/ai', () => ({
    aiService: { generateReply: vi.fn() },
}));

vi.mock('../../../src/services/posts', () => ({
    postsService: { findOrCreateFromWebhook: vi.fn() },
}));

vi.mock('../../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: vi.fn().mockResolvedValue([]),
        getCustomerSummary: vi.fn().mockResolvedValue(undefined),
    },
}));

const canUseAiReplies = vi.fn();
vi.mock('../../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: (...args: unknown[]) => canUseAiReplies(...args),
        incrementAiReplies: vi.fn(),
        logAiUsage: vi.fn(),
    },
}));

vi.mock('../../../src/services/kb/gap-detector', () => ({
    gapDetectorService: { setLogger: vi.fn(), recordGap: vi.fn() },
}));

vi.mock('../../../src/config', () => ({
    config: { ragMode: 'off', openai: { apiKey: '' } },
}));

const baseCtx = {
    workspaceId: 'ws-1',
    userId: 'u-1',
    pageId: 'p-1',
    pageName: 'Test Page',
};

describe('ReplyGenerator – localized fallback when AI quota is exhausted', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        canUseAiReplies.mockResolvedValue({ allowed: false, reason: 'monthly_limit' });
        generator = new ReplyGenerator();
    });

    describe('generateForComment – quota exhausted', () => {
        it('returns Arabic fallback for an Arabic comment', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: 'شو السعر؟' },
                true,
            );
            expect(result.replyText).toBe(t('commentFallback', 'ar'));
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(false);
        });

        it('returns English fallback for an English comment', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: 'how much?' },
                true,
            );
            expect(result.replyText).toBe(t('commentFallback', 'en'));
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(false);
        });

        it('falls back to post language when comment is script-less', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: '...', postMessage: 'دورة المكياج المبتدئ' },
                true,
            );
            expect(result.replyText).toBe(t('commentFallback', 'ar'));
        });
    });

    describe('generateForComment – AI disabled (third fallback site)', () => {
        it('returns Arabic fallback for an Arabic comment when aiEnabled=false', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: 'شو السعر؟' },
                false,
            );
            expect(result.replyText).toBe(t('commentFallback', 'ar'));
            expect(result.replyMethod).toBe('template');
            // canUseAiReplies must NOT be called on the AI-disabled path
            expect(canUseAiReplies).not.toHaveBeenCalled();
        });
    });

    describe('generateForMessage – quota exhausted', () => {
        it('returns Arabic fallback for an Arabic DM', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: 'السعر؟', senderId: 's-1' },
                true,
            );
            expect(result.replyText).toBe(t('messageFallback', 'ar'));
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(false);
        });

        it('returns English fallback for an English DM', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: 'hello there', senderId: 's-1' },
                true,
            );
            expect(result.replyText).toBe(t('messageFallback', 'en'));
        });

        it('falls back to KB language when DM is script-less', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: '...', senderId: 's-1', knowledgeBase: 'دورات تعليمية متخصصة' },
                true,
            );
            expect(result.replyText).toBe(t('messageFallback', 'ar'));
        });

        it('falls back to merchant defaultReplyLanguage when no other language signal', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: '...', senderId: 's-1', defaultReplyLanguage: 'ar' },
                true,
            );
            expect(result.replyText).toBe(t('messageFallback', 'ar'));
        });

        it('defaults to English when no language signal anywhere', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: '...', senderId: 's-1' },
                true,
            );
            expect(result.replyText).toBe(t('messageFallback', 'en'));
        });
    });
});
