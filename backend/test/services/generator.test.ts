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
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: vi.fn().mockResolvedValue([]),
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

        it('should add info_not_in_kb flag when 0 chunks retrieved and GPT claims high confidence on QUESTION', async () => {
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

            // kbActiveVersion: null forces RAG off → 0 retrieved chunks
            const result = await generator.generateForComment({
                ...baseContext,
                kbActiveVersion: null,
            }, true);

            expect(result.needsAttention).toBe(true);
            expect(result.flagReason).toContain('info_not_in_kb');
            expect(result.flagReason).toContain('low_confidence');
        });

        it('should NOT trigger hallucination guard when confidence is medium (only high triggers)', async () => {
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
                confidence: 'medium',
                flags: [],
            });

            const result = await generator.generateForComment({
                ...baseContext,
                kbActiveVersion: null,
            }, true);

            // medium confidence + 0 chunks should NOT add info_not_in_kb
            expect(result.flagReason).toBeUndefined();
            expect(result.needsAttention).toBe(false);
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

            expect(messagesService.getConversationHistory).toHaveBeenCalledWith('page-123', 'sender-456', 6);
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

        it('should use template for messages when rule matches', async () => {
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

            const result = await generator.generateForMessage(baseContext, true);

            expect(result.replyText).toBe('Our prices start at $10.');
            expect(result.replyMethod).toBe('template');
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
            message: 'الباقة التجريبية $9، باقة الأعمال $29، الباقة الاحترافية $69',
            active: true,
        } as any);

        // Dual mode — template should still take priority
        const result = await generator.generateForComment(contextWithWorkspace, true, 'dual');

        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toContain('$9');
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
            message: 'Our plans start at $9/month.',
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

    it('should match template for DM (generateForMessage) the same way as comments', async () => {
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
            name: 'Price DM',
            message: 'أسعارنا تبدأ من ٩ دولار',
            active: true,
        } as any);

        const result = await generator.generateForMessage({
            ...contextWithWorkspace,
            senderId: 'sender-1',
        }, true);

        expect(result.replyMethod).toBe('template');
        expect(result.replyText).toBe('أسعارنا تبدأ من ٩ دولار');
        expect(aiService.generateReply).not.toHaveBeenCalled();
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

    it('first DM: template fires when no conversation history', async () => {
        const { rulesService } = await import('../../src/services/rules');
        const { templatesService } = await import('../../src/services/templates');
        const { messagesService } = await import('../../src/services/messages');
        const { aiService } = await import('../../src/services/ai');

        vi.mocked(rulesService.findMatchingRule).mockResolvedValue({
            id: 'rule-1', templateId: 'template-1', keywords: ['سعر'],
        } as any);
        vi.mocked(templatesService.getTemplate).mockResolvedValue({
            id: 'template-1', name: 'Price', message: templateReplyText, active: true,
        } as any);
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue([]);

        const result = await generator.generateForMessage(dmContext, true);

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
            { ...dmContext, text: 'شو ساعات العمل' }, true,
        );

        // Different template text → not a repeat → template fires
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

        // No senderId → can't check conversation history → dedup skipped
        const contextNoSender = { ...dmContext, senderId: undefined };
        const result = await generator.generateForMessage(contextNoSender, true);

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

    it('should return true for low_confidence flag', () => {
        expect(shouldSkipReply('low_confidence')).toBe(true);
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

    it('should return true when low_confidence is among multiple flags', () => {
        expect(shouldSkipReply('price_not_in_kb,low_confidence')).toBe(true);
    });

    it('should return true for SPAM_OR_IRRELEVANT intent', () => {
        expect(shouldSkipReply(undefined, 'SPAM_OR_IRRELEVANT')).toBe(true);
    });

    it('should return true for spam_or_irrelevant intent (case-insensitive)', () => {
        expect(shouldSkipReply(undefined, 'spam_or_irrelevant')).toBe(true);
    });
});
