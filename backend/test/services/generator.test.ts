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
                translations: { en: 'Welcome to our page!' },
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

        it('should flag when angry_customer flag is present', async () => {
            const { rulesService } = await import('../../src/services/rules');
            const { aiService } = await import('../../src/services/ai');

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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

            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
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
    });
});
