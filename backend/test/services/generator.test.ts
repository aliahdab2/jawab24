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

        it('should flag when AI confidence is low', async () => {
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
