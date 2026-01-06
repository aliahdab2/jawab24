import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService } from '../../src/services/ai';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock database
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([]),
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        }),
        delete: vi.fn().mockReturnValue({
            from: vi.fn().mockResolvedValue(undefined),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    aiCache: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
}));

// Mock Redis
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
        quit: vi.fn(),
    },
}));

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        ai: {
            enabled: true,
            cacheEnabled: true,
            serviceUrl: 'http://localhost:3002',
            defaultModel: 'gpt-4-mini',
        },
    },
}));

describe('AI Service', () => {
    let service: AiService;

    beforeEach(() => {
        service = new AiService();
        vi.clearAllMocks();
    });

    describe('generateReply', () => {
        it('should generate reply from AI service', async () => {
            const mockResponse = {
                data: {
                    reply: 'Thank you for your comment!',
                    language: 'en',
                },
            };

            vi.mocked(axios.post).mockResolvedValue(mockResponse);

            const result = await service.generateReply({
                comment: 'Great product!',
            });

            expect(result.reply).toBe('Thank you for your comment!');
            expect(result.language).toBe('en');
            expect(result.cached).toBe(false);
        });

        it('should include context in AI request', async () => {
            const mockResponse = {
                data: {
                    reply: 'Thanks for asking about our new product!',
                    language: 'en',
                },
            };

            vi.mocked(axios.post).mockResolvedValue(mockResponse);

            await service.generateReply({
                comment: 'Is this available?',
                language: 'en',
                context: {
                    postMessage: 'New product launch!',
                    pageName: 'My Store',
                },
            });

            expect(axios.post).toHaveBeenCalledWith(
                'http://localhost:3002/generate',
                expect.objectContaining({
                    comment: 'Is this available?',
                    language: 'en',
                    context: {
                        postMessage: 'New product launch!',
                        pageName: 'My Store',
                    },
                }),
                expect.any(Object)
            );
        });

        it('should return fallback on AI service error', async () => {
            vi.mocked(axios.post).mockRejectedValue(new Error('Service unavailable'));

            const result = await service.generateReply({
                comment: 'Hello!',
            });

            expect(result.reply).toBe('Thank you for your comment!');
            expect(result.model).toBe('fallback');
        });

        it('should respect language parameter', async () => {
            const mockResponse = {
                data: {
                    reply: 'شكراً لك!',
                    language: 'ar',
                },
            };

            vi.mocked(axios.post).mockResolvedValue(mockResponse);

            const result = await service.generateReply({
                comment: 'مرحبا',
                language: 'ar',
            });

            expect(result.language).toBe('ar');
        });
    });

    describe('getCacheStats', () => {
        it('should return cache statistics', async () => {
            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockResolvedValue([
                    { hitCount: 10 },
                    { hitCount: 5 },
                    { hitCount: 3 },
                ]),
            } as any);

            const stats = await service.getCacheStats();

            expect(stats.totalEntries).toBe(3);
            expect(stats.totalHits).toBe(18);
        });

        it('should handle empty cache', async () => {
            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockResolvedValue([]),
            } as any);

            const stats = await service.getCacheStats();

            expect(stats.totalEntries).toBe(0);
            expect(stats.totalHits).toBe(0);
        });
    });

    describe('clearCache', () => {
        it('should clear all cache entries', async () => {
            const { db } = await import('../../src/db');

            await service.clearCache();

            expect(db.delete).toHaveBeenCalled();
        });
    });
    describe('normalization', () => {
        it('should normalize comments for better cache hits', async () => {
            const { redis } = await import('../../src/lib/redis');

            // 1. Prime the cache (simulated)
            const baseComment = 'Price';
            await service.saveToCache(baseComment, 'Cached Response', 'en');

            // Capture the exact key used for storage
            const setCall = vi.mocked(redis.set).mock.calls[0];
            const storageKey = setCall[0];

            // Ensure redis.get returns a hit so we don't fall back to DB
            vi.mocked(redis.get).mockResolvedValue('Cached Response');

            vi.clearAllMocks(); // clear history

            // 2. Variations should all check against the storageKey
            const variations = [
                'Price?',
                'price.',
                'PRICE',
                'Price 😡',
                '  price  '
            ];

            for (const v of variations) {
                await service.checkCache(v, 'en');
                expect(redis.get).toHaveBeenCalledWith(storageKey);
                vi.clearAllMocks();
            }
        });
    });
});

describe('AI Service (disabled)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should return default message when AI is disabled', async () => {
        vi.doMock('../../src/config', () => ({
            config: {
                ai: {
                    enabled: false,
                    cacheEnabled: false,
                    serviceUrl: 'http://localhost:3002',
                    defaultModel: 'gpt-4-mini',
                },
            },
        }));

        const { AiService: DisabledAiService } = await import('../../src/services/ai');
        const disabledService = new DisabledAiService();

        const result = await disabledService.generateReply({
            comment: 'Hello!',
        });

        expect(result.reply).toContain('Thank you');
        expect(result.model).toBe('disabled');
    });
});

