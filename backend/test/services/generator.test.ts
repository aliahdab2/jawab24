import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator, shouldSkipReply } from '../../src/services/reply/generator';

// Mock all dependencies
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

        it('should return fallback when AI limit is reached', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
                allowed: false, limit: 100, used: 100, remaining: 0, reason: 'limit_reached',
            } as any);

            const result = await generator.generateForComment(baseContext, true);

            expect(result.replyText).toBe('Thank you for your comment!');
            expect(result.replyMethod).toBe('template');
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

        it('should return fallback when AI limit is reached for messages', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
                allowed: false, limit: 100, used: 100, remaining: 0, reason: 'limit_reached',
            } as any);

            const result = await generator.generateForMessage(baseContext, true);

            expect(result.replyText).toBe('Thank you for your message! We will get back to you soon.');
            expect(result.replyMethod).toBe('template');
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

