import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIService } from '../src/services/openai';

// Mock OpenAI
vi.mock('openai', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        choices: [{ message: { content: 'Thank you for your feedback!' } }],
                        usage: { total_tokens: 50 },
                    }),
                },
            },
        })),
    };
});

// Mock config with API key
vi.mock('../src/config', () => ({
    config: {
        openai: {
            apiKey: 'test-api-key',
            model: 'gpt-4o-mini',
            maxTokens: 150,
            temperature: 0.7,
        },
    },
}));

describe('OpenAI Service', () => {
    let service: OpenAIService;

    beforeEach(() => {
        service = new OpenAIService();
    });

    describe('isConfigured', () => {
        it('should return true when API key is set', () => {
            expect(service.isConfigured()).toBe(true);
        });
    });

    describe('generateReply', () => {
        it('should generate a reply for a comment', async () => {
            const result = await service.generateReply({
                comment: 'Great product!',
            });

            expect(result.reply).toBe('Thank you for your feedback!');
            expect(result.language).toBe('en');
        });

        it('should detect Arabic language', async () => {
            const result = await service.generateReply({
                comment: 'منتج رائع!',
            });

            expect(result.language).toBe('ar');
        });

        it('should detect Swedish language', async () => {
            const result = await service.generateReply({
                comment: 'Bra produkt med bästa kvalité!',
            });

            expect(result.language).toBe('sv');
        });

        it('should use provided language', async () => {
            const result = await service.generateReply({
                comment: 'Great product!',
                language: 'ar',
            });

            expect(result.language).toBe('ar');
        });

        it('should include context in prompt', async () => {
            const result = await service.generateReply({
                comment: 'Is this available?',
                context: {
                    postMessage: 'New product launch!',
                    pageName: 'My Store',
                },
            });

            expect(result.reply).toBeDefined();
        });
    });
});

describe('OpenAI Service (unconfigured)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should return fallback when not configured', async () => {
        // Re-mock with empty API key
        vi.doMock('../src/config', () => ({
            config: {
                openai: {
                    apiKey: '',
                    model: 'gpt-4o-mini',
                    maxTokens: 150,
                    temperature: 0.7,
                },
            },
        }));

        const { OpenAIService: UnconfiguredService } = await import('../src/services/openai');
        const unconfiguredService = new UnconfiguredService();

        const result = await unconfiguredService.generateReply({
            comment: 'Hello!',
        });

        expect(result.reply).toContain('Thank you');
        expect(result.language).toBe('en');
    });
});

