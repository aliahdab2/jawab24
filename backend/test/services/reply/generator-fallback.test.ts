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

vi.mock('../../../src/services/ai', () => ({
    aiService: { generateReply: vi.fn() },
}));

// Stub aiUsageLog so transitive imports (leadExtractor → aiUsageLog → redis) don't try to connect.
vi.mock('../../../src/services/aiUsageLog', () => ({
    logAiUsage: vi.fn().mockResolvedValue(undefined),
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
        logQuotaEvent: vi.fn(),
    },
}));

vi.mock('../../../src/services/kb/gap-detector', () => ({
    gapDetectorService: { setLogger: vi.fn(), recordGap: vi.fn() },
}));

// Mock workspaceSettings so the import chain does not pull in redis at load time.
// Returns the merchant's custom fallback in the resolved language; tests override
// the implementation to also exercise the silent (no-custom) default-off path.
const getLimitFallbackMessage = vi.fn();
vi.mock('../../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getLimitFallbackMessage: (...args: unknown[]) => getLimitFallbackMessage(...args),
    },
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
        // Default: merchant has configured a custom message in both languages.
        // The mock echoes the resolved language so we can assert language resolution.
        getLimitFallbackMessage.mockImplementation((_workspaceId: string, lang: string) =>
            Promise.resolve(`CUSTOM-${lang}`),
        );
        generator = new ReplyGenerator();
    });

    describe('generateForComment – quota exhausted (custom fallback set)', () => {
        it('returns the custom message resolved to Arabic for an Arabic comment', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: 'شو السعر؟' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-ar');
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(false);
        });

        it('returns the custom message resolved to English for an English comment', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: 'how much?' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-en');
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(false);
        });

        it('resolves to post language when comment is script-less', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: '...', postMessage: 'دورة المكياج المبتدئ' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-ar');
        });
    });

    describe('generateForComment – quota exhausted (no custom fallback set, default-off)', () => {
        beforeEach(() => {
            getLimitFallbackMessage.mockResolvedValue(null);
        });

        it('returns null and flags for manual review instead of an auto-reply', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: 'شو السعر؟' },
                true,
            );
            expect(result.replyText).toBeNull();
            expect(result.needsAttention).toBe(true);
        });
    });

    describe('generateForComment – AI disabled (third fallback site)', () => {
        it('returns the custom (or hardcoded) message resolved to Arabic when aiEnabled=false', async () => {
            const result = await generator.generateForComment(
                { ...baseCtx, text: 'شو السعر؟' },
                false,
            );
            // AI-disabled path still uses `custom ?? t('commentFallback', lang)`.
            // Mock returns CUSTOM-{lang}, so we get the Arabic-resolved custom value.
            expect(result.replyText).toBe('CUSTOM-ar');
            expect(result.replyMethod).toBe('template');
            // canUseAiReplies must NOT be called on the AI-disabled path
            expect(canUseAiReplies).not.toHaveBeenCalled();
        });
    });

    describe('generateForMessage – quota exhausted (custom fallback set)', () => {
        it('returns the custom message resolved to Arabic for an Arabic DM', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: 'السعر؟', senderId: 's-1' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-ar');
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(false);
        });

        it('returns the custom message resolved to English for an English DM', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: 'hello there', senderId: 's-1' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-en');
        });

        it('resolves to KB language when DM is script-less', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: '...', senderId: 's-1', knowledgeBase: 'دورات تعليمية متخصصة' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-ar');
        });

        it('resolves to merchant defaultReplyLanguage when no other language signal', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: '...', senderId: 's-1', defaultReplyLanguage: 'ar' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-ar');
        });

        it('defaults to English when no language signal anywhere', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: '...', senderId: 's-1' },
                true,
            );
            expect(result.replyText).toBe('CUSTOM-en');
        });
    });

    describe('generateForMessage – quota exhausted (no custom fallback set, default-off)', () => {
        beforeEach(() => {
            getLimitFallbackMessage.mockResolvedValue(null);
        });

        it('returns null and flags for manual review instead of an auto-reply', async () => {
            const result = await generator.generateForMessage(
                { ...baseCtx, text: 'السعر؟', senderId: 's-1' },
                true,
            );
            expect(result.replyText).toBeNull();
            expect(result.needsAttention).toBe(true);
        });
    });
});
