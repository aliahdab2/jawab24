import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator } from '../../src/services/reply/generator';

// Mock all dependencies
vi.mock('../../src/services/rules', () => ({
    rulesService: {
        findMatchingRule: vi.fn(),
    },
}));

vi.mock('../../src/services/templates', () => ({
    templatesService: {
        getTemplate: vi.fn(),
    },
}));

vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn(),
    },
}));

vi.mock('../../src/utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('en'),
    detectCommentLanguage: vi.fn().mockReturnValue('en'),
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
        logAiUsage: vi.fn().mockResolvedValue(undefined),
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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

        it('should NOT flag template replies', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Welcome',
                message: 'Welcome to our page!',
            } as any);

            const result = await generator.generateForComment(baseContext, true);

            expect(result.needsAttention).toBe(false);
            expect(result.replyMethod).toBe('template');
            expect(result.templateId).toBe('template-1');
        });

        it('should NOT flag fallback replies', async () => {
            const { rulesService } = await import('../../src/services/rules');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);

            // AI disabled → fallback path
            const result = await generator.generateForComment(baseContext, false);

            expect(result.needsAttention).toBe(false);
            expect(result.replyText).toBe('Thank you for your comment!');
            expect(result.replyMethod).toBe('template');
        });

        it('should use Arabic translation when English is missing', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Welcome AR',
                message: 'مرحباً بك!',
            } as any);

            const result = await generator.generateForComment(baseContext, true);

            expect(result.replyText).toBe('مرحباً بك!');
            expect(result.replyMethod).toBe('template');
        });

        it('should use first available translation when en and ar are missing', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Welcome SV',
                message: 'Välkommen!',
            } as any);

            const result = await generator.generateForComment(baseContext, true);

            expect(result.replyText).toBe('Välkommen!');
        });

        it('should return fallback when AI limit is reached', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
                allowed: false, limit: 100, used: 100, remaining: 0, reason: 'limit_reached',
            } as any);

            const result = await generator.generateForComment(baseContext, true);

            expect(result.replyText).toBe('Thank you for your comment!');
            expect(result.replyMethod).toBe('template');
        });

        it('should fetch post content lazily when postMessage is missing', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { postsService } = await import('../../src/services/posts');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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

        it('should flag when AI returns OFFENSIVE intent', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);

            const result = await generator.generateForMessage(baseContext, false);

            expect(result.needsAttention).toBe(false);
        });

        it('should return fallback when AI limit is reached for messages', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
                allowed: false, limit: 100, used: 100, remaining: 0, reason: 'limit_reached',
            } as any);

            const result = await generator.generateForMessage(baseContext, true);

            expect(result.replyText).toBe('Thank you for your message! We will get back to you soon.');
            expect(result.replyMethod).toBe('template');
        });

        it('should pass kbActiveVersion and conversationHistory to AI context', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { messagesService } = await import('../../src/services/messages');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { messagesService } = await import('../../src/services/messages');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);

            const contextWithoutIds = { userId: 'user-123', text: 'Hello' };
            const result = await generator.generateForMessage(contextWithoutIds, true);

            expect(aiService.generateReply).not.toHaveBeenCalled();
            expect(result.replyText).toBeNull();
        });

        it('should trigger hallucination guard in DM when RAG attempted and 0 chunks', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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

        it('should NOT trigger hallucination guard in DM when RAG not attempted (static KB)', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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

        it('should use template for DM messages when AI is disabled', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Price Info',
                message: 'Our prices start at $10.',
            } as any);

            // Templates only fire for DMs when AI is disabled — AI handles DMs when enabled
            const result = await generator.generateForMessage(baseContext, false);

            expect(result.replyText).toBe('Our prices start at $10.');
            expect(result.replyMethod).toBe('template');
        });
    });

    // --- Template word-limit guard tests ---

    describe('template word-limit guard', () => {
        let generator: ReplyGenerator;

        beforeEach(() => {
            vi.clearAllMocks();
            generator = new ReplyGenerator();
        });

        it('should use template for short Arabic query (≤ 6 words)', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1', templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1', name: 'Pricing', message: 'أسعارنا تبدأ من ١٠٠ ريال',
            } as any);

            // "كم سعر الدورة" = 3 words → should hit template
            const result = await generator.generateForComment(
                { userId: 'u', text: 'كم سعر الدورة', pageName: 'Test' }, true,
            );

            expect(result.replyMethod).toBe('template');
            expect(result.replyText).toBe('أسعارنا تبدأ من ١٠٠ ريال');
        });

        it('should skip template for long Arabic message (> 6 words) — the original bug', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            // The rule WOULD match "تسجيل" keyword, but word count guard prevents it
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'يمكنك إعادة تعيين كلمة السر من صفحة الدخول.',
                language: 'ar', cached: false, intent: 'QUESTION', confidence: 'high', flags: [],
            });

            // "أنا ناسي كلمة السر لنظام التسجيل ممكن تساعدوني" = 7 words → skip template
            const result = await generator.generateForComment(
                { userId: 'u', text: 'أنا ناسي كلمة السر لنظام التسجيل ممكن تساعدوني', pageName: 'Test' }, true,
            );

            expect(result.replyMethod).toBe('ai');
            // findMatchingRule should NOT have been called (word count check short-circuits)
            expect(rulesService.findMatchingRule).not.toHaveBeenCalled();
        });

        it('should skip template for long English message (> 6 words)', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'I can help with both. For returns, please visit...',
                language: 'en', cached: false, intent: 'QUESTION', confidence: 'high', flags: [],
            });

            // 10 words → skip template
            const result = await generator.generateForComment(
                { userId: 'u', text: 'I want to return the product and also know the price', pageName: 'Test' }, true,
            );

            expect(result.replyMethod).toBe('ai');
            expect(rulesService.findMatchingRule).not.toHaveBeenCalled();
        });

        it('should still use template at exactly 6 words (boundary)', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1', templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1', name: 'Registration', message: 'يمكنك التسجيل من الرابط التالي',
            } as any);

            // "كيف اسجل في منصتكم لو سمحت" = 6 words → still eligible for template
            const result = await generator.generateForComment(
                { userId: 'u', text: 'كيف اسجل في منصتكم لو سمحت', pageName: 'Test' }, true,
            );

            expect(result.replyMethod).toBe('template');
            expect(rulesService.findMatchingRule).toHaveBeenCalled();
        });

        it('should skip template for long message in DMs too', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Let me help you with the password reset.',
                language: 'en', cached: false, intent: 'QUESTION', confidence: 'high', flags: [],
            });

            // 9 words → skip template in DMs
            const result = await generator.generateForMessage(
                { userId: 'u', text: 'I forgot my password for the registration system help', pageName: 'Test', pageId: 'p1', senderId: 's1' }, true,
            );

            expect(result.replyMethod).toBe('ai');
            expect(rulesService.findMatchingRule).not.toHaveBeenCalled();
        });
    });

    // --- Language-aware template selection tests ---

    describe('language-aware template selection', () => {
        let generator: ReplyGenerator;

        beforeEach(() => {
            vi.clearAllMocks();
            generator = new ReplyGenerator();
        });

        it('should select Arabic template for Arabic comment', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');
            const { detectLanguageCode } = await import('../../src/utils/language');

            vi.mocked(detectLanguageCode).mockReturnValue('ar');
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Price',
                message: 'أسعارنا تبدأ من ١٠ دولار.',
            } as any);

            const result = await generator.generateForComment(
                { userId: 'u', text: 'كم السعر', pageName: 'Test' }, true,
            );

            expect(result.replyText).toBe('أسعارنا تبدأ من ١٠ دولار.');
        });

        it('should select English template for English comment', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');
            const { detectLanguageCode } = await import('../../src/utils/language');

            vi.mocked(detectLanguageCode).mockReturnValue('en');
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Price',
                message: 'Our prices start at $10.',
            } as any);

            const result = await generator.generateForComment(
                { userId: 'u', text: 'what is the price', pageName: 'Test' }, true,
            );

            expect(result.replyText).toBe('Our prices start at $10.');
        });

        it('should fall back to English when detected language has no template', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');
            const { detectLanguageCode } = await import('../../src/utils/language');

            vi.mocked(detectLanguageCode).mockReturnValue('ar');
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'English Only',
                message: 'Welcome!',
            } as any);

            const result = await generator.generateForComment(
                { userId: 'u', text: 'مرحبا', pageName: 'Test' }, true,
            );

            expect(result.replyText).toBe('Welcome!');
        });

        it('should use Arabic for unknown language when text contains Arabic chars', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');
            const { detectLanguageCode } = await import('../../src/utils/language');

            vi.mocked(detectLanguageCode).mockReturnValue('unknown');
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Mixed',
                message: 'أهلاً!',
            } as any);

            // Mixed Arabic/English — "unknown" language but has Arabic chars
            const result = await generator.generateForComment(
                { userId: 'u', text: 'Hello مرحبا', pageName: 'Test' }, true,
            );

            expect(result.replyText).toBe('أهلاً!');
        });

        it('should default to English for unknown language with no Arabic chars', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { templatesService } = await import('../../src/services/templates');
            const { detectLanguageCode } = await import('../../src/utils/language');

            vi.mocked(detectLanguageCode).mockReturnValue('unknown');
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
                id: 'rule-1',
                templateId: 'template-1',
            } as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue({
                id: 'template-1',
                name: 'Mixed',
                message: 'Welcome!',
            } as any);

            const result = await generator.generateForComment(
                { userId: 'u', text: '123', pageName: 'Test' }, true,
            );

            expect(result.replyText).toBe('Welcome!');
        });
    });
});

// --- Template Priority Guard Tests ---
// Guard net: template match MUST always take priority over AI.
// If a rule + template matches the comment, AI should NEVER be called.

describe('ReplyGenerator - Template Priority Guard', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        generator = new ReplyGenerator();
    });

    const contextWithWorkspace = {
        workspaceId: 'ws-123',
        userId: 'user-123',
        text: 'ممكن سعر',
        pageName: 'Test Page',
        pageId: 'page-1',
    };

    it('should return template reply and NOT call AI when rule matches', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { aiService } = await import('../../src/services/ai');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1',
            templateId: 'template-1',
            keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1',
            name: 'Price Inquiry',
            message: 'أسعارنا تبدأ من ٩ دولار شهرياً',
            active: true,
        } as any);

        const result = await generator.generateForComment(contextWithWorkspace, true);

        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toBe('أسعارنا تبدأ من ٩ دولار شهرياً');
        expect(result.templateId).toBe('template-1');
        // AI must NOT be called — template takes priority
        expect(aiService.generateReply).not.toHaveBeenCalled();
    });

    it('should return template reply in dual mode without calling AI', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { aiService } = await import('../../src/services/ai');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1',
            templateId: 'template-1',
            keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1',
            name: 'Price Inquiry',
            message: 'الباقة التجريبية $15، باقة الأعمال $39، الباقة الاحترافية $79',
            active: true,
        } as any);

        // Dual mode — template should still take priority
        const result = await generator.generateForComment(contextWithWorkspace, true, 'dual');

        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toContain('$15');
        expect(aiService.generateReply).not.toHaveBeenCalled();
    });

    it('should return template reply in private mode without calling AI', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { aiService } = await import('../../src/services/ai');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1',
            templateId: 'template-1',
            keywords: ['price'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1',
            name: 'Pricing',
            message: 'Our plans start at $15/month.',
            active: true,
        } as any);

        const result = await generator.generateForComment(
            { ...contextWithWorkspace, text: 'what is the price?' },
            true,
            'private',
        );

        expect(result.replyMethod).toBe('template');
        expect(aiService.generateReply).not.toHaveBeenCalled();
    });

    it('should fall through to AI when rule matches but template is inactive', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { aiService } = await import('../../src/services/ai');
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1',
            templateId: 'template-1',
            keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1',
            name: 'Inactive Template',
            message: 'This should not be sent',
            active: false,  // INACTIVE
        } as any);
        vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
            allowed: true, limit: 1500, used: 0, remaining: 1500,
        } as any);
        vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
        vi.mocked(aiService.generateReply).mockResolvedValue({
            reply: 'AI fallback reply',
            language: 'ar',
            cached: false,
            intent: 'QUESTION',
            confidence: 'high',
            flags: [],
        });

        const result = await generator.generateForComment(contextWithWorkspace, true);

        // Template was inactive, so AI should be called
        expect(result.replyMethod).toBe('ai');
        expect(aiService.generateReply).toHaveBeenCalled();
    });

    it('should fall through to AI when rule has no templateId', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { aiService } = await import('../../src/services/ai');
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1',
            templateId: null,  // No template linked
            keywords: ['سعر'],
        } as any);
        vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
            allowed: true, limit: 1500, used: 0, remaining: 1500,
        } as any);
        vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
        vi.mocked(aiService.generateReply).mockResolvedValue({
            reply: 'AI reply for unlinked rule',
            language: 'ar',
            cached: false,
            intent: 'QUESTION',
            confidence: 'high',
            flags: [],
        });

        const result = await generator.generateForComment(contextWithWorkspace, true);

        expect(result.replyMethod).toBe('ai');
        expect(aiService.generateReply).toHaveBeenCalled();
    });

    it('should fall through to AI when template message is empty', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { aiService } = await import('../../src/services/ai');
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1',
            templateId: 'template-1',
            keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1',
            name: 'Empty Template',
            message: '',  // Empty message
            active: true,
        } as any);
        vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
            allowed: true, limit: 1500, used: 0, remaining: 1500,
        } as any);
        vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
        vi.mocked(aiService.generateReply).mockResolvedValue({
            reply: 'AI reply',
            language: 'ar',
            cached: false,
            intent: 'QUESTION',
            confidence: 'high',
            flags: [],
        });

        const result = await generator.generateForComment(contextWithWorkspace, true);

        expect(result.replyMethod).toBe('ai');
        expect(aiService.generateReply).toHaveBeenCalled();
    });

    it('should pass workspaceId to findMatchingRule (not userId)', async () => {
        const { rulesService } = await import('../../src/services/rules');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);

        await generator.generateForComment(contextWithWorkspace, false);

        // Verify workspaceId is passed, not userId
        expect(rulesService.findMatchingRule).toHaveBeenCalledWith('ws-123', 'ممكن سعر');
    });

    it('should skip template for DM and use AI when AI is enabled', async () => {
        // DMs belong to AI — templates only fire for DMs when AI is disabled.
        // Comments and DMs no longer share the same template-first behavior.
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { aiService } = await import('../../src/services/ai');
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1',
            templateId: 'template-1',
            keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1',
            name: 'Price DM',
            message: 'أسعارنا تبدأ من ٩ دولار',
            active: true,
        } as any);
        vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
            allowed: true, limit: 1500, used: 0, remaining: 1500,
        } as any);
        vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
        vi.mocked(aiService.generateReply).mockResolvedValue({
            reply: 'أسعارنا تبدأ من ٩ دولار شهرياً',
            language: 'ar', cached: false, intent: 'QUESTION', confidence: 'high', flags: [],
        });

        const result = await generator.generateForMessage({
            ...contextWithWorkspace,
            senderId: 'sender-1',
        }, true);

        // AI is on → template skipped → AI handles the DM
        expect(result.replyMethod).toBe('ai');
        expect(aiService.generateReply).toHaveBeenCalled();
    });
});

// --- Template Dedup for DMs ---
// When the same template text was already sent to a sender in a DM conversation,
// skip the template and let AI handle the follow-up with conversation context.

describe('ReplyGenerator - Template Dedup for DMs', () => {
    let generator: ReplyGenerator;

    const dmContext = {
        workspaceId: 'ws-123',
        userId: 'user-123',
        text: 'تفاصيل الاسعار',
        pageName: 'Test Page',
        pageId: 'page-1',
        senderId: 'sender-1',
    };

    const templateReplyText = 'أسعارنا تبدأ من ٩ دولار شهرياً';

    beforeEach(() => {
        vi.clearAllMocks();
        generator = new ReplyGenerator();
    });

    it('DM with AI disabled: template fires as fallback', async () => {
        // When AI is off, templates fire for DMs regardless of conversation history.
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { aiService } = await import('../../src/services/ai');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1', templateId: 'template-1', keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1', name: 'Price', message: templateReplyText, active: true,
        } as any);

        const result = await generator.generateForMessage(dmContext, false);

        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toBe(templateReplyText);
        expect(aiService.generateReply).not.toHaveBeenCalled();
    });

    it('repeat DM: same template text in history → AI takes over', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { messagesService } = await import('../../src/services/messages');
        const { aiService } = await import('../../src/services/ai');
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1', templateId: 'template-1', keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1', name: 'Price', message: templateReplyText, active: true,
        } as any);
        // History already contains the exact same template reply
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
            { role: 'user', content: 'عطيني السعر', timestamp: new Date() },
            { role: 'assistant', content: templateReplyText, timestamp: new Date() },
        ] as any);
        vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
            allowed: true, limit: 1500, used: 0, remaining: 1500,
        } as any);
        vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
        vi.mocked(aiService.generateReply).mockResolvedValue({
            reply: 'الباقة التجريبية ٩ دولار، باقة الأعمال ٢٩ دولار. ايش الباقة اللي تناسبك؟',
            language: 'ar', cached: false, intent: 'QUESTION', confidence: 'high', flags: [],
        });

        const result = await generator.generateForMessage(dmContext, true);

        // Template was skipped because it's a repeat — AI handled it
        expect(result.replyMethod).toBe('ai');
        expect(aiService.generateReply).toHaveBeenCalled();
    });

    it('different template: fires even with history from another template', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { messagesService } = await import('../../src/services/messages');
        const { aiService } = await import('../../src/services/ai');

        const differentTemplateText = 'ساعات العمل من ٩ صباحاً لـ ٥ مساءً';

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-2', templateId: 'template-2', keywords: ['ساعات'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-2', name: 'Hours', message: differentTemplateText, active: true,
        } as any);
        // History has a DIFFERENT template reply (the pricing one)
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
            { role: 'user', content: 'عطيني السعر', timestamp: new Date() },
            { role: 'assistant', content: templateReplyText, timestamp: new Date() },
        ] as any);

        const result = await generator.generateForMessage(
            { ...dmContext, text: 'شو ساعات العمل' }, false,
        );

        // AI disabled → template fires regardless of history
        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toBe(differentTemplateText);
        expect(aiService.generateReply).not.toHaveBeenCalled();
    });

    it('AI disabled: template always fires (no dedup) even with history', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { messagesService } = await import('../../src/services/messages');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1', templateId: 'template-1', keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1', name: 'Price', message: templateReplyText, active: true,
        } as any);
        // Even though history has the same reply, AI is disabled so dedup is skipped
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
            { role: 'assistant', content: templateReplyText, timestamp: new Date() },
        ] as any);

        const result = await generator.generateForMessage(dmContext, false);

        // AI disabled → dedup not checked → template fires as-is
        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toBe(templateReplyText);
    });

    it('no senderId: template fires (no dedup possible)', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { messagesService } = await import('../../src/services/messages');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1', templateId: 'template-1', keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1', name: 'Price', message: templateReplyText, active: true,
        } as any);

        // No senderId, AI disabled → template fires as fallback
        const contextNoSender = { ...dmContext, senderId: undefined };
        const result = await generator.generateForMessage(contextNoSender, false);

        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toBe(templateReplyText);
        // getConversationHistory should NOT be called when senderId is missing
        expect(messagesService.getConversationHistory).not.toHaveBeenCalled();
    });

});

// --- shouldSkipReply tests ---

import { shouldSkipReply } from '../../src/services/reply/generator';

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

describe('Store routing — skip preset replies for store pages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should skip template matching when ecommerceStoreId is present', async () => {
        const { rulesService } = await import('../../src/services/rules');

        const generator = new ReplyGenerator();
        await generator.generateForComment(
            {
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: 'كم السعر',
                pageName: 'Store Page',
                pageId: 'page-1',
                ecommerceStoreId: 'store-uuid',
            },
            true,
            'public',
        );

        // Template matching should be skipped — AI handles store pages
        expect(rulesService.findMatchingRule).not.toHaveBeenCalled();
    });

    it('should try template matching when no store is connected', async () => {
        const { rulesService } = await import('../../src/services/rules');
        vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);

        const generator = new ReplyGenerator();
        await generator.generateForComment(
            {
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: 'السعر',
                pageName: 'Page',
                pageId: 'page-1',
            },
            true,
            'public',
        );

        // Template matching should be attempted — no store connected
        expect(rulesService.findMatchingRule).toHaveBeenCalled();
    });

    describe('@mention handling in comments', () => {
        let generator: ReplyGenerator;

        beforeEach(() => {
            vi.clearAllMocks();
            generator = new ReplyGenerator();
        });

        it('should return SPAM_OR_IRRELEVANT without calling AI for mention-only comment with no postMessage', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);

            const result = await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: '@Ali Ahdab',
                pageName: 'الفريق الدمشقي',
                pageId: 'page-1',
                // no postMessage
            }, true);

            // @Ali Ahdab stripped → empty → no postMessage → short-circuit, no AI call
            expect(aiService.generateReply).not.toHaveBeenCalled();
            expect(result.aiIntent).toBe('SPAM_OR_IRRELEVANT');
            expect(result.replyText).toBeNull();
        });

        it('should return SPAM_OR_IRRELEVANT without calling AI for URL-only comment with no postMessage', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);

            const result = await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: 'https://example.com/check-this',
                pageName: 'Test Page',
                pageId: 'page-1',
                // no postMessage
            }, true);

            // URL stripped → empty → no postMessage → short-circuit, no AI call
            expect(aiService.generateReply).not.toHaveBeenCalled();
            expect(result.aiIntent).toBe('SPAM_OR_IRRELEVANT');
        });

        it('should call AI when mention-only comment has postMessage context', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'أهلاً! كيف يمكنني مساعدتك؟',
                language: 'ar',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: '@Ali Ahdab',
                pageName: 'الفريق الدمشقي',
                pageId: 'page-1',
                postMessage: 'علق لتصلك الأسعار',
            }, true);

            // postMessage present → pass to AI with empty comment so it uses post context
            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({ comment: '' }),
            );
        });

        it('should preserve message content after stripping leading @mention', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'السعر 50 ألف',
                language: 'ar',
                cached: false,
                intent: 'QUESTION',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: '@Ali كم السعر؟',
                pageName: 'Test Page',
                pageId: 'page-1',
            }, true);

            // @mention stripped, actual question preserved
            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({ comment: 'كم السعر؟' }),
            );
        });

        it('should pass senderName as customerContext for comments', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'أهلاً نور!',
                language: 'ar',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: 'مرحبا',
                pageName: 'Test Page',
                pageId: 'page-1',
                senderName: 'Noor ALashkar',
            }, true);

            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: expect.objectContaining({
                        customerContext: 'Customer name: Noor ALashkar.',
                    }),
                }),
            );
        });

        it('should not set customerContext when senderName is absent', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Hello!',
                language: 'en',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                text: 'Hello',
                pageName: 'Test Page',
                pageId: 'page-1',
                // no senderName
            }, true);

            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: expect.not.objectContaining({
                        customerContext: expect.anything(),
                    }),
                }),
            );
        });

        it('should fall back to post language when comment is mention-only', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            const { detectCommentLanguage } = await import('../../src/utils/language');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            // Simulate real detectCommentLanguage: empty comment → falls back to post language
            vi.mocked(detectCommentLanguage).mockImplementation((commentText, postMessage) => {
                if (commentText && /[\u0600-\u06FF]/.test(commentText)) return 'ar';
                if (!commentText && postMessage && /[\u0600-\u06FF]/.test(postMessage)) return 'ar';
                return 'en';
            });
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'أهلاً!',
                language: 'ar',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                // Latin @mention → stripped to '' → language 'unknown' → falls to Arabic post
                text: '@Ali Ahdab',
                pageName: 'الفريق الدمشقي',
                pageId: 'page-1',
                postMessage: 'كورس الاكسل المتقدم — 8 جلسات',
            }, true);

            // Language should be 'ar' (from post content), not 'en' (from raw @mention)
            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({ language: 'ar' }),
            );
        });

        it('should strip URLs before language detection', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            const { detectCommentLanguage } = await import('../../src/utils/language');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 } as any);
            vi.mocked(subscriptionsService.incrementAiReplies).mockResolvedValue(undefined);
            vi.mocked(detectCommentLanguage).mockImplementation((commentText, postMessage) => {
                if (commentText && /[\u0600-\u06FF]/.test(commentText)) return 'ar';
                if (!commentText && postMessage && /[\u0600-\u06FF]/.test(postMessage)) return 'ar';
                return 'en';
            });
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'أهلاً!',
                language: 'ar',
                cached: false,
                intent: 'GREETING',
                confidence: 'high',
                flags: [],
            });

            await generator.generateForComment({
                workspaceId: 'ws-1',
                userId: 'user-1',
                // URL-only comment → stripped to '' → falls to Arabic post language
                text: 'https://example.com/product',
                pageName: 'Test Page',
                pageId: 'page-1',
                postMessage: 'منتجاتنا الجديدة',
            }, true);

            // Language should be 'ar' (from post), not 'en' (from URL Latin chars)
            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({ language: 'ar' }),
            );
            // URL stripped — AI receives empty comment, not the raw URL
            expect(aiService.generateReply).toHaveBeenCalledWith(
                expect.objectContaining({ comment: '' }),
            );
        });
    });
});
