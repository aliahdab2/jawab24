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

describe('OpenAI Service - Structured JSON Response', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should parse structured JSON response with intent, confidence, and flags', async () => {
        const jsonResponse = JSON.stringify({
            reply: 'Thank you for your feedback!',
            intent: 'COMPLIMENT',
            confidence: 'high',
            flags: [],
        });

        vi.doMock('openai', () => ({
            default: vi.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValue({
                            choices: [{ message: { content: jsonResponse } }],
                            usage: { total_tokens: 60 },
                        }),
                    },
                },
            })),
        }));
        vi.doMock('../src/config', () => ({
            config: {
                openai: { apiKey: 'test-key', model: 'gpt-4o-mini', maxTokens: 150, temperature: 0.7 },
            },
        }));

        const { OpenAIService: FreshService } = await import('../src/services/openai');
        const service = new FreshService();
        const result = await service.generateReply({ comment: 'Great product!' });

        expect(result.reply).toBe('Thank you for your feedback!');
        expect(result.intent).toBe('COMPLIMENT');
        expect(result.confidence).toBe('high');
        expect(result.flags).toEqual([]);
        expect(result.tokensUsed).toBe(60);
    });

    it('should parse JSON response with flags for angry customer', async () => {
        const jsonResponse = JSON.stringify({
            reply: 'We sincerely apologize. Please contact us directly so we can resolve this.',
            intent: 'COMPLAINT',
            confidence: 'high',
            flags: ['angry_customer'],
        });

        vi.doMock('openai', () => ({
            default: vi.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValue({
                            choices: [{ message: { content: jsonResponse } }],
                            usage: { total_tokens: 80 },
                        }),
                    },
                },
            })),
        }));
        vi.doMock('../src/config', () => ({
            config: {
                openai: { apiKey: 'test-key', model: 'gpt-4o-mini', maxTokens: 150, temperature: 0.7 },
            },
        }));

        const { OpenAIService: FreshService } = await import('../src/services/openai');
        const service = new FreshService();
        const result = await service.generateReply({ comment: 'This is terrible!' });

        expect(result.intent).toBe('COMPLAINT');
        expect(result.flags).toEqual(['angry_customer']);
    });

    it('should parse JSON with multiple flags', async () => {
        const jsonResponse = JSON.stringify({
            reply: 'Please contact us for pricing details.',
            intent: 'QUESTION',
            confidence: 'low',
            flags: ['price_not_in_kb', 'low_confidence', 'redirect_to_human'],
        });

        vi.doMock('openai', () => ({
            default: vi.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValue({
                            choices: [{ message: { content: jsonResponse } }],
                            usage: { total_tokens: 70 },
                        }),
                    },
                },
            })),
        }));
        vi.doMock('../src/config', () => ({
            config: {
                openai: { apiKey: 'test-key', model: 'gpt-4o-mini', maxTokens: 150, temperature: 0.7 },
            },
        }));

        const { OpenAIService: FreshService } = await import('../src/services/openai');
        const service = new FreshService();
        const result = await service.generateReply({ comment: 'How much does the premium package cost?' });

        expect(result.confidence).toBe('low');
        expect(result.flags).toHaveLength(3);
        expect(result.flags).toContain('price_not_in_kb');
        expect(result.flags).toContain('low_confidence');
        expect(result.flags).toContain('redirect_to_human');
    });

    it('should fall back to plain text when AI returns non-JSON', async () => {
        vi.doMock('openai', () => ({
            default: vi.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValue({
                            choices: [{ message: { content: 'Just a plain text reply' } }],
                            usage: { total_tokens: 30 },
                        }),
                    },
                },
            })),
        }));
        vi.doMock('../src/config', () => ({
            config: {
                openai: { apiKey: 'test-key', model: 'gpt-4o-mini', maxTokens: 150, temperature: 0.7 },
            },
        }));

        const { OpenAIService: FreshService } = await import('../src/services/openai');
        const service = new FreshService();
        const result = await service.generateReply({ comment: 'Hello' });

        expect(result.reply).toBe('Just a plain text reply');
        expect(result.intent).toBe('UNKNOWN');
        expect(result.confidence).toBe('low');
        expect(result.flags).toEqual(['invalid_json']);
    });

    it('should use fallback reply text when JSON reply field is empty', async () => {
        const jsonResponse = JSON.stringify({
            reply: '',
            intent: 'GREETING',
            confidence: 'medium',
            flags: [],
        });

        vi.doMock('openai', () => ({
            default: vi.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValue({
                            choices: [{ message: { content: jsonResponse } }],
                            usage: { total_tokens: 40 },
                        }),
                    },
                },
            })),
        }));
        vi.doMock('../src/config', () => ({
            config: {
                openai: { apiKey: 'test-key', model: 'gpt-4o-mini', maxTokens: 150, temperature: 0.7 },
            },
        }));

        const { OpenAIService: FreshService } = await import('../src/services/openai');
        const service = new FreshService();
        const result = await service.generateReply({ comment: 'Hi!' });

        // Should use fallback when parsed reply is empty
        expect(result.reply).toContain('Thank you');
    });

    it('should return confidence: low and flags: [fallback_reply] on API error', async () => {
        vi.doMock('openai', () => ({
            default: vi.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: vi.fn().mockRejectedValue(new Error('API error')),
                    },
                },
            })),
        }));
        vi.doMock('../src/config', () => ({
            config: {
                openai: { apiKey: 'test-key', model: 'gpt-4o-mini', maxTokens: 150, temperature: 0.7 },
            },
        }));

        const { OpenAIService: FreshService } = await import('../src/services/openai');
        const service = new FreshService();
        const result = await service.generateReply({ comment: 'Hello' });

        expect(result.confidence).toBe('low');
        expect(result.flags).toEqual(['fallback_reply']);
        expect(result.reply).toContain('Thank you');
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

    it('should include pageName in fallback when provided', async () => {
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
            context: { pageName: 'My Store' },
        });

        expect(result.reply).toContain('My Store');
        expect(result.reply).toContain('Thank you');
    });
});

