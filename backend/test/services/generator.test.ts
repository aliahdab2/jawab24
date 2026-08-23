import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator, shouldSkipReply, computeReplyFlags, computeNeedsAttention } from '../../src/services/reply/generator';

// Mock all dependencies
vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn(),
    },
}));

vi.mock('../../src/services/ecommerceToolLoop', () => ({
    generateReplyWithTools: vi.fn(),
}));

// Spread the real module so pure helpers added later (e.g. isCertainDetection, which
// derives from the mocked detectLanguage result) don't break this file — only the
// detectors this suite needs to control are stubbed.
vi.mock('../../src/utils/language', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/utils/language')>()),
    detectLanguageCode: vi.fn().mockReturnValue('en'),
    detectCommentLanguage: vi.fn().mockReturnValue('en'),
    detectLanguage: vi.fn().mockReturnValue({ language: 'en', confidence: 0.9, script: 'Latin', isRTL: false }),
    detectTemplateLanguage: vi.fn().mockReturnValue('en'),
    isLowSignalLatinToken: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: vi.fn().mockResolvedValue([]),
        getCustomerSummary: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/posts', () => ({
    postsService: {
        findOrCreateFromWebhook: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
        logQuotaEvent: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getLimitFallbackMessage: vi.fn().mockResolvedValue(null),
        // Default: toggle off → silent at limit (matches the new schema default
        // and the existing default-off assertions in this file).
        getSettings: vi.fn().mockResolvedValue({ limitFallbackEnabled: false }),
    },
}));

describe('ReplyGenerator - Flagging System', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        generator = new ReplyGenerator();
    });

    describe('generateForComment', () => {
        const baseContext = {
            userId: 'user-123',
            text: 'Hello!',
            pageName: 'Test Page',
        };

        it('should flag when AI returns flags array', async () => {
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Please contact us for pricing.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'medium',
                flags: ['price_not_in_kb', 'redirect_to_human'],
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toBe('price_not_in_kb,redirect_to_human');
            expect(result.aiIntent).toBe('QUESTION');
            expect(result.replyMethod).toBe('ai');
        });

        it('should flag when AI response has COMPLAINT intent', async () => {
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We apologize for the inconvenience.',
                language: 'en',
                cached: false,
                intent: 'COMPLAINT',
                confidence: 'high',
                flags: [],
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toBe('complaint');
            expect(result.aiIntent).toBe('COMPLAINT');
        });

        it('should flag when AI confidence is low and include low_confidence in flagReason', async () => {
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Thank you for reaching out.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'low',
                flags: [],
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('low_confidence');
        });

        it('should NOT flag when AI response is clean (no flags, high confidence, non-complaint)', async () => {
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Thank you for your kind words!',
                language: 'en',
                cached: false,
                intent: 'COMPLIMENT',
                confidence: 'high',
                flags: [],
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(false);
            expect(result.flagReason).toBeUndefined();
            expect(result.aiIntent).toBe('COMPLIMENT');
        });

        it('should NOT flag fallback replies', async () => {
            // AI disabled → fallback path
            const result = await generator.generateForComment(baseContext, false);

            expect(result.needsAttention).toBe(false);
            expect(result.replyText).toBe('Thank you for your comment!');
            expect(result.replyMethod).toBe('template');
        });

        it('should return null + needsAttention=true at AI limit when no custom fallback is set (default-off)', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
                allowed: false, limit: 100, used: 100, remaining: 0, reason: 'limit_reached',
            } as any);

            const result = await generator.generateForComment(baseContext, true);

            // Default-off: empty custom fallback ⇒ silent + flag for manual review
            expect(result.replyText).toBeNull();
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(true);
        });

        it('should fetch post content lazily when postMessage is missing', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { postsService } = await import('../../src/services/posts');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue({
                message: 'Check out our new product!',
            } as any);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Thanks for your interest!',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            const contextWithPost = {
                ...baseContext,
                postId: 'post-1',
                pageId: 'page-1',
                accessToken: 'token-123',
                // postMessage deliberately omitted
            };

            await generator.generateForComment(contextWithPost, true);

            expect(postsService.findOrCreateFromWebhook).toHaveBeenCalledWith('page-1', 'post-1', undefined, 'token-123');
        });

        it('should pass kbActiveVersion and postMessage to AI context', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Great shoes!',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment({
                ...baseContext,
                postMessage: 'New shoes on sale!',
                kbActiveVersion: 4,
            }, true);

            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: expect.objectContaining({
                        postMessage: 'New shoes on sale!',
                        kbActiveVersion: 4,
                        channel: 'comment',
                    }),
                }),
            );
        });

        it('should increment AI reply counter after successful AI reply', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Hello there!',
                language: 'en',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment(baseContext, true);

            expect(subscriptionsService.incrementAiReplies).toHaveBeenCalledWith('user-123');
        });

        it('should increment AI reply counter exactly once in dual mode (comment + DM nudge billed as 1)', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Sure, here are the details.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment(baseContext, true, 'dual');

            expect(subscriptionsService.incrementAiReplies).toHaveBeenCalledTimes(1);
            expect(subscriptionsService.incrementAiReplies).toHaveBeenCalledWith('user-123');
        });

        it('should flag when AI returns OFFENSIVE intent', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We do not tolerate that language.',
                language: 'en',
                cached: false,
                intent: 'OFFENSIVE',
                confidence: 'high',
                flags: [],
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toBe('offensive');
            expect(result.aiIntent).toBe('OFFENSIVE');
        });

        it('should flag when angry_customer flag is present', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We understand your frustration.',
                language: 'en',
                cached: false,
                intent: 'COMPLAINT',
                confidence: 'high',
                flags: ['angry_customer'],
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toBe('angry_customer');
        });

        it('should add info_not_in_kb flag when RAG attempted, 0 chunks retrieved, and GPT claims high confidence on QUESTION', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Yes we can provide a tax invoice!',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            // Simulate RAG-enabled page where retrieval returned 0 chunks
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: true,
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('info_not_in_kb');
            expect(result.flagReason).toContain('low_confidence');
        });

        it('should NOT trigger hallucination guard when RAG not attempted (static KB page)', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Yes we can provide a tax invoice!',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            // Static-KB page: kbActiveVersion null → ragAttempted=false → guard should NOT fire
            const result = await generator.generateForComment({
                ...baseContext,
                kbActiveVersion: null,
            }, true);

            // No flags should be added — static KB pages don't trigger hallucination guard
            expect(result.needsAttention).toBe(false);
            expect(result.flagReason).toBeUndefined();
        });

        it('should trigger hallucination guard when confidence is medium and RAG attempted with 0 chunks', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'I think the delivery takes about 3 days.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'medium',
                flags: [],
            });

            // RAG attempted + 0 chunks + medium confidence → guard fires (catches hallucinations)
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: true,
            });

            const result = await generator.generateForComment(baseContext, true);

            // medium confidence + RAG attempted + 0 chunks → info_not_in_kb + low_confidence
            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('info_not_in_kb');
            expect(result.flagReason).toContain('low_confidence');
        });

        it('should NOT trigger hallucination guard when confidence is low (already flagged)', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'I will check with the team.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'low',
                flags: [],
            });

            // RAG attempted + 0 chunks but confidence=low → guard should NOT fire
            // (low confidence already gets low_confidence flag via the earlier check)
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: true,
            });

            const result = await generator.generateForComment(baseContext, true);

            // low_confidence is added by the earlier low-confidence check, NOT by hallucination guard
            expect(result.flagReason).toBe('low_confidence');
            // info_not_in_kb should NOT be added — guard skips low confidence
            expect(result.flagReason).not.toContain('info_not_in_kb');
        });

        it('should NOT add info_not_in_kb flag when GPT already includes it', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Let me check with the team.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: ['info_not_in_kb'],
            });

            const result = await generator.generateForComment({
                ...baseContext,
                kbActiveVersion: null,
            }, true);

            // Should have info_not_in_kb exactly once, not duplicated
            const flagCount = (result.flagReason || '').split(',').filter(f => f.trim() === 'info_not_in_kb').length;
            expect(flagCount).toBe(1);
        });

        it('should normalize non-standard intent "PRICE" to QUESTION and trigger hallucination guard when RAG attempted', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'The price is $50!',
                language: 'en',
                cached: false,
                intent: 'PRICE',  // Non-standard intent GPT invented
                confidence: 'high',
                flags: [],
            });

            // Simulate RAG-enabled page where retrieval returned 0 chunks
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: true,
            });

            const result = await generator.generateForComment(baseContext, true);

            // PRICE normalizes to QUESTION → hallucination guard fires (RAG attempted + 0 chunks + high confidence)
            expect(result.aiIntent).toBe('QUESTION');
            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('info_not_in_kb');
            expect(result.flagReason).toContain('low_confidence');
        });

        it('should normalize non-standard intent "OTHER" and trigger hallucination guard when RAG attempted', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Some reply',
                language: 'en',
                cached: false,
                intent: 'OTHER',  // GPT invented catch-all
                confidence: 'high',
                flags: [],
            });

            // Simulate RAG-enabled page where retrieval returned 0 chunks
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: true,
            });

            const result = await generator.generateForComment(baseContext, true);

            // OTHER is not in HALLUCINATION_SAFE_INTENTS → guard fires (RAG attempted + 0 chunks)
            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('info_not_in_kb');
        });

        it('should NOT trigger hallucination guard for COMPLIMENT intent even with RAG attempted (hallucination-safe)', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Thank you so much!',
                language: 'en',
                cached: false,
                intent: 'COMPLIMENT',
                confidence: 'high',
                flags: [],
            });

            // Even with RAG attempted + 0 chunks + high confidence,
            // COMPLIMENT is safe → guard should NOT fire
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: true,
            });

            const result = await generator.generateForComment(baseContext, true);

            // COMPLIMENT is in HALLUCINATION_SAFE_INTENTS → guard does NOT fire
            expect(result.needsAttention).toBe(false);
            expect(result.flagReason).toBeUndefined();
        });

        it('should NOT trigger hallucination guard when RAG attempted and chunks were found', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'The price is 500 SAR.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            // RAG attempted AND chunks found → guard should NOT fire
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: [{ type: 'product', title: 'Pricing', content: '500 SAR', score: 0.9 }],
                effectiveKB: undefined,
                queryEmbedding: [0.1, 0.2],
                ragAttempted: true,
            });

            const result = await generator.generateForComment(baseContext, true);

            // Chunks > 0 means KB covers this topic → no hallucination guard
            expect(result.needsAttention).toBe(false);
            expect(result.flagReason).toBeUndefined();
        });

        it('should normalize "ABUSE" to OFFENSIVE and set needsAttention', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We do not tolerate this.',
                language: 'en',
                cached: false,
                intent: 'ABUSE',  // Non-standard → maps to OFFENSIVE
                confidence: 'high',
                flags: ['offensive_or_abusive'],
            });

            const result = await generator.generateForComment(baseContext, true);

            expect(result.aiIntent).toBe('OFFENSIVE');
            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('offensive_or_abusive');
        });
    });

    describe('generateForMessage', () => {
        const baseContext = {
            userId: 'user-123',
            text: 'I need help',
            pageName: 'Test Page',
            pageId: 'page-123',
            senderId: 'sender-456',
        };

        it('should flag message with COMPLAINT intent', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We are sorry to hear that.',
                language: 'en',
                cached: false,
                intent: 'COMPLAINT',
                confidence: 'high',
                flags: ['angry_customer'],
            });

            const result = await generator.generateForMessage(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toBe('angry_customer');
            expect(result.aiIntent).toBe('COMPLAINT');
        });

        it('should NOT flag clean message reply', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Hello! How can I help you?',
                language: 'en',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            const result = await generator.generateForMessage(baseContext, true);

            expect(result.needsAttention).toBe(false);
            expect(result.aiIntent).toBe('GREETING');
        });

        it('should NOT flag when AI is disabled (fallback)', async () => {

            const result = await generator.generateForMessage(baseContext, false);

            expect(result.needsAttention).toBe(false);
        });

        it('should return null + needsAttention=true at AI limit when no custom fallback is set (default-off)', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
                allowed: false, limit: 100, used: 100, remaining: 0, reason: 'limit_reached',
            } as any);

            const result = await generator.generateForMessage(baseContext, true);

            // Default-off: empty custom fallback ⇒ silent + flag for manual review
            expect(result.replyText).toBeNull();
            expect(result.replyMethod).toBe('template');
            expect(result.needsAttention).toBe(true);
        });

        it('should pass kbActiveVersion and conversationHistory to AI context', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { messagesService } = await import('../../src/services/messages');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
                { role: 'user', content: 'What sizes do you have?' },
                { role: 'assistant', content: 'We have S, M, L, XL.' },
            ] as any);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Yes, XL is available!',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            // Mock resolveKnowledge to avoid calling real retrieval service
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: false,
            });

            await generator.generateForMessage({
                ...baseContext,
                kbActiveVersion: 5,
            }, true);

            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: expect.objectContaining({
                        kbActiveVersion: 5,
                        channel: 'dm',
                        conversationHistory: expect.arrayContaining([
                            expect.objectContaining({ role: 'user', content: 'What sizes do you have?' }),
                        ]),
                    }),
                }),
            );
        });

        it('should fetch conversation history for AI context', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { messagesService } = await import('../../src/services/messages');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' },
            ] as any);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'How can I help?',
                language: 'en',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForMessage(baseContext, true);

            expect(messagesService.getConversationHistory).toHaveBeenCalledWith('page-123', 'sender-456', 12);
            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: expect.objectContaining({
                        conversationHistory: expect.any(Array),
                    }),
                }),
            );
        });

        it('should not call AI when pageId or senderId is missing', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);

            const contextWithoutIds = { userId: 'user-123', text: 'Hello' };
            const result = await generator.generateForMessage(contextWithoutIds, true);

            expect(aiService.generateReply).not.toHaveBeenCalled();
            expect(result.replyText).toBeNull();
        });

        it('should trigger hallucination guard in DM when RAG attempted and 0 chunks', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We offer free returns within 30 days!',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            // RAG attempted but 0 chunks → hallucination guard should fire
            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: true,
            });

            const result = await generator.generateForMessage(baseContext, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('info_not_in_kb');
            expect(result.flagReason).toContain('low_confidence');
        });

        it('should defer to conversation history for short Latin acronyms ("ICDL") mid-Arabic chat', async () => {
            // Regression: customer chatting in Arabic sent "ICDL" → bot replied in English
            // because Latin-only text was detected as English with low confidence (0.5) but
            // the generator treated it as definitive. Expected behavior: for low-confidence
            // Latin detection with Arabic conversation history, let the ai-worker's
            // history-first language chain pick the established conversation language.
            const { aiService } = await import('../../src/services/ai');
            const { messagesService } = await import('../../src/services/messages');
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            const language = await import('../../src/utils/language');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);

            // "ICDL" — Latin letters but low confidence (no common English words, short)
            vi.mocked(language.detectLanguageCode).mockReturnValue('en');
            vi.mocked(language.detectLanguage).mockReturnValue({
                language: 'en', confidence: 0.5, script: 'Latin', isRTL: false,
            });

            // Customer has been chatting in Arabic; current message is "ICDL"
            vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
                { role: 'user', content: 'مرحبا' },
                { role: 'assistant', content: 'أهلاً! كيف يمكنني مساعدتك؟' },
                { role: 'user', content: 'تفاصيل' },
                { role: 'assistant', content: 'أكيد! عندنا دورات متنوعة مثل المكياج، ICDL، إدخال البيانات' },
            ]);

            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'دورة ICDL مدتها شهر...',
                language: 'ar',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: false,
            });

            await generator.generateForMessage({
                ...baseContext,
                text: 'ICDL',
            }, true);

            // Must NOT pass language: 'en' — that would force the ai-worker to reply in English
            // despite the Arabic conversation context. Accept either undefined (defer to
            // ai-worker's history-first chain) or 'ar' (resolved here from history).
            const aiCall = vi.mocked(aiService.generateReply).mock.calls[0][0];
            expect(aiCall.language).not.toBe('en');
        });

        it('should defer to assistant history when customer\'s first DM reply is a low-confidence Latin token (dual-DM opener)', async () => {
            // Regression from production screenshot 2026-05-16:
            // Customer commented on a post (Arabic). Jawab replied via dual-DM in Arabic.
            // Customer's FIRST DM message back was "Icdl" (low-confidence Latin). Bot replied
            // in English, listing schedules — wrong language because there are no prior USER
            // messages in the DM thread, only the assistant's Arabic opener.
            // Expected: the assistant's Arabic message must count as a language anchor.
            const { aiService } = await import('../../src/services/ai');
            const { messagesService } = await import('../../src/services/messages');
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            const language = await import('../../src/utils/language');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);

            // "Icdl" — Latin, no common English words → confidence 0.5
            vi.mocked(language.detectLanguageCode).mockReturnValue('en');
            vi.mocked(language.detectLanguage).mockReturnValue({
                language: 'en', confidence: 0.5, script: 'Latin', isRTL: false,
            });

            // Dual-DM opener: only the assistant's Arabic message is in DM history.
            // No prior user messages (customer's original Arabic comment was on the post,
            // not in the DM thread).
            vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
                { role: 'assistant', content: 'عنا عدة دورات بسعر 25 ألف ل.س بالعملة القديمة، منها ICDL، الإسعافات الأولية. حابب تعرف عن أي دورة بالتحديد؟' },
            ]);

            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'دورة ICDL مدتها شهر...',
                language: 'ar',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: false,
            });

            await generator.generateForMessage({
                ...baseContext,
                text: 'Icdl',
            }, true);

            // Must NOT pass language: 'en'. The assistant's Arabic message in DM history
            // is a sufficient language anchor — the customer is replying to it.
            const aiCall = vi.mocked(aiService.generateReply).mock.calls[0][0];
            expect(aiCall.language).not.toBe('en');
        });

        it('should still pass language for high-confidence English (user switches language mid-chat)', async () => {
            // Counter-test: if the customer writes a genuine English sentence mid-Arabic-chat,
            // we must respect the language switch. High-confidence English detection
            // (≥0.6) should NOT be deferred to history.
            const { aiService } = await import('../../src/services/ai');
            const { messagesService } = await import('../../src/services/messages');
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            const language = await import('../../src/utils/language');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);

            vi.mocked(language.detectLanguageCode).mockReturnValue('en');
            vi.mocked(language.detectLanguage).mockReturnValue({
                language: 'en', confidence: 0.8, script: 'Latin', isRTL: false,
            });

            vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
                { role: 'user', content: 'مرحبا' },
                { role: 'assistant', content: 'أهلاً!' },
            ]);

            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Sure, I can help in English.',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            vi.spyOn(generator as any, 'resolveKnowledge').mockResolvedValue({
                retrievedChunks: undefined,
                effectiveKB: undefined,
                queryEmbedding: undefined,
                ragAttempted: false,
            });

            await generator.generateForMessage({
                ...baseContext,
                text: 'Can you help me in English please?',
            }, true);

            const aiCall = vi.mocked(aiService.generateReply).mock.calls[0][0];
            expect(aiCall.language).toBe('en');
        });

        it('should NOT trigger hallucination guard in DM when RAG not attempted (static KB)', async () => {
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We offer free returns within 30 days!',
                language: 'en',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            // Static KB page → ragAttempted=false → guard should NOT fire
            const result = await generator.generateForMessage({
                ...baseContext,
                kbActiveVersion: null,
            }, true);

            expect(result.needsAttention).toBe(false);
            expect(result.flagReason).toBeUndefined();
        });

    });

}); // end describe('ReplyGenerator - Flagging System')

describe('ReplyGenerator - Playground tool-loop routing', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        generator = new ReplyGenerator();
    });

    const baseInput = {
        pageId: 'page-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        question: 'send me the product link',
        channel: 'dm' as const,
        knowledgeBase: 'Test catalog',
        kbActiveVersion: null,
        pageName: 'Demo Store',
    };

    const mockAiResponse = {
        reply: 'mocked reply',
        language: 'en',
        cached: false,
        intent: 'QUESTION',
        confidence: 'high',
        flags: [],
    };

    it('routes through generateReplyWithTools when ecommerceStoreId is set', async () => {
        const { generateReplyWithTools } = await import('../../src/services/ecommerceToolLoop');
        const { aiService } = await import('../../src/services/ai');
        vi.mocked(generateReplyWithTools).mockResolvedValue(mockAiResponse);

        await generator.generateForPlayground({
            ...baseInput,
            ecommerceStoreId: 'store-123',
        });

        expect(generateReplyWithTools).toHaveBeenCalledTimes(1);
        expect(aiService.generateReply).not.toHaveBeenCalled();

        const callArg = vi.mocked(generateReplyWithTools).mock.calls[0][0];
        expect(callArg.context?.ecommerceStoreId).toBe('store-123');
    });

    it('routes through aiService.generateReply when ecommerceStoreId is absent', async () => {
        const { generateReplyWithTools } = await import('../../src/services/ecommerceToolLoop');
        const { aiService } = await import('../../src/services/ai');
        vi.mocked(aiService.generateReply).mockResolvedValue(mockAiResponse);

        await generator.generateForPlayground(baseInput);

        expect(aiService.generateReply).toHaveBeenCalledTimes(1);
        expect(generateReplyWithTools).not.toHaveBeenCalled();
    });
});

// --- shouldSkipReply tests ---

describe('shouldSkipReply', () => {
    it('should return true for offensive_or_abusive flag', () => {
        expect(shouldSkipReply('offensive_or_abusive')).toBe(true);
    });

    it('should return true for offensive flag', () => {
        expect(shouldSkipReply('offensive')).toBe(true);
    });

    it('should return false for low_confidence flag (send reply, just flag for review)', () => {
        expect(shouldSkipReply('low_confidence')).toBe(false);
    });

    it('should return true for OFFENSIVE intent', () => {
        expect(shouldSkipReply(undefined, 'OFFENSIVE')).toBe(true);
    });

    it('should return false for non-skip flags', () => {
        expect(shouldSkipReply('price_not_in_kb')).toBe(false);
        expect(shouldSkipReply('angry_customer')).toBe(false);
    });

    it('should return false when no flags or intent', () => {
        expect(shouldSkipReply()).toBe(false);
        expect(shouldSkipReply(undefined, undefined)).toBe(false);
    });

    it('should return false when low_confidence is among non-skip flags', () => {
        expect(shouldSkipReply('price_not_in_kb,low_confidence')).toBe(false);
    });

    it('should return true for SPAM_OR_IRRELEVANT intent', () => {
        expect(shouldSkipReply(undefined, 'SPAM_OR_IRRELEVANT')).toBe(true);
    });

    it('should return true for spam_or_irrelevant intent (case-insensitive)', () => {
        expect(shouldSkipReply(undefined, 'spam_or_irrelevant')).toBe(true);
    });
});


describe('ReplyGenerator - Mention/tag skip behavior', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        generator = new ReplyGenerator();
    });

    const baseContext = {
        userId: 'user-123',
        pageName: 'Test Page',
    };

    it('skips silently when comment is a pure Facebook structured tag', async () => {
        const { aiService } = await import('../../src/services/ai');

        const result = await generator.generateForComment(
            { ...baseContext, text: '@[100012345:Hanaa Kanaan]', postMessage: 'منشور عربي' },
            true,
        );

        expect(result.replyText).toBeNull();
        expect(result.aiIntent).toBe('SPAM_OR_IRRELEVANT');
        expect(vi.mocked(aiService.generateReply)).not.toHaveBeenCalled();
    });

    it('skips silently when comment is a pure plain @mention', async () => {
        const { aiService } = await import('../../src/services/ai');

        const result = await generator.generateForComment(
            { ...baseContext, text: '@hadi', postMessage: 'Some post' },
            true,
        );

        expect(result.replyText).toBeNull();
        expect(result.aiIntent).toBe('SPAM_OR_IRRELEVANT');
        expect(vi.mocked(aiService.generateReply)).not.toHaveBeenCalled();
    });

    it('skips silently when comment is a mention + ≤3 words of chatter', async () => {
        const { aiService } = await import('../../src/services/ai');

        const result = await generator.generateForComment(
            { ...baseContext, text: '@Ali check this', postMessage: 'Some post' },
            true,
        );

        expect(result.replyText).toBeNull();
        expect(result.aiIntent).toBe('SPAM_OR_IRRELEVANT');
        expect(vi.mocked(aiService.generateReply)).not.toHaveBeenCalled();
    });

    it('proceeds to AI when comment is a tag + real question (>3 words)', async () => {
        const { aiService } = await import('../../src/services/ai');

        vi.mocked(aiService.generateReply).mockResolvedValue({
            reply: 'سعر الدورة 500 ريال',
            language: 'ar',
            cached: false,
            intent: 'QUESTION',
            confidence: 'high',
            flags: [],
        });

        const result = await generator.generateForComment(
            {
                ...baseContext,
                text: '@[100:Ali] كيف يمكنني التسجيل في الدورة القادمة؟',
                postMessage: 'منشور عربي',
            },
            true,
        );

        expect(result.replyText).toBe('سعر الدورة 500 ريال');
        expect(vi.mocked(aiService.generateReply)).toHaveBeenCalled();
        // The comment passed to AI should be the stripped version, not the raw tag.
        const callArg = vi.mocked(aiService.generateReply).mock.calls[0][0];
        expect(callArg.comment).toBe('كيف يمكنني التسجيل في الدورة القادمة؟');
    });
});

// --- computeReplyFlags (shared by processAiResponse + generateForPlayground) ---

describe('computeReplyFlags', () => {
    const baseOpts = {
        aiFlags: undefined,
        confidence: 'high' as string | undefined,
        intent: 'QUESTION' as string | undefined,
        queryText: 'what are your hours',
        ragAttempted: false,
        retrievedChunkCount: 1,
        hasEffectiveKB: true,
    };

    it('normalizes the intent and preserves model-supplied flags', () => {
        const { normalizedIntent, flags } = computeReplyFlags({
            ...baseOpts, intent: 'question', aiFlags: ['price_not_in_kb'],
        });
        expect(normalizedIntent).toBe('QUESTION');
        expect(flags).toEqual(['price_not_in_kb']);
    });

    it('adds low_confidence when the model returns low confidence', () => {
        const { flags } = computeReplyFlags({ ...baseOpts, confidence: 'low' });
        expect(flags).toContain('low_confidence');
    });

    it('adds the deterministic business-action flag from the query text', () => {
        const { flags } = computeReplyFlags({ ...baseOpts, queryText: 'أريد إلغاء طلبي' });
        expect(flags).toContain('cancellation_request');
    });

    it('forces info_not_in_kb + low_confidence on a hallucination (RAG ran, 0 chunks, no KB, high confidence)', () => {
        const { flags } = computeReplyFlags({
            ...baseOpts, ragAttempted: true, retrievedChunkCount: 0, hasEffectiveKB: false,
        });
        expect(flags).toEqual(expect.arrayContaining(['info_not_in_kb', 'low_confidence']));
    });

    it('does NOT force info_not_in_kb when the static KB was sent (model can self-assess)', () => {
        const { flags } = computeReplyFlags({
            ...baseOpts, ragAttempted: true, retrievedChunkCount: 0, hasEffectiveKB: true,
        });
        expect(flags).not.toContain('info_not_in_kb');
    });

    it('does NOT force info_not_in_kb for social/abuse intents even with 0 chunks', () => {
        const { flags } = computeReplyFlags({
            ...baseOpts, intent: 'GREETING', ragAttempted: true, retrievedChunkCount: 0, hasEffectiveKB: false,
        });
        expect(flags).not.toContain('info_not_in_kb');
    });

    it('does NOT force info_not_in_kb when RAG was never attempted (static-KB page)', () => {
        const { flags } = computeReplyFlags({
            ...baseOpts, ragAttempted: false, retrievedChunkCount: 0, hasEffectiveKB: false,
        });
        expect(flags).not.toContain('info_not_in_kb');
    });

    // reply_shortened is the ai-worker's truncation-retry marker: informational
    // only. It must be stripped out of the alarm-flag set (any unknown flag left
    // in `flags` reaches flag_reason AND trips needsAttention for question-like
    // intents) and surfaced separately for the quiet inbox/test-page badge.
    describe('reply_shortened extraction (July 2026 truncation-retry badge)', () => {
        it('strips reply_shortened from flags and surfaces it as replyShortened', () => {
            const { flags, replyShortened } = computeReplyFlags({
                ...baseOpts, aiFlags: ['reply_shortened'],
            });
            expect(replyShortened).toBe(true);
            expect(flags).toEqual([]);
        });

        it('a shortened+delivered QUESTION reply must NOT need attention or carry a flag reason', () => {
            const { flags, normalizedIntent, replyShortened } = computeReplyFlags({
                ...baseOpts, intent: 'QUESTION', aiFlags: ['reply_shortened'],
            });
            expect(replyShortened).toBe(true);
            expect(computeNeedsAttention(flags, normalizedIntent)).toBe(false);
            expect(flags.join(',')).toBe('');
        });

        it('preserves other flags (and their alarm behavior) alongside the marker', () => {
            const { flags, normalizedIntent, replyShortened } = computeReplyFlags({
                ...baseOpts, aiFlags: ['reply_shortened', 'info_not_in_kb'],
            });
            expect(replyShortened).toBe(true);
            expect(flags).toEqual(['info_not_in_kb']);
            expect(computeNeedsAttention(flags, normalizedIntent)).toBe(true);
        });

        // json_salvaged (D-097, 2026-08-23) is the parser's marker for "the
        // envelope was embedded in prose and its reply was delivered" — the
        // customer got the right answer. Same class as reply_shortened: never
        // an alarm, never a flag_reason (its i18n label does not even exist).
        it('strips json_salvaged — a salvaged QUESTION reply needs no attention and carries no flag reason', () => {
            const { flags, normalizedIntent } = computeReplyFlags({
                ...baseOpts, intent: 'QUESTION', aiFlags: ['json_salvaged'],
            });
            expect(flags).toEqual([]);
            expect(computeNeedsAttention(flags, normalizedIntent)).toBe(false);
        });

        it('json_salvaged does not shield the real flags next to it', () => {
            const { flags, normalizedIntent } = computeReplyFlags({
                ...baseOpts, intent: 'QUESTION', aiFlags: ['json_salvaged', 'info_not_in_kb'],
            });
            expect(flags).toEqual(['info_not_in_kb']);
            expect(computeNeedsAttention(flags, normalizedIntent)).toBe(true);
        });

        // Check 6 identity flags (v59, #495 review H2): merchant visibility is
        // DELIBERATE — a reply the validator swapped (or a model-reported reveal
        // our vocabulary missed) is exactly what a merchant should review. These
        // pin that the flags survive computeReplyFlags and trip needsAttention.
        it('self_identification_stripped survives to flag_reason and needs attention (deliberate)', () => {
            const { flags, normalizedIntent } = computeReplyFlags({
                ...baseOpts, intent: 'QUESTION', aiFlags: ['self_identification_stripped'],
            });
            expect(flags).toContain('self_identification_stripped');
            expect(computeNeedsAttention(flags, normalizedIntent)).toBe(true);
        });

        it('self_identified_as_automation needs attention even when nothing was stripped (reveal may have shipped)', () => {
            const { flags, normalizedIntent } = computeReplyFlags({
                ...baseOpts, intent: 'QUESTION', aiFlags: ['self_identified_as_automation'],
            });
            expect(flags).toContain('self_identified_as_automation');
            expect(computeNeedsAttention(flags, normalizedIntent)).toBe(true);
        });

        it('returns replyShortened=false when the marker is absent', () => {
            const { replyShortened } = computeReplyFlags({ ...baseOpts, aiFlags: ['low_confidence'] });
            expect(replyShortened).toBe(false);
        });
    });
});

