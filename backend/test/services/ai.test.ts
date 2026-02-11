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
    sql: vi.fn().mockReturnValue('sql-mock'),
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

    describe('generateReply - flag propagation', () => {
        it('should propagate intent, confidence, and flags from AI worker', async () => {
            const mockResponse = {
                data: {
                    reply: 'We apologize for the issue.',
                    language: 'en',
                    intent: 'COMPLAINT',
                    confidence: 'high',
                    flags: ['angry_customer'],
                },
            };

            vi.mocked(axios.post).mockResolvedValue(mockResponse);

            const result = await service.generateReply({
                comment: 'This product is broken!',
            });

            expect(result.reply).toBe('We apologize for the issue.');
            expect(result.intent).toBe('COMPLAINT');
            expect(result.confidence).toBe('high');
            expect(result.flags).toEqual(['angry_customer']);
            expect(result.cached).toBe(false);
        });

        it('should propagate empty flags array when no flags', async () => {
            const mockResponse = {
                data: {
                    reply: 'Thank you!',
                    language: 'en',
                    intent: 'COMPLIMENT',
                    confidence: 'high',
                    flags: [],
                },
            };

            vi.mocked(axios.post).mockResolvedValue(mockResponse);

            const result = await service.generateReply({
                comment: 'Love this!',
            });

            expect(result.intent).toBe('COMPLIMENT');
            expect(result.confidence).toBe('high');
            expect(result.flags).toEqual([]);
        });

        it('should return metadata for cached replies', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(
                JSON.stringify({ reply: 'Cached response', intent: 'GREETING', confidence: 'high', flags: [] })
            );

            const result = await service.generateReply({
                comment: 'Hello',
            });

            expect(result.cached).toBe(true);
            expect(result.reply).toBe('Cached response');
            expect(result.intent).toBe('GREETING');
            expect(result.confidence).toBe('high');
            expect(result.flags).toEqual([]);
        });

        it('should treat old plain-text Redis entries as cache miss', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue('Plain text from old cache');

            const mockResponse = {
                data: {
                    reply: 'Fresh AI reply',
                    language: 'en',
                    intent: 'GREETING',
                    confidence: 'high',
                    flags: [],
                },
            };
            vi.mocked(axios.post).mockResolvedValue(mockResponse);

            const result = await service.generateReply({
                comment: 'Hello',
            });

            expect(result.cached).toBe(false);
            expect(result.reply).toBe('Fresh AI reply');
            expect(result.intent).toBe('GREETING');
        });

        it('should return no flag data on fallback error response', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(axios.post).mockRejectedValue(new Error('timeout'));

            const result = await service.generateReply({
                comment: 'Hello',
            });

            expect(result.model).toBe('fallback');
            expect(result.intent).toBeUndefined();
            expect(result.confidence).toBeUndefined();
            expect(result.flags).toBeUndefined();
        });

        it('should handle AI worker response without flag fields (backward compat)', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            const mockResponse = {
                data: {
                    reply: 'Thanks!',
                    language: 'en',
                    // No intent, confidence, or flags
                },
            };

            vi.mocked(axios.post).mockResolvedValue(mockResponse);

            const result = await service.generateReply({
                comment: 'Hello!',
            });

            expect(result.reply).toBe('Thanks!');
            expect(result.intent).toBeUndefined();
            expect(result.confidence).toBeUndefined();
            expect(result.flags).toBeUndefined();
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

    describe('getJobStatus', () => {
        it('should return not_found when job does not exist', async () => {
            vi.doMock('../../src/lib/queue', () => ({
                aiQueue: {
                    getJob: vi.fn().mockResolvedValue(null)
                }
            }));

            // Need to reimport to get fresh mock
            vi.resetModules();
            const { AiService: FreshAiService } = await import('../../src/services/ai');
            const freshService = new FreshAiService();

            const result = await freshService.getJobStatus('nonexistent-job');

            expect(result.status).toBe('not_found');
            expect(result.jobId).toBe('nonexistent-job');
        });

        it('should return completed status with result when job is done', async () => {
            const mockJob = {
                id: 'completed-job',
                returnvalue: { reply: 'AI generated reply' },
                getState: vi.fn().mockResolvedValue('completed')
            };

            vi.doMock('../../src/lib/queue', () => ({
                aiQueue: {
                    getJob: vi.fn().mockResolvedValue(mockJob)
                }
            }));

            vi.resetModules();
            const { AiService: FreshAiService } = await import('../../src/services/ai');
            const freshService = new FreshAiService();

            const result = await freshService.getJobStatus('completed-job');

            expect(result.status).toBe('completed');
            expect(result.result?.reply).toBe('AI generated reply');
        });

        it('should return failed status with error when job failed', async () => {
            const mockJob = {
                id: 'failed-job',
                failedReason: 'OpenAI API error',
                getState: vi.fn().mockResolvedValue('failed')
            };

            vi.doMock('../../src/lib/queue', () => ({
                aiQueue: {
                    getJob: vi.fn().mockResolvedValue(mockJob)
                }
            }));

            vi.resetModules();
            const { AiService: FreshAiService } = await import('../../src/services/ai');
            const freshService = new FreshAiService();

            const result = await freshService.getJobStatus('failed-job');

            expect(result.status).toBe('failed');
            expect(result.error).toBe('OpenAI API error');
        });

        it('should return active status when job is being processed', async () => {
            const mockJob = {
                id: 'active-job',
                getState: vi.fn().mockResolvedValue('active')
            };

            vi.doMock('../../src/lib/queue', () => ({
                aiQueue: {
                    getJob: vi.fn().mockResolvedValue(mockJob)
                }
            }));

            vi.resetModules();
            const { AiService: FreshAiService } = await import('../../src/services/ai');
            const freshService = new FreshAiService();

            const result = await freshService.getJobStatus('active-job');

            expect(result.status).toBe('active');
        });

        it('should return queued status for waiting jobs', async () => {
            const mockJob = {
                id: 'waiting-job',
                getState: vi.fn().mockResolvedValue('waiting')
            };

            vi.doMock('../../src/lib/queue', () => ({
                aiQueue: {
                    getJob: vi.fn().mockResolvedValue(mockJob)
                }
            }));

            vi.resetModules();
            const { AiService: FreshAiService } = await import('../../src/services/ai');
            const freshService = new FreshAiService();

            const result = await freshService.getJobStatus('waiting-job');

            expect(result.status).toBe('queued');
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

            vi.clearAllMocks(); // clear history

            // Re-mock redis.get to return JSON format (new cache format)
            const cachedJson = JSON.stringify({ reply: 'Cached Response', intent: 'QUESTION', confidence: 'high', flags: [] });
            vi.mocked(redis.get).mockResolvedValue(cachedJson);

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

describe('AI Service - Semantic Cache Integration', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function setupMocks(overrides: {
        redisReply?: string | null;
        dbCacheRows?: unknown[];
        axiosReply?: Record<string, unknown>;
        semanticCacheHit?: { reply: string; intent: string; confidence?: string; flags?: string[] } | null;
        openaiApiKey?: string;
    } = {}) {
        vi.doMock('../../src/lib/redis', () => ({
            redis: {
                get: vi.fn().mockResolvedValue(overrides.redisReply ?? null),
                set: vi.fn(),
                quit: vi.fn(),
            },
        }));

        vi.doMock('../../src/db', () => ({
            db: {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(overrides.dbCacheRows ?? []),
                    }),
                }),
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockReturnValue({
                        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
                    }),
                }),
                execute: vi.fn(),
            },
        }));

        vi.doMock('../../src/db/schema', () => ({ aiCache: {} }));
        vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), sql: vi.fn().mockReturnValue('sql-mock') }));

        const mockSemCache = {
            check: vi.fn().mockResolvedValue(overrides.semanticCacheHit ?? null),
            save: vi.fn().mockResolvedValue(undefined),
            setLogger: vi.fn(),
        };
        vi.doMock('../../src/services/kb/semantic-cache', () => ({
            semanticCacheService: mockSemCache,
        }));

        const mockEmbed = vi.fn().mockResolvedValue(new Array(512).fill(0.1));
        vi.doMock('../../src/services/kb/embedding', () => ({
            OpenAIEmbeddingProvider: vi.fn().mockImplementation(() => ({
                embed: mockEmbed,
                setLogger: vi.fn(),
            })),
        }));

        vi.doMock('../../src/config', () => ({
            config: {
                ai: { enabled: true, cacheEnabled: true, serviceUrl: 'http://localhost:3002', model: 'gpt-4o-mini' },
                openai: { apiKey: overrides.openaiApiKey ?? 'test-key' },
            },
        }));

        if (overrides.axiosReply) {
            vi.doMock('axios', () => ({
                default: { post: vi.fn().mockResolvedValue({ data: overrides.axiosReply }) },
            }));
        }

        return { mockSemCache, mockEmbed };
    }

    it('should return semantic cache hit when available', async () => {
        const { mockSemCache } = setupMocks({
            semanticCacheHit: { reply: 'Cached via semantic', intent: 'PRICE', confidence: 'high', flags: [] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        const result = await service.generateReply({
            comment: 'How much is this?',
            context: { pageId: 'page-1', kbActiveVersion: 1 },
        });

        expect(result.reply).toBe('Cached via semantic');
        expect(result.cached).toBe(true);
        expect(result.intent).toBe('PRICE');
        expect(mockSemCache.check).toHaveBeenCalledTimes(1);
    });

    it('should skip semantic cache when kbActiveVersion is null', async () => {
        const { mockSemCache } = setupMocks({
            axiosReply: { reply: 'Fresh AI reply', language: 'en', intent: 'QUESTION', confidence: 'high', flags: [] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { pageId: 'page-1', kbActiveVersion: null },
        });

        expect(mockSemCache.check).not.toHaveBeenCalled();
    });

    it('should skip semantic cache when no OPENAI_API_KEY and no pre-computed embedding', async () => {
        const { mockSemCache } = setupMocks({
            openaiApiKey: '',
            axiosReply: { reply: 'Fresh reply', language: 'en', intent: 'QUESTION', confidence: 'high', flags: [] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { pageId: 'page-1', kbActiveVersion: 1 },
        });

        expect(mockSemCache.check).not.toHaveBeenCalled();
    });

    it('should use pre-computed queryEmbedding instead of calling embed again', async () => {
        const preComputed = new Array(512).fill(0.5);
        const { mockSemCache, mockEmbed } = setupMocks({
            semanticCacheHit: null,
            axiosReply: { reply: 'Fresh', language: 'en', intent: 'PRICE', confidence: 'high', flags: [] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'How much?',
            context: { pageId: 'page-1', kbActiveVersion: 1, queryEmbedding: preComputed },
        });

        // Should use pre-computed embedding, NOT call embed()
        expect(mockEmbed).not.toHaveBeenCalled();
        // But should still check semantic cache
        expect(mockSemCache.check).toHaveBeenCalledTimes(1);
        // The embedding passed to check should be the pre-computed one
        expect(mockSemCache.check).toHaveBeenCalledWith('page-1', preComputed, expect.any(String), 1);
    });

    it('should save to semantic cache with pre-GPT intent after AI call', async () => {
        const { mockSemCache } = setupMocks({
            semanticCacheHit: null,
            axiosReply: { reply: 'Price is $50', language: 'en', intent: 'QUESTION', confidence: 'high', flags: [] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'How much is this?',
            context: { pageId: 'page-1', kbActiveVersion: 2 },
        });

        // Wait for fire-and-forget save
        await new Promise(r => setTimeout(r, 50));

        expect(mockSemCache.save).toHaveBeenCalledTimes(1);
        const saveArgs = mockSemCache.save.mock.calls[0][0];
        expect(saveArgs.pageId).toBe('page-1');
        expect(saveArgs.replyText).toBe('Price is $50');
        expect(saveArgs.kbActiveVersion).toBe(2);
        // Intent should be pre-GPT (PRICE), not GPT (QUESTION)
        expect(saveArgs.intent).toBe('PRICE');
    });

    it('should gracefully continue to AI when semantic cache check throws', async () => {
        const { mockSemCache } = setupMocks({
            axiosReply: { reply: 'Fallback AI reply', language: 'en', intent: 'QUESTION', confidence: 'high', flags: [] },
        });
        mockSemCache.check.mockRejectedValue(new Error('DB connection lost'));

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        const result = await service.generateReply({
            comment: 'Hello',
            context: { pageId: 'page-1', kbActiveVersion: 1 },
        });

        expect(result.reply).toBe('Fallback AI reply');
        expect(result.cached).toBe(false);
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

