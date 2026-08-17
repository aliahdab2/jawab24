import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService } from '../../src/services/ai';
import axios from 'axios';
import { db } from '../../src/db';
import * as sentry from '@sentry/node';

// Mock axios
vi.mock('axios');

// Mock Sentry — pass-through so spans don't require an active trace
vi.mock('@sentry/node', () => ({
    startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
    setTag: vi.fn(),
}));

// Mock email service — quota alert emails admins; never hit the real provider in tests
vi.mock('../../src/services/email', () => ({
    emailService: { send: vi.fn().mockResolvedValue({ success: true }) },
}));

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
    semanticCache: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    sql: vi.fn().mockReturnValue('sql-mock'),
    count: vi.fn().mockReturnValue('count-mock'),
}));

// Mock Redis
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
        quit: vi.fn(),
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0),
        incr: vi.fn().mockResolvedValue(1), // v53 gender-bucket adoption counters
    },
    redisScanDelete: vi.fn().mockResolvedValue(0),
}));

// Mock aiModelResolver — auto-resolve falls back to default so existing tests
// (which don't set request.model) behave identically to pre-resolver behavior.
// The resolver itself has dedicated tests in aiModelResolver.test.ts.
vi.mock('../../src/services/aiModelResolver', () => ({
    getModelForUser: vi.fn().mockResolvedValue('gpt-4.1-mini'),
    clearAiModelCache: vi.fn(),
}));

// Mock circuit breaker — pass-through so existing tests are unaffected
vi.mock('../../src/lib/circuitBreaker', () => ({
    aiWorkerCircuit: {
        execute: vi.fn((fn: () => unknown) => fn()),
        getState: vi.fn().mockResolvedValue('closed'),
    },
    CircuitOpenError: class CircuitOpenError extends Error {
        constructor() { super('Circuit open'); this.name = 'CircuitOpenError'; }
    },
}));

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        ai: {
            enabled: true,
            cacheEnabled: true,
            semanticCacheEnabled: true,
            genderBucketEnabled: true,
            neutralBucketEnabled: true,
            qualityGateEnabled: true,
            dualVariantEnabled: false,
            serviceUrl: 'http://localhost:3002',
            defaultModel: 'gpt-4-mini',
            model: 'gpt-4.1-mini',
            quotaAlertCooldownSeconds: 600,
        },
        adminEmails: ['ops@jawab24.com'],
    },
}));

// Mock the v53 name→gender consensus map — default "unknown name" (null) so every
// pre-existing test keeps the v51 per-name bucketing behavior. The gender-bucket
// describe overrides per test. The real module has its own unit tests.
// Mock the dual-variant transform — the real module makes an OpenAI call.
// Default null = "transform unavailable" so every pre-existing test keeps the
// legacy save path; the dual-variant describe overrides per test.
vi.mock('../../src/services/genderVariantTransform', () => ({
    generateGenderVariant: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/genderMap', async (importOriginal) => ({
    // Keep the real pure helpers (firstNameOf, still the GENDER-map key); mock
    // only the Redis-backed map functions. buildCacheKey and the save guards now
    // key on utils/senderName instead — see that module's header for why identity
    // and gender deliberately hash a name differently.
    ...(await importOriginal<typeof import('../../src/services/genderMap')>()),
    getConfidentGender: vi.fn().mockResolvedValue(null),
    recordGenderObservation: vi.fn().mockResolvedValue(undefined),
}));

describe('AI Service', () => {
    let service: AiService;

    beforeEach(() => {
        service = new AiService();
        vi.clearAllMocks();
        // Re-setup db.select chain (getCacheStats and other tests modify it to remove .where)
        vi.mocked(db.select).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([]),
            }),
        } as any);
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

        it('should throw on AI service error (no fake fallback mid-conversation)', async () => {
            // Previously this returned `t('commentFallback', lang)` — the bug that
            // caused "شكراً لتعليقك!" to land mid-conversation during deploy outages.
            // The contract now: rethrow so the reply pipeline retries or flags.
            vi.mocked(axios.post).mockRejectedValue(new Error('Service unavailable'));

            await expect(service.generateReply({ comment: 'Hello!' }))
                .rejects.toThrow('Service unavailable');
        });

        it('should throw regardless of customer language (no localized fake reply)', async () => {
            // Same contract for Arabic. Don't substitute "شكراً لتعليقك!" — throw.
            vi.mocked(axios.post).mockRejectedValue(new Error('Service unavailable'));

            await expect(service.generateReply({ comment: 'العنوان' }))
                .rejects.toThrow('Service unavailable');
        });

        it('should throw for script-less input (no fake reply via request.language)', async () => {
            vi.mocked(axios.post).mockRejectedValue(new Error('Service unavailable'));

            await expect(service.generateReply({ comment: '👋👋👋', language: 'ar' }))
                .rejects.toThrow('Service unavailable');
        });

        it('reconstructs AiQuotaExhaustedError from the ai-worker 500 and alerts admins (drives park-and-retry)', async () => {
            const { AiQuotaExhaustedError } = await import('../../src/utils/fbGraphErrors');
            const { emailService } = await import('../../src/services/email');
            const { redis } = await import('../../src/lib/redis');

            // Dedup gate must pass so the alert actually fires.
            vi.mocked(redis.set).mockResolvedValue('OK' as any);
            // The wire failure arrives as an axios 500 carrying the typed error body.
            const isAxErr = vi.mocked(axios.isAxiosError);
            isAxErr.mockReturnValue(true as any);
            vi.mocked(axios.post).mockRejectedValue({
                response: { data: { error: { name: 'AiQuotaExhaustedError', message: '429 insufficient_quota' } } },
            });

            try {
                // Must throw the typed error so the worker can PARK it (not a generic error).
                await expect(
                    service.generateReply({ comment: 'بكم السعر', context: { userId: 'u1' } }),
                ).rejects.toBeInstanceOf(AiQuotaExhaustedError);

                // Operator alerts fired (Sentry event + admin email), both behind the throttle.
                expect(sentry.captureMessage).toHaveBeenCalledWith(
                    'OpenAI quota exhausted (insufficient_quota) — top up billing',
                    expect.objectContaining({ tags: { alert: 'openai_quota_exhausted' } }),
                );
                expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({
                    to: 'ops@jawab24.com',
                    type: 'transactional',
                }));
            } finally {
                isAxErr.mockReturnValue(false as any); // don't leak into sibling tests
            }
        });

        it('does NOT re-alert while throttled (Redis dedup returns non-OK)', async () => {
            const { AiQuotaExhaustedError } = await import('../../src/utils/fbGraphErrors');
            const { emailService } = await import('../../src/services/email');
            const { redis } = await import('../../src/lib/redis');

            // SET NX returns null when the key already exists → within cooldown window.
            vi.mocked(redis.set).mockResolvedValue(null as any);
            const isAxErr = vi.mocked(axios.isAxiosError);
            isAxErr.mockReturnValue(true as any);
            vi.mocked(axios.post).mockRejectedValue({
                response: { data: { error: { name: 'AiQuotaExhaustedError', message: '429 insufficient_quota' } } },
            });

            try {
                // Still throws the typed error (parking is unaffected) ...
                await expect(
                    service.generateReply({ comment: 'بكم', context: { userId: 'u2' } }),
                ).rejects.toBeInstanceOf(AiQuotaExhaustedError);
                // ... but the alert is suppressed by the throttle.
                expect(sentry.captureMessage).not.toHaveBeenCalled();
                expect(emailService.send).not.toHaveBeenCalled();
            } finally {
                isAxErr.mockReturnValue(false as any);
            }
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

    describe('generateReply - per-user model resolution', () => {
        // Pull the mocked resolver so each test can shape its return value.
        // The vi.mock at top-of-file replaces the real one with a stub.
        let getModelForUser: ReturnType<typeof vi.fn>;
        beforeEach(async () => {
            const mod = await import('../../src/services/aiModelResolver');
            getModelForUser = vi.mocked(mod.getModelForUser);
            // Default to gpt-4.1-mini (the project's DEFAULT_AI_MODEL).
            getModelForUser.mockResolvedValue('gpt-4.1-mini');
        });

        it('does NOT forward `model` to ai-worker when resolved is the default', async () => {
            vi.mocked(axios.post).mockResolvedValue({
                data: { reply: 'ok', language: 'en' },
            });
            getModelForUser.mockResolvedValue('gpt-4.1-mini');

            await service.generateReply({
                comment: 'hi',
                context: { userId: 'u-default' },
            });

            const [, body] = vi.mocked(axios.post).mock.calls[0];
            // Default-model workspace keeps using the ai-worker's unchanged
            // production path — no `model` field on the body.
            expect(body).not.toHaveProperty('model');
        });

        it('forwards resolved model to ai-worker when non-default', async () => {
            vi.mocked(axios.post).mockResolvedValue({
                data: { reply: 'ok', language: 'en' },
            });
            getModelForUser.mockResolvedValue('gpt-4o-mini');

            const result = await service.generateReply({
                comment: 'hi',
                context: { userId: 'u-override' },
            });

            const [, body] = vi.mocked(axios.post).mock.calls[0];
            expect(body).toMatchObject({ model: 'gpt-4o-mini' });
            // Response should reflect the resolved model so downstream cost
            // tracking + observability uses the real billed model.
            expect(result.model).toBe('gpt-4o-mini');
            expect(getModelForUser).toHaveBeenCalledWith('u-override');
        });

        it('caller-provided request.model wins over the resolver (playground path)', async () => {
            vi.mocked(axios.post).mockResolvedValue({
                data: { reply: 'ok', language: 'en' },
            });
            // Settings would resolve to gpt-4o-mini, but caller explicitly
            // requested gpt-4.1-nano (e.g. A/B test in playground).
            getModelForUser.mockResolvedValue('gpt-4o-mini');

            const result = await service.generateReply({
                comment: 'hi',
                model: 'gpt-4.1-nano',
                context: { userId: 'u-playground' },
            });

            // Resolver must NOT be consulted when the request already pins a model.
            expect(getModelForUser).not.toHaveBeenCalled();
            const [, body] = vi.mocked(axios.post).mock.calls[0];
            expect(body).toMatchObject({ model: 'gpt-4.1-nano' });
            expect(result.model).toBe('gpt-4.1-nano');
        });

        it('falls back to default when no userId is present', async () => {
            vi.mocked(axios.post).mockResolvedValue({
                data: { reply: 'ok', language: 'en' },
            });

            await service.generateReply({ comment: 'hi' });

            // Resolver is called with undefined and returns default — no model
            // field is forwarded.
            const [, body] = vi.mocked(axios.post).mock.calls[0];
            expect(body).not.toHaveProperty('model');
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

        it('should throw on AI worker timeout (no silent fallback)', async () => {
            // Previously: catch returned `model: 'fallback'` with lightweight
            // classifier metadata. New contract: throw — the pipeline retries
            // or flags rather than sending a fake reply.
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(axios.post).mockRejectedValue(new Error('timeout'));

            await expect(service.generateReply({ comment: 'Hello' }))
                .rejects.toThrow('timeout');
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

    /** Generate a reply for `comment` and return the exact-cache key it read. */
    async function cacheKeyFor(
        comment: string,
        context?: Record<string, unknown>,
    ): Promise<string> {
        const { redis } = await import('../../src/lib/redis');
        vi.mocked(redis.get).mockClear();
        vi.mocked(redis.get).mockResolvedValue(null);
        vi.mocked(axios.post).mockResolvedValue({
            data: { reply: 'reply', language: 'en' },
        });
        await service.generateReply({ comment, ...(context ? { context } : {}) });
        return vi.mocked(redis.get).mock.calls[0][0] as string;
    }

    describe('generateReply - exact cache key Arabic normalization', () => {
        // Regression: buildCacheKey previously skipped normalizeArabic, so alef
        // variants (أ/إ/ا), tatweel, and Arabic-Indic digits each got their own
        // cache bucket — pure fragmentation for Arabic traffic.
        it('alef variants produce the same cache key', async () => {
            expect(await cacheKeyFor('أهلا كم السعر')).toBe(await cacheKeyFor('اهلا كم السعر'));
        });

        it('tatweel-stretched text produces the same cache key', async () => {
            expect(await cacheKeyFor('السـعر؟')).toBe(await cacheKeyFor('السعر؟'));
        });

        it('Arabic-Indic digits produce the same cache key as Western digits', async () => {
            expect(await cacheKeyFor('عندكم ٥٠ قطعة؟')).toBe(await cacheKeyFor('عندكم 50 قطعة؟'));
        });

        it('different questions still produce different cache keys', async () => {
            expect(await cacheKeyFor('كم السعر')).not.toBe(await cacheKeyFor('وين موقعكم'));
        });
    });

    describe('generateReply - exact cache key brand voice scoping', () => {
        // Brand voice is prompt-injected but settings saves never bump
        // kbActiveVersion — the key scope is the only staleness protection.
        it('different brand voices produce different cache keys', async () => {
            expect(await cacheKeyFor('hello', { brandVoiceNotes: 'warm and friendly' }))
                .not.toBe(await cacheKeyFor('hello', { brandVoiceNotes: 'formal and terse' }));
        });

        it('same brand voice produces the same cache key', async () => {
            expect(await cacheKeyFor('hello', { brandVoiceNotes: 'warm and friendly' }))
                .toBe(await cacheKeyFor('hello', { brandVoiceNotes: 'warm and friendly' }));
        });

        it('brand-voiced and voiceless workspaces use different cache keys', async () => {
            expect(await cacheKeyFor('hello', { brandVoiceNotes: 'warm and friendly' }))
                .not.toBe(await cacheKeyFor('hello'));
        });

        it('empty brand voice keeps the key identical to no brand voice (rollout back-compat)', async () => {
            expect(await cacheKeyFor('hello', { brandVoiceNotes: '' }))
                .toBe(await cacheKeyFor('hello'));
        });
    });

    describe('generateReply - semantic cache model scope normalization', () => {
        // Regression (#164): check() was passed the resolved model name while
        // save() stored `undefined` for default-model rows. The strict-equality
        // metadata filter then rejected every row, silently disabling semantic
        // cache reads for all default-model workspaces.
        async function semanticCheckArgsFor(model?: string): Promise<unknown[]> {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(axios.post).mockResolvedValue({ data: { reply: 'reply', language: 'en' } });
            const { semanticCacheService } = await import('../../src/services/kb/semantic-cache');
            const checkSpy = vi.spyOn(semanticCacheService, 'check').mockResolvedValue(null);

            await service.generateReply({
                comment: 'Hello',
                ...(model ? { model } : {}),
                context: { pageId: 'page-1', kbActiveVersion: 3, queryEmbedding: [0.1, 0.2] },
            });

            expect(checkSpy).toHaveBeenCalledTimes(1);
            const args = checkSpy.mock.calls[0];
            checkSpy.mockRestore();
            return args;
        }

        it('passes undefined model for default-model workspaces (matches save-side scoping)', async () => {
            const args = await semanticCheckArgsFor();
            expect((args[4] as { model?: string }).model).toBeUndefined();
        });

        it('passes the model name for non-default workspaces', async () => {
            const args = await semanticCheckArgsFor('gpt-4o');
            expect((args[4] as { model?: string }).model).toBe('gpt-4o');
        });
    });

    describe('generateReply - belt-and-suspenders against ai-worker fallback_reply', () => {
        // The ai-worker has an internal `getFallbackReply()` that returns a templated
        // "Thanks, we'll get back to you" string with `flags: ['fallback_reply']` on a
        // successful 200 response. Before this guard, that string was cached and shipped
        // to customers as a real reply. Backend now rejects it pre-cache and lets the
        // existing #137 catch/rethrow path retry or flag the row needs_attention.
        it('should throw AiUnavailableError when ai-worker returns flags=["fallback_reply"]', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(axios.post).mockResolvedValue({
                data: {
                    reply: 'شكراً لرسالتك إلى Test Page! سنرد عليك في أقرب وقت ممكن.',
                    language: 'ar',
                    confidence: 'low',
                    flags: ['fallback_reply'],
                },
            });

            await expect(service.generateReply({ comment: 'مرحبا' }))
                .rejects.toThrow('ai-worker returned fallback_reply flag');
        });

        it('should NOT write to cache when fallback_reply flag is present', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(redis.set).mockResolvedValue('OK' as any);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(axios.post).mockResolvedValue({
                data: {
                    reply: 'Thank you for your message to Test Page!',
                    language: 'en',
                    confidence: 'low',
                    flags: ['fallback_reply'],
                },
            });

            await expect(service.generateReply({ comment: 'hi' })).rejects.toThrow();

            // redis.set must not have been called with an ai_reply cache key — the throw
            // happens BEFORE saveToCache, so the fallback text never enters the cache.
            const cacheSetCalls = vi.mocked(redis.set).mock.calls
                .filter(call => typeof call[0] === 'string' && call[0].startsWith('cache:ai_reply:'));
            expect(cacheSetCalls).toHaveLength(0);
        });

        it('should return normally when flags does NOT include fallback_reply', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(axios.post).mockResolvedValue({
                data: {
                    reply: 'A real AI reply.',
                    language: 'en',
                    confidence: 'high',
                    flags: ['some_other_flag'],
                },
            });

            const result = await service.generateReply({ comment: 'Hello' });

            expect(result.reply).toBe('A real AI reply.');
            expect(result.flags).toEqual(['some_other_flag']);
        });

        it('should return normally when flags is empty or missing', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(axios.post).mockResolvedValue({
                data: {
                    reply: 'A real AI reply.',
                    language: 'en',
                },
            });

            const result = await service.generateReply({ comment: 'Hello' });

            expect(result.reply).toBe('A real AI reply.');
        });
    });

    describe('generateReply - save-side quality gate', () => {
        // A weak reply (confidence 'low', or info_not_in_kb / price_not_in_kb /
        // language_mismatch) is served to the customer but never cached — cached,
        // it would repeat for 30 days. Unlike fallback_reply above this is a
        // silent skip-save, not a throw. Kill-switch: config.ai.qualityGateEnabled.
        async function generateWithWorkerReply(data: Record<string, unknown>) {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(redis.set).mockResolvedValue('OK' as never);
            vi.mocked(axios.post).mockResolvedValue({ data });
            return service.generateReply({ comment: 'كم السعر؟' });
        }

        async function cacheSetCalls() {
            const { redis } = await import('../../src/lib/redis');
            return vi.mocked(redis.set).mock.calls
                .filter((call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).startsWith('cache:ai_reply:'));
        }

        async function gateCounterCalls(suffix: string) {
            const { redis } = await import('../../src/lib/redis');
            // Counters are pipeline-suffixed; these tests run without a pipeline
            // tag, which resolves to 'unknown'.
            return vi.mocked(redis.incr).mock.calls
                .filter((call: unknown[]) => call[0] === `metrics:cache:quality_gate:${suffix}:unknown`);
        }

        it('serves a low-confidence reply but never caches it', async () => {
            const result = await generateWithWorkerReply({
                reply: 'ما عندي هالمعلومة، بس بقدر ساعدك بغيرها', language: 'ar', confidence: 'low', flags: [],
            });

            expect(result.reply).toBe('ما عندي هالمعلومة، بس بقدر ساعدك بغيرها');
            expect(result.cached).toBe(false);
            expect(await cacheSetCalls()).toHaveLength(0);
            const { db } = await import('../../src/db');
            expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
            expect(await gateCounterCalls('save_reject:low_confidence')).toHaveLength(1);
            expect(await gateCounterCalls('save_ok')).toHaveLength(0);
        });

        it.each(['low_confidence', 'info_not_in_kb', 'price_not_in_kb', 'language_mismatch'])(
            'skips the cache save when a high-confidence reply carries %s',
            async (flag) => {
                const result = await generateWithWorkerReply({
                    reply: 'Some reply', language: 'en', confidence: 'high', flags: [flag],
                });

                expect(result.reply).toBe('Some reply');
                expect(await cacheSetCalls()).toHaveLength(0);
                expect(await gateCounterCalls(`save_reject:${flag}`)).toHaveLength(1);
            },
        );

        it('caches normally when only dynamic companion flags are present', async () => {
            await generateWithWorkerReply({
                reply: 'رد سليم', language: 'ar', confidence: 'high', flags: ['expected_lang:ar'],
            });

            expect(await cacheSetCalls()).toHaveLength(1);
            expect(await gateCounterCalls('save_ok')).toHaveLength(1);
            expect(await gateCounterCalls('save_reject:low_confidence')).toHaveLength(0);
        });

        it('never caches a reply generated WITH conversation history (context-leak guard)', async () => {
            // The read path only probes for history-less messages, but without a
            // save-side gate a mid-conversation reply ("the product you asked
            // about earlier") whose customerContext happens to be empty lands
            // under the same key a brand-new customer's first message probes —
            // a wrong-CONTENT leak across customers.
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(redis.set).mockResolvedValue('OK' as never);
            vi.mocked(axios.post).mockResolvedValue({ data: {
                reply: 'نفس المنتج اللي سألتي عنه، سعره ٥٠', language: 'ar', confidence: 'high', flags: [],
            } });

            const result = await service.generateReply({
                comment: 'كم السعر؟',
                context: { conversationHistory: [
                    { role: 'user', content: 'شو عندكم كريمات؟' },
                    { role: 'assistant', content: 'عندنا كريم مرطب وواقي شمس' },
                ] },
            });

            expect(result.reply).toContain('نفس المنتج');
            expect(await cacheSetCalls()).toHaveLength(0);
            const { db } = await import('../../src/db');
            expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
        });

        it('kill-switch off: low-confidence replies cache again, save_ok keeps counting', async () => {
            const { config } = await import('../../src/config');
            config.ai.qualityGateEnabled = false;
            try {
                await generateWithWorkerReply({
                    reply: 'weak but cached', language: 'en', confidence: 'low', flags: ['info_not_in_kb'],
                });

                expect(await cacheSetCalls()).toHaveLength(1);
                // Denominator continuity: with the gate off every save counts save_ok.
                expect(await gateCounterCalls('save_ok')).toHaveLength(1);
                expect(await gateCounterCalls('save_reject:low_confidence')).toHaveLength(0);
            } finally {
                config.ai.qualityGateEnabled = true;
            }
        });
    });

    describe('getCacheStats', () => {
        it('should return cache statistics for both caches', async () => {
            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockResolvedValue([{ totalEntries: 3, totalHits: 18 }]),
            } as any);

            const stats = await service.getCacheStats();

            expect(stats.exactCache.totalEntries).toBe(3);
            expect(stats.exactCache.totalHits).toBe(18);
            expect(stats.semanticCache.totalEntries).toBe(3);
            expect(stats.semanticCache.totalHits).toBe(18);
        });

        it('should handle empty cache', async () => {
            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockResolvedValue([{ totalEntries: 0, totalHits: 0 }]),
            } as any);

            const stats = await service.getCacheStats();

            expect(stats.exactCache.totalEntries).toBe(0);
            expect(stats.semanticCache.totalEntries).toBe(0);
        });
    });

    describe('clearCache', () => {
        it('should clear exact cache and semantic cache', async () => {
            const { db } = await import('../../src/db');

            await service.clearCache();

            expect(db.delete).toHaveBeenCalledTimes(2);
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
    describe('Sentry spans', () => {
        beforeEach(async () => {
            // Re-init db mock chain: getCacheStats tests set db.select to return a Promise
            // directly from from() (no .where). Sentry span tests need the full chain.
            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);
        });

        it('should instrument exact cache lookup with ai.cache.exact span', async () => {
            await service.generateReply({ comment: 'test' });

            expect(vi.mocked(sentry.startSpan)).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'ai.cache.exact' }),
                expect.any(Function),
            );
        });

        it('should instrument AI worker HTTP call with ai.worker.http span', async () => {
            await service.generateReply({ comment: 'test' });

            expect(vi.mocked(sentry.startSpan)).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'ai.worker.http' }),
                expect.any(Function),
            );
        });
    });

    describe('normalization', () => {
        it('should normalize comments for better cache hits', async () => {
            const { redis } = await import('../../src/lib/redis');

            // 1. Prime the cache (simulated)
            const baseComment = 'Price';
            await service.saveToCache(baseComment, 'Cached Response', { language: 'en' });

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
                await service.checkCache(v, { language: 'en' });
                expect(redis.get).toHaveBeenCalledWith(storageKey);
                vi.clearAllMocks();
            }
        });
    });

    describe('KB version-scoped exact cache', () => {
        it('should produce different cache keys for different kbActiveVersion values', async () => {
            const { redis } = await import('../../src/lib/redis');

            await service.saveToCache('What is the price?', 'Price is $100', { language: 'en', pageId: 'page-1', kbActiveVersion: 1 });
            const keyV1 = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('What is the price?', 'Price is $200', { language: 'en', pageId: 'page-1', kbActiveVersion: 2 });
            const keyV2 = vi.mocked(redis.set).mock.calls[0][0];

            expect(keyV1).not.toBe(keyV2);
        });

        it('should produce same cache key for same kbActiveVersion', async () => {
            const { redis } = await import('../../src/lib/redis');

            await service.saveToCache('What is the price?', 'Price is $100', { language: 'en', pageId: 'page-1', kbActiveVersion: 1 });
            const key1 = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('What is the price?', 'Price is $100', { language: 'en', pageId: 'page-1', kbActiveVersion: 1 });
            const key2 = vi.mocked(redis.set).mock.calls[0][0];

            expect(key1).toBe(key2);
        });

        it('should treat null and undefined kbActiveVersion the same (non-KB pages)', async () => {
            const { redis } = await import('../../src/lib/redis');

            await service.saveToCache('Hello', 'Hi there', { language: 'en', pageId: 'page-1', kbActiveVersion: null });
            const keyNull = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('Hello', 'Hi there', { language: 'en', pageId: 'page-1', kbActiveVersion: undefined });
            const keyUndefined = vi.mocked(redis.set).mock.calls[0][0];

            expect(keyNull).toBe(keyUndefined);
        });

        it('should miss exact cache after KB version bump (stale reply scenario)', async () => {
            const { redis } = await import('../../src/lib/redis');

            // Save with version 1
            await service.saveToCache('What is your address?', 'Let me check with the team.', { language: 'en', pageId: 'page-1', kbActiveVersion: 1 });
            const keyV1 = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            // Check with version 2 (after KB update) — should NOT match
            vi.mocked(redis.get).mockResolvedValue(null);
            const result = await service.checkCache('What is your address?', { language: 'en', pageId: 'page-1', kbActiveVersion: 2 });

            // Should have queried with a DIFFERENT key than what was stored
            const queriedKey = vi.mocked(redis.get).mock.calls[0][0];
            expect(queriedKey).not.toBe(keyV1);
            expect(result).toBeNull();
        });
    });

    describe('suppressGreeting-scoped exact cache', () => {
        it('produces different cache keys when suppressGreeting differs (prevents double-greeting via cache hit)', async () => {
            const { redis } = await import('../../src/lib/redis');
            const ctx = { language: 'ar', pageId: 'page-1', kbActiveVersion: 1 } as const;

            await service.saveToCache('بكم السعر؟', 'السعر 100', { ...ctx, suppressGreeting: true });
            const keySuppressed = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('بكم السعر؟', 'السعر 100', { ...ctx, suppressGreeting: false });
            const keyNormal = vi.mocked(redis.set).mock.calls[0][0];

            // A greeting-suppressed reply (merchant welcome prepended by the backend) must
            // never share a bucket with an ordinary reply that greeted on its own.
            expect(keySuppressed).not.toBe(keyNormal);
        });

        it('keeps the cache key byte-identical for suppressGreeting false vs omitted (no global cache invalidation)', async () => {
            const { redis } = await import('../../src/lib/redis');
            const ctx = { language: 'ar', pageId: 'page-1', kbActiveVersion: 1 } as const;

            await service.saveToCache('بكم السعر؟', 'السعر 100', { ...ctx, suppressGreeting: false });
            const keyFalse = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('بكم السعر؟', 'السعر 100', ctx);
            const keyOmitted = vi.mocked(redis.set).mock.calls[0][0];

            // Existing traffic (suppressGreeting falsy) must keep its pre-change key so the
            // live cache is not wholesale-invalidated by this fix.
            expect(keyFalse).toBe(keyOmitted);
        });
    });

    describe('replyMode-scoped exact cache (D-085)', () => {
        it('gives info mode its own bucket (an info page must never read a sales reply)', async () => {
            const { redis } = await import('../../src/lib/redis');
            const ctx = { language: 'ar', pageId: 'page-1', kbActiveVersion: 1 } as const;

            await service.saveToCache('كيف بطلب؟', 'ابعتلي اسمك ورقمك', { ...ctx, replyMode: 'sales' });
            const keySales = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('كيف بطلب؟', 'تواصل معنا على 0912345678', { ...ctx, replyMode: 'info' });
            const keyInfo = vi.mocked(redis.set).mock.calls[0][0];

            // A cached sales reply may literally ask for the customer's phone —
            // serving it to an info-mode page is the violation the mode exists
            // to prevent (and vice versa).
            expect(keyInfo).not.toBe(keySales);
        });

        it('keeps the cache key byte-identical for sales vs omitted (no fleet-wide invalidation, Rule 17)', async () => {
            const { redis } = await import('../../src/lib/redis');
            const ctx = { language: 'ar', pageId: 'page-1', kbActiveVersion: 1 } as const;

            await service.saveToCache('كيف بطلب؟', 'ابعتلي اسمك ورقمك', { ...ctx, replyMode: 'sales' });
            const keySales = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('كيف بطلب؟', 'ابعتلي اسمك ورقمك', ctx);
            const keyOmitted = vi.mocked(redis.set).mock.calls[0][0];

            // Every existing key was written with no replyMode segment; explicit
            // 'sales' must land on those same keys or the whole warm cache retires.
            expect(keySales).toBe(keyOmitted);
        });
    });

    describe('Post-context scoped exact cache', () => {
        it('should produce different cache keys for different posts on the same page', async () => {
            const { redis } = await import('../../src/lib/redis');

            await service.saveToCache('What is the price?', 'Shoes cost $50', { language: 'en', pageId: 'page-1', kbActiveVersion: 1, postMessage: 'Check out our new shoes!' });
            const keyShoes = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('What is the price?', 'Bags cost $80', { language: 'en', pageId: 'page-1', kbActiveVersion: 1, postMessage: 'Check out our new bags!' });
            const keyBags = vi.mocked(redis.set).mock.calls[0][0];

            expect(keyShoes).not.toBe(keyBags);
        });

        it('should produce same cache key for same post content', async () => {
            const { redis } = await import('../../src/lib/redis');

            await service.saveToCache('What is the price?', 'Shoes cost $50', { language: 'en', pageId: 'page-1', kbActiveVersion: 1, postMessage: 'New shoes available!' });
            const key1 = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('What is the price?', 'Shoes cost $50', { language: 'en', pageId: 'page-1', kbActiveVersion: 1, postMessage: 'New shoes available!' });
            const key2 = vi.mocked(redis.set).mock.calls[0][0];

            expect(key1).toBe(key2);
        });

        it('should handle DMs without post context (postMessage undefined)', async () => {
            const { redis } = await import('../../src/lib/redis');

            await service.saveToCache('Hello', 'Hi there', { language: 'en', pageId: 'page-1', kbActiveVersion: 1 });
            const key1 = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            await service.saveToCache('Hello', 'Hi there', { language: 'en', pageId: 'page-1', kbActiveVersion: 1 });
            const key2 = vi.mocked(redis.set).mock.calls[0][0];

            expect(key1).toBe(key2);
        });

        it('should differentiate between no post and a specific post', async () => {
            const { redis } = await import('../../src/lib/redis');

            // DM (no post context)
            await service.saveToCache('What is the price?', 'General price info', { language: 'en', pageId: 'page-1', kbActiveVersion: 1 });
            const keyNoPost = vi.mocked(redis.set).mock.calls[0][0];

            vi.clearAllMocks();

            // Comment on a post
            await service.saveToCache('What is the price?', 'Product X costs $50', { language: 'en', pageId: 'page-1', kbActiveVersion: 1, postMessage: 'Product X now available!' });
            const keyWithPost = vi.mocked(redis.set).mock.calls[0][0];

            expect(keyNoPost).not.toBe(keyWithPost);
        });
    });

    /**
     * Run one DM generation (cache miss + stubbed worker) and return every
     * exact-cache GET key in probe order plus the exact-cache key written.
     * Shared by the v53 gender-bucket and g:n neutral-bucket suites.
     */
    async function dmProbeAndSave(
        context: Record<string, unknown>,
        workerData: Record<string, unknown>,
    ): Promise<{ getKeys: string[]; savedKey: string | undefined }> {
        const { redis } = await import('../../src/lib/redis');
        vi.mocked(redis.get).mockClear();
        vi.mocked(redis.set).mockClear();
        vi.mocked(redis.incr).mockClear();
        vi.mocked(redis.get).mockResolvedValue(null);
        vi.mocked(axios.post).mockResolvedValue({ data: workerData });
        await service.generateReply({
            comment: 'كم السعر',
            language: 'ar',
            context: { channel: 'dm', pipeline: 'dm_reply', ...context },
        });
        const getKeys = vi.mocked(redis.get).mock.calls
            .map(call => call[0] as string)
            .filter(key => key.startsWith('cache:ai_reply:'));
        const savedKey = vi.mocked(redis.set).mock.calls
            .map(call => call[0] as string)
            .find(key => key.startsWith('cache:ai_reply:'));
        return { getKeys, savedKey };
    }

    describe('generateReply - DM gender-bucketed exact cache (v53)', () => {
        // v51 bucketed DM cache keys per first name (correct but zero cross-sender
        // sharing). v53 buckets confidently-learned names by gender instead. These
        // tests pin the invariants: sharing within a gender bucket, isolation across
        // buckets, per-name fallback for unknown names, byte-identical comment keys,
        // and the save-side downgrade guard that keeps name-embedding / mismatched
        // replies out of the shared bucket.

        /** Read-side cache key for a DM from `senderName` (cache miss + stubbed worker). */
        async function dmKeyFor(comment: string, senderName?: string, extraCtx?: Record<string, unknown>): Promise<string> {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockClear();
            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(axios.post).mockResolvedValue({
                data: { reply: 'reply', language: 'ar' },
            });
            await service.generateReply({
                comment,
                language: 'ar',
                context: { channel: 'dm', ...(senderName ? { senderName } : {}), ...extraCtx },
            });
            return vi.mocked(redis.get).mock.calls[0][0] as string;
        }

        /** Run one DM generation and return the (specific) key read vs the key written. */
        async function dmReadAndSaveKeys(
            senderName: string,
            workerData: Record<string, unknown>,
        ): Promise<{ readKey: string; savedKey: string | undefined }> {
            const { getKeys, savedKey } = await dmProbeAndSave({ senderName }, workerData);
            return { readKey: getKeys[0], savedKey };
        }

        beforeEach(async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            vi.mocked(getConfidentGender).mockResolvedValue(null);
        });

        it('two confidently-masculine names share one cache key (the v53 win)', async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            vi.mocked(getConfidentGender).mockResolvedValue('m');
            expect(await dmKeyFor('كم السعر', 'أحمد')).toBe(await dmKeyFor('كم السعر', 'محمد'));
        });

        it('masculine and feminine buckets never share a key', async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            vi.mocked(getConfidentGender).mockResolvedValueOnce('m').mockResolvedValueOnce('f');
            expect(await dmKeyFor('كم السعر', 'أحمد')).not.toBe(await dmKeyFor('كم السعر', 'فاطمة'));
        });

        it('a learned name and an unknown name never share a key (g-bucket vs n-bucket)', async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            vi.mocked(getConfidentGender).mockResolvedValueOnce('m').mockResolvedValueOnce(null);
            expect(await dmKeyFor('كم السعر', 'أحمد')).not.toBe(await dmKeyFor('كم السعر', 'أحمد'));
        });

        it('unknown names keep v51 per-name isolation', async () => {
            expect(await dmKeyFor('كم السعر', 'أحمد')).not.toBe(await dmKeyFor('كم السعر', 'محمد'));
        });

        it('the same unknown name still shares its own bucket (v51 behavior preserved)', async () => {
            expect(await dmKeyFor('كم السعر', 'أحمد')).toBe(await dmKeyFor('كم السعر', 'أحمد'));
        });

        it('kill-switch off → per-name bucketing even for a learned name', async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            const { config } = await import('../../src/config');
            vi.mocked(getConfidentGender).mockResolvedValue('m');
            config.ai.genderBucketEnabled = false;
            try {
                expect(await dmKeyFor('كم السعر', 'أحمد')).not.toBe(await dmKeyFor('كم السعر', 'محمد'));
                expect(getConfidentGender).not.toHaveBeenCalled();
            } finally {
                config.ai.genderBucketEnabled = true;
            }
        });

        it('comment-channel keys are byte-identical with and without senderName (blast radius)', async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            vi.mocked(getConfidentGender).mockResolvedValue('m');
            const withName = await dmKeyFor('كم السعر', undefined, { channel: 'comment', senderName: 'أحمد' });
            const withoutName = await dmKeyFor('كم السعر', undefined, { channel: 'comment' });
            expect(withName).toBe(withoutName);
            expect(getConfidentGender).not.toHaveBeenCalled();
        });

        describe('save-side downgrade guard', () => {
            it('a bucket-matching, name-free reply saves to the same gender-bucket key it read', async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                const { redis } = await import('../../src/lib/redis');
                vi.mocked(getConfidentGender).mockResolvedValue('m');
                const { readKey, savedKey } = await dmReadAndSaveKeys('أحمد', {
                    reply: 'أهلاً بك! السعر 50 ريال', language: 'ar',
                    gender: 'm', genderBasis: 'name', usedName: false,
                });
                expect(savedKey).toBe(readKey);
                expect(redis.incr).toHaveBeenCalledWith('metrics:cache:gender_bucket:save_ok');
            });

            it('a gender-neutral reply (gender unknown) saves to the g:n neutral bucket, not the gender bucket', async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                const { redis } = await import('../../src/lib/redis');
                vi.mocked(getConfidentGender).mockResolvedValue('m');
                const { readKey, savedKey } = await dmReadAndSaveKeys('أحمد', {
                    reply: 'السعر 50 ريال', language: 'ar',
                    gender: 'unknown', genderBasis: 'unclear', usedName: false,
                });
                // g:n wins over g:m in buildCacheKey — strictly more sharing for a
                // reply certified safe for every sender, not just one gender.
                expect(savedKey).toBeDefined();
                expect(savedKey).not.toBe(readKey);
                expect(redis.incr).toHaveBeenCalledWith('metrics:cache:neutral_bucket:save_ok');
                expect(redis.incr).not.toHaveBeenCalledWith('metrics:cache:gender_bucket:save_ok');
            });

            it('with the neutral bucket disabled, a gender-neutral reply keeps the v53 behavior (saves to the gender bucket)', async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                const { config } = await import('../../src/config');
                vi.mocked(getConfidentGender).mockResolvedValue('m');
                config.ai.neutralBucketEnabled = false;
                try {
                    const { readKey, savedKey } = await dmReadAndSaveKeys('أحمد', {
                        reply: 'السعر 50 ريال', language: 'ar',
                        gender: 'unknown', genderBasis: 'unclear', usedName: false,
                    });
                    expect(savedKey).toBe(readKey);
                } finally {
                    config.ai.neutralBucketEnabled = true;
                }
            });

            it('model-reported name use downgrades the save to the per-name bucket', async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                const { redis } = await import('../../src/lib/redis');
                vi.mocked(getConfidentGender).mockResolvedValue('m');
                const { readKey, savedKey } = await dmReadAndSaveKeys('أحمد', {
                    reply: 'أهلاً! السعر 50 ريال', language: 'ar',
                    gender: 'm', genderBasis: 'name', usedName: true,
                });
                expect(savedKey).toBeDefined();
                expect(savedKey).not.toBe(readKey);
                expect(redis.incr).toHaveBeenCalledWith('metrics:cache:gender_bucket:save_downgrade:used_name');
            });

            it('a reply literally embedding the first name downgrades even when the model says usedName:false', async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                vi.mocked(getConfidentGender).mockResolvedValue('m');
                const { readKey, savedKey } = await dmReadAndSaveKeys('أحمد', {
                    reply: 'أهلاً احمد! السعر 50 ريال', language: 'ar', // alef variant — normalized guard must still catch it
                    gender: 'm', genderBasis: 'name', usedName: false,
                });
                expect(savedKey).toBeDefined();
                expect(savedKey).not.toBe(readKey);
            });

            it('a reply gendered against its bucket downgrades', async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                vi.mocked(getConfidentGender).mockResolvedValue('m');
                const { readKey, savedKey } = await dmReadAndSaveKeys('أحمد', {
                    reply: 'أهلاً بكِ! السعر 50 ريال', language: 'ar',
                    gender: 'f', genderBasis: 'self', usedName: false,
                });
                expect(savedKey).toBeDefined();
                expect(savedKey).not.toBe(readKey);
            });

            it('a worker response without the v53 fields downgrades (old worker / failover fail-safe)', async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                vi.mocked(getConfidentGender).mockResolvedValue('m');
                const { readKey, savedKey } = await dmReadAndSaveKeys('أحمد', {
                    reply: 'أهلاً! السعر 50 ريال', language: 'ar',
                });
                expect(savedKey).toBeDefined();
                expect(savedKey).not.toBe(readKey);
            });
        });

        describe('learning gate', () => {
            async function generateWith(context: Record<string, unknown>, workerData: Record<string, unknown>): Promise<void> {
                const { redis } = await import('../../src/lib/redis');
                vi.mocked(redis.get).mockResolvedValue(null);
                vi.mocked(axios.post).mockResolvedValue({ data: workerData });
                await service.generateReply({ comment: 'كم السعر', language: 'ar', context });
            }

            const nameJudgment = {
                reply: 'أهلاً بك', language: 'ar',
                gender: 'm', genderBasis: 'name', usedName: false,
            };

            it('records a name-based judgment from real DM traffic', async () => {
                const { recordGenderObservation } = await import('../../src/services/genderMap');
                await generateWith({ channel: 'dm', senderName: 'أحمد', pipeline: 'dm_reply' }, nameJudgment);
                expect(recordGenderObservation).toHaveBeenCalledWith('أحمد', 'm');
            });

            it('never learns from self-reference judgments (they would poison the name entry)', async () => {
                const { recordGenderObservation } = await import('../../src/services/genderMap');
                await generateWith(
                    { channel: 'dm', senderName: 'فاطمة', pipeline: 'dm_reply' },
                    { ...nameJudgment, gender: 'm', genderBasis: 'self' },
                );
                expect(recordGenderObservation).not.toHaveBeenCalled();
            });

            it('never learns from playground traffic', async () => {
                const { recordGenderObservation } = await import('../../src/services/genderMap');
                await generateWith({ channel: 'dm', senderName: 'أحمد', pipeline: 'playground' }, nameJudgment);
                expect(recordGenderObservation).not.toHaveBeenCalled();
            });

            it('never learns from non-Arabic replies', async () => {
                const { recordGenderObservation } = await import('../../src/services/genderMap');
                await generateWith(
                    { channel: 'dm', senderName: 'Ahmed', pipeline: 'dm_reply' },
                    { ...nameJudgment, language: 'en' },
                );
                expect(recordGenderObservation).not.toHaveBeenCalled();
            });
        });
    });

    describe('generateReply - DM neutral shared bucket (g:n)', () => {
        // A reply the model certifies genderless (gender: 'unknown') and name-free
        // is safe for EVERY sender, so it saves under a distinct g:n segment shared
        // across all names — no gender-map warm-up needed. These tests pin: cross-name
        // sharing via g:n, the g:n ≠ bare-nameless-key isolation (legacy nameless
        // entries are uncertified and must never leak to named senders), specific-first
        // probe order, every save-guard rejection reason, and the kill-switch.

        /** A worker response certified safe for the neutral bucket. */
        const neutralJudgment = {
            reply: 'السعر 50 ريال، متوفر', language: 'ar',
            gender: 'unknown', genderBasis: 'unclear', usedName: false,
        };

        beforeEach(async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            vi.mocked(getConfidentGender).mockResolvedValue(null);
        });

        it('two differently-named senders share one g:n save key, distinct from per-name, gender-bucket, AND bare nameless keys', async () => {
            const { getConfidentGender } = await import('../../src/services/genderMap');
            const ahmad = await dmProbeAndSave({ senderName: 'أحمد' }, neutralJudgment);
            const mohammad = await dmProbeAndSave({ senderName: 'محمد' }, neutralJudgment);
            // The whole point: identical shared save key across names.
            expect(ahmad.savedKey).toBeDefined();
            expect(ahmad.savedKey).toBe(mohammad.savedKey);
            // Distinct from both senders' per-name keys (first probe each).
            expect(ahmad.savedKey).not.toBe(ahmad.getKeys[0]);
            expect(ahmad.savedKey).not.toBe(mohammad.getKeys[0]);
            // Distinct from the gender-bucket key for the same message.
            vi.mocked(getConfidentGender).mockResolvedValue('m');
            const bucketed = await dmProbeAndSave({ senderName: 'أحمد' }, { ...neutralJudgment, gender: 'm', genderBasis: 'name' });
            expect(ahmad.savedKey).not.toBe(bucketed.getKeys[0]);
            vi.mocked(getConfidentGender).mockResolvedValue(null);
            // Distinct from the bare nameless-DM key: legacy nameless entries carry no
            // gender certification and must never be served to named senders.
            const nameless = await dmProbeAndSave({}, neutralJudgment);
            expect(ahmad.savedKey).not.toBe(nameless.getKeys[0]);
        });

        it('round trip: a neutral entry saved for one sender is served from cache to a differently-named sender', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { savedKey } = await dmProbeAndSave({ senderName: 'أحمد' }, neutralJudgment);
            const savedData = vi.mocked(redis.set).mock.calls
                .find(call => (call[0] as string) === savedKey)?.[1] as string;
            expect(savedData).toBeDefined();

            vi.mocked(redis.get).mockClear();
            vi.mocked(redis.incr).mockClear();
            vi.mocked(axios.post).mockClear();
            vi.mocked(redis.get).mockImplementation(async (key: string) => (key === savedKey ? savedData : null));
            const result = await service.generateReply({
                comment: 'كم السعر',
                language: 'ar',
                context: { channel: 'dm', senderName: 'فاطمة', pipeline: 'dm_reply' },
            });
            expect(result.cached).toBe(true);
            expect(result.reply).toBe(neutralJudgment.reply);
            expect(axios.post).not.toHaveBeenCalled();
            // Specific (per-name) probe missed first, then the neutral probe hit.
            const getKeys = vi.mocked(redis.get).mock.calls
                .map(call => call[0] as string)
                .filter(key => key.startsWith('cache:ai_reply:'));
            expect(getKeys).toHaveLength(2);
            expect(getKeys[1]).toBe(savedKey);
            expect(redis.incr).toHaveBeenCalledWith('metrics:cache:neutral_bucket:hit');
        });

        it('a specific-bucket hit short-circuits — the neutral bucket is never probed', async () => {
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockClear();
            vi.mocked(axios.post).mockClear();
            vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify({ reply: 'أهلاً بك! السعر 50' }));
            const result = await service.generateReply({
                comment: 'كم السعر',
                language: 'ar',
                context: { channel: 'dm', senderName: 'أحمد', pipeline: 'dm_reply' },
            });
            expect(result.cached).toBe(true);
            const getKeys = vi.mocked(redis.get).mock.calls
                .map(call => call[0] as string)
                .filter(key => key.startsWith('cache:ai_reply:'));
            expect(getKeys).toHaveLength(1);
            expect(axios.post).not.toHaveBeenCalled();
        });

        describe('save-guard rejections (each reason downgrades to the per-name/gender path)', () => {
            async function expectReject(
                workerData: Record<string, unknown>,
                reason: string,
            ): Promise<void> {
                const { redis } = await import('../../src/lib/redis');
                const { getKeys, savedKey } = await dmProbeAndSave({ senderName: 'أحمد' }, workerData);
                // Saved to the specific (per-name) key it read, not a shared one.
                expect(savedKey).toBe(getKeys[0]);
                expect(redis.incr).toHaveBeenCalledWith(`metrics:cache:neutral_bucket:save_reject:${reason}`);
                expect(redis.incr).not.toHaveBeenCalledWith('metrics:cache:neutral_bucket:save_ok');
            }

            it('gendered reply (model reports m) → gendered', async () => {
                await expectReject({ ...neutralJudgment, gender: 'm', genderBasis: 'name' }, 'gendered');
            });

            it('model-reported name use → used_name', async () => {
                await expectReject({ ...neutralJudgment, usedName: true }, 'used_name');
            });

            it('reply literally embedding the first name (alef variant) → name_substring', async () => {
                await expectReject({ ...neutralJudgment, reply: 'أهلاً احمد! السعر 50 ريال', usedName: false }, 'name_substring');
            });

            it('missing v53 fields (old worker / failover) → not_reported', async () => {
                await expectReject({ reply: 'السعر 50 ريال', language: 'ar' }, 'not_reported');
            });
        });

        it('kill-switch off → single probe, no neutral save, v51/v53 behavior byte-identical', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { config } = await import('../../src/config');
            config.ai.neutralBucketEnabled = false;
            try {
                const { getKeys, savedKey } = await dmProbeAndSave({ senderName: 'أحمد' }, neutralJudgment);
                expect(getKeys).toHaveLength(1);
                expect(savedKey).toBe(getKeys[0]);
                const neutralCalls = vi.mocked(redis.incr).mock.calls
                    .filter(call => (call[0] as string).startsWith('metrics:cache:neutral_bucket:'));
                expect(neutralCalls).toHaveLength(0);
            } finally {
                config.ai.neutralBucketEnabled = true;
            }
        });

        it('blast radius: comments and nameless DMs keep a single probe and their existing keys', async () => {
            const comment = await dmProbeAndSave({ channel: 'comment', senderName: 'أحمد' }, neutralJudgment);
            expect(comment.getKeys).toHaveLength(1);
            expect(comment.savedKey).toBe(comment.getKeys[0]);
            const nameless = await dmProbeAndSave({}, neutralJudgment);
            expect(nameless.getKeys).toHaveLength(1);
            expect(nameless.savedKey).toBe(nameless.getKeys[0]);
            // A comment and a nameless DM share the bare key (pre-existing behavior).
            expect(comment.getKeys[0]).toBe(nameless.getKeys[0]);
        });
    });
    describe('generateReply - DM dual-variant shared cache (g:d)', () => {
        // Flag-gated (dark by default). One shared entry stores both addressee
        // renderings; the reader's map-known gender picks one at serve time.
        const dmContext = { channel: 'dm' as const, senderName: 'فاطمة', userId: 'user-1' };
        const dualEntry = JSON.stringify({
            reply: 'تفضّل، السعر ٥٠',
            variants: { m: 'تفضّل، السعر ٥٠', f: 'تفضّلي، السعر ٥٠' },
            intent: 'QUESTION', confidence: 'high', flags: [],
        });

        async function withDualFlag<T>(fn: () => Promise<T>): Promise<T> {
            const { config } = await import('../../src/config');
            config.ai.dualVariantEnabled = true;
            try { return await fn(); } finally { config.ai.dualVariantEnabled = false; }
        }

        it('serves the reader-matching rendering from the shared entry when the map knows the gender', async () => {
            await withDualFlag(async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                vi.mocked(getConfidentGender).mockResolvedValue('f');
                const { redis } = await import('../../src/lib/redis');
                // First probe is the g:d key — return the dual entry immediately.
                vi.mocked(redis.get).mockResolvedValueOnce(dualEntry);

                const result = await service.generateReply({ comment: 'كم السعر؟', context: dmContext });

                expect(result.cached).toBe(true);
                expect(result.reply).toBe('تفضّلي، السعر ٥٠');
                const hitCalls = vi.mocked(redis.incr).mock.calls
                    .filter(call => call[0] === 'metrics:cache:dual_variant:hit:f');
                expect(hitCalls).toHaveLength(1);
            });
        });

        it('skips the dual probe entirely when the reader gender is unknown', async () => {
            await withDualFlag(async () => {
                const { getConfidentGender } = await import('../../src/services/genderMap');
                vi.mocked(getConfidentGender).mockResolvedValue(null);
                const { redis } = await import('../../src/lib/redis');
                vi.mocked(redis.get).mockResolvedValue(null);
                vi.mocked(axios.post).mockResolvedValue({ data: { reply: 'رد جديد', language: 'ar', confidence: 'high', flags: [] } });

                await service.generateReply({ comment: 'كم السعر؟', context: dmContext });

                // Probes: per-name key + g:n only — never a third (g:d) probe.
                expect(vi.mocked(redis.get).mock.calls.length).toBeLessThanOrEqual(2);
            });
        });

        it('saves ONE shared entry with both renderings when the transform succeeds', async () => {
            await withDualFlag(async () => {
                const { generateGenderVariant } = await import('../../src/services/genderVariantTransform');
                vi.mocked(generateGenderVariant).mockResolvedValueOnce('تفضّلي، السعر ٥٠');
                const { redis } = await import('../../src/lib/redis');
                vi.mocked(redis.get).mockResolvedValue(null);
                vi.mocked(redis.set).mockResolvedValue('OK' as never);
                vi.mocked(axios.post).mockResolvedValue({ data: {
                    reply: 'تفضّل، السعر ٥٠', language: 'ar', confidence: 'high', flags: [],
                    gender: 'm', genderBasis: 'name', usedName: false,
                } });

                await service.generateReply({ comment: 'كم السعر؟', context: dmContext });
                await new Promise(r => setTimeout(r, 50)); // fire-and-forget save settles

                expect(generateGenderVariant).toHaveBeenCalledWith({ userId: 'user-1', reply: 'تفضّل، السعر ٥٠', sourceGender: 'm' });
                const cacheWrites = vi.mocked(redis.set).mock.calls
                    .filter(call => typeof call[0] === 'string' && (call[0] as string).startsWith('cache:ai_reply:'));
                expect(cacheWrites).toHaveLength(1);
                const written = JSON.parse(cacheWrites[0][1] as string);
                expect(written.variants).toEqual({ m: 'تفضّل، السعر ٥٠', f: 'تفضّلي، السعر ٥٠' });
                const okCalls = vi.mocked(redis.incr).mock.calls
                    .filter(call => call[0] === 'metrics:cache:dual_variant:save_ok');
                expect(okCalls).toHaveLength(1);
            });
        });

        it('falls back to the legacy save (no variants) when the transform fails', async () => {
            await withDualFlag(async () => {
                const { generateGenderVariant } = await import('../../src/services/genderVariantTransform');
                vi.mocked(generateGenderVariant).mockResolvedValueOnce(null);
                const { redis } = await import('../../src/lib/redis');
                vi.mocked(redis.get).mockResolvedValue(null);
                vi.mocked(redis.set).mockResolvedValue('OK' as never);
                vi.mocked(axios.post).mockResolvedValue({ data: {
                    reply: 'تفضّل', language: 'ar', confidence: 'high', flags: [],
                    gender: 'm', genderBasis: 'name', usedName: false,
                } });

                await service.generateReply({ comment: 'كم السعر؟', context: dmContext });
                await new Promise(r => setTimeout(r, 50));

                const cacheWrites = vi.mocked(redis.set).mock.calls
                    .filter(call => typeof call[0] === 'string' && (call[0] as string).startsWith('cache:ai_reply:'));
                expect(cacheWrites).toHaveLength(1);
                expect(JSON.parse(cacheWrites[0][1] as string).variants).toBeUndefined();
            });
        });

        it('flag off: transform never called, save path byte-identical to today', async () => {
            const { generateGenderVariant } = await import('../../src/services/genderVariantTransform');
            const { redis } = await import('../../src/lib/redis');
            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(redis.set).mockResolvedValue('OK' as never);
            vi.mocked(axios.post).mockResolvedValue({ data: {
                reply: 'تفضّل', language: 'ar', confidence: 'high', flags: [],
                gender: 'm', genderBasis: 'name', usedName: false,
            } });

            await service.generateReply({ comment: 'كم السعر؟', context: dmContext });
            await new Promise(r => setTimeout(r, 50));

            expect(generateGenderVariant).not.toHaveBeenCalled();
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
        semanticCacheEnabled?: boolean;
        qualityGateEnabled?: boolean;
    } = {}) {
        vi.doMock('../../src/lib/redis', () => ({
            redis: {
                get: vi.fn().mockResolvedValue(overrides.redisReply ?? null),
                set: vi.fn(),
                incr: vi.fn().mockResolvedValue(1),
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
                // qualityGateEnabled defaults OFF in this harness — these tests exercise
                // semantic-cache mechanics, not the gate. The gate parity tests opt in.
                ai: { enabled: true, cacheEnabled: true, semanticCacheEnabled: overrides.semanticCacheEnabled ?? true, qualityGateEnabled: overrides.qualityGateEnabled ?? false, serviceUrl: 'http://localhost:3002', model: 'gpt-4.1-mini' },
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

    it('should instrument semantic cache check with ai.cache.semantic span', async () => {
        setupMocks({
            semanticCacheHit: { reply: 'Semantic hit', intent: 'PRICE', confidence: 'high', flags: [] },
        });

        const sentry = await import('@sentry/node');
        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'How much is this?',
            context: { pageId: 'page-1', kbActiveVersion: 1 },
        });

        expect(vi.mocked(sentry.startSpan)).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'ai.cache.semantic', op: 'cache.get' }),
            expect.any(Function),
        );
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
        // The embedding passed to check should be the pre-computed one.
        // Options.model is the model cache scope: undefined for the default model
        // so it matches save-side rows (which also store undefined for the
        // default — passing the model name here was the #164 bug that disabled
        // semantic reads for all default-model workspaces).
        expect(mockSemCache.check).toHaveBeenCalledWith('page-1', preComputed, expect.any(String), 1, {
            channel: undefined,
            replyStyle: undefined,
            model: undefined,
            brandVoiceHash: undefined,
        });
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
        // Intent should be pre-GPT classified (PRICE normalized to QUESTION via classifyFallbackIntent)
        expect(saveArgs.intent).toBe('QUESTION');
    });

    it('quality gate parity: a gated reply is not saved to the semantic cache either', async () => {
        // One decision governs both save sites — a reply too weak for the exact
        // cache must not survive as a semantic entry (which would serve it fuzzily).
        const { mockSemCache } = setupMocks({
            qualityGateEnabled: true,
            semanticCacheHit: null,
            axiosReply: { reply: 'Not sure about that price', language: 'en', intent: 'QUESTION', confidence: 'high', flags: ['price_not_in_kb'] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        const result = await service.generateReply({
            comment: 'How much is this?',
            context: { pageId: 'page-1', kbActiveVersion: 2 },
        });

        expect(result.reply).toBe('Not sure about that price');
        await new Promise(r => setTimeout(r, 50));
        expect(mockSemCache.save).not.toHaveBeenCalled();
    });

    it('quality gate parity: a clean reply still saves to the semantic cache with the gate on', async () => {
        const { mockSemCache } = setupMocks({
            qualityGateEnabled: true,
            semanticCacheHit: null,
            axiosReply: { reply: 'Price is $50', language: 'en', intent: 'QUESTION', confidence: 'high', flags: [] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'How much is this?',
            context: { pageId: 'page-1', kbActiveVersion: 2 },
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockSemCache.save).toHaveBeenCalledTimes(1);
    });

    it('should skip the semantic cache entirely (read + write + embed) when semanticCacheEnabled=false', async () => {
        // Even with pageId + kbActiveVersion + a pre-computed embedding present
        // (the conditions that normally trigger a semantic check), the flag-off
        // path must not probe, must not embed, and must not write — it goes
        // straight to the AI worker. This is the dormant-layer cost/latency saver.
        const preComputed = new Array(512).fill(0.3);
        const { mockSemCache, mockEmbed } = setupMocks({
            semanticCacheEnabled: false,
            axiosReply: { reply: 'Fresh AI reply', language: 'en', intent: 'QUESTION', confidence: 'high', flags: [] },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        const result = await service.generateReply({
            comment: 'How much is this?',
            context: { pageId: 'page-1', kbActiveVersion: 1, queryEmbedding: preComputed },
        });

        // Falls through to the AI worker
        expect(result.reply).toBe('Fresh AI reply');
        expect(result.cached).toBe(false);
        // No semantic read, no embedding probe
        expect(mockSemCache.check).not.toHaveBeenCalled();
        expect(mockEmbed).not.toHaveBeenCalled();
        // No semantic write either (would store rows nothing reads)
        await new Promise(r => setTimeout(r, 50));
        expect(mockSemCache.save).not.toHaveBeenCalled();
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

describe('AI Service - Provider Failover', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function setupFailoverMocks(overrides: {
        failoverReply?: Record<string, unknown>;
        failoverError?: Error;
        redisGet?: string | null;
    } = {}) {
        vi.doMock('../../src/lib/redis', () => ({
            redis: {
                get: vi.fn().mockResolvedValue(overrides.redisGet ?? null),
                set: vi.fn().mockResolvedValue('OK'),
                quit: vi.fn(),
                incr: vi.fn().mockResolvedValue(1),
            },
        }));

        vi.doMock('../../src/db', () => ({
            db: {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockReturnValue({
                        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
                        returning: vi.fn().mockResolvedValue([{ id: 'notif-1' }]),
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

        vi.doMock('../../src/db/schema', () => ({
            aiCache: {},
            aiUsageLog: {},
            deviceTokens: {},
            notifications: {},
            settings: {},
        }));

        vi.doMock('drizzle-orm', () => ({
            eq: vi.fn(),
            and: vi.fn(),
            desc: vi.fn(),
            count: vi.fn(),
            sql: vi.fn().mockReturnValue('sql-mock'),
        }));

        // Circuit breaker throws CircuitOpenError (simulating open circuit)
        const CircuitOpenErrorClass = class CircuitOpenError extends Error {
            constructor() { super('Circuit open'); this.name = 'CircuitOpenError'; }
        };
        vi.doMock('../../src/lib/circuitBreaker', () => ({
            aiWorkerCircuit: {
                execute: vi.fn().mockRejectedValue(new CircuitOpenErrorClass()),
                getState: vi.fn().mockResolvedValue('open'),
            },
            CircuitOpenError: CircuitOpenErrorClass,
        }));

        // Axios: failover call
        const axiosMock = {
            post: vi.fn(),
        };
        if (overrides.failoverError) {
            axiosMock.post.mockRejectedValue(overrides.failoverError);
        } else {
            axiosMock.post.mockResolvedValue({
                data: overrides.failoverReply ?? {
                    reply: 'Claude fallback reply',
                    language: 'en',
                    intent: 'QUESTION',
                    confidence: 'high',
                    flags: [],
                    tokensIn: 100,
                    tokensOut: 50,
                },
            });
        }
        vi.doMock('axios', () => ({ default: axiosMock }));

        vi.doMock('../../src/config', () => ({
            config: {
                ai: {
                    enabled: true,
                    cacheEnabled: true,
                    serviceUrl: 'http://localhost:3002',
                    model: 'gpt-4.1-mini',
                    fallbackModel: 'claude-haiku-4-5-20251001',
                },
                openai: { apiKey: '' },
            },
        }));

        vi.doMock('@sentry/node', () => ({
            startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
            captureException: vi.fn(),
            captureMessage: vi.fn(),
            addBreadcrumb: vi.fn(),
        }));

        return { axiosMock };
    }

    it('should failover to Claude when circuit breaker is open', async () => {
        setupFailoverMocks();

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        const result = await service.generateReply({
            comment: 'What is the price?',
            context: { userId: 'user-1' },
        });

        expect(result.reply).toBe('Claude fallback reply');
        expect(result.model).toBe('claude-haiku-4-5-20251001');
        expect(result.cached).toBe(false);
        expect(result.flags).toContain('provider_failover');
    });

    it('should append provider_failover to existing flags', async () => {
        setupFailoverMocks({
            failoverReply: {
                reply: 'Reply from Claude',
                language: 'ar',
                intent: 'COMPLAINT',
                confidence: 'high',
                flags: ['angry_customer'],
                tokensIn: 200,
                tokensOut: 100,
            },
        });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        const result = await service.generateReply({
            comment: 'هذا المنتج سيء جداً!',
            context: { userId: 'user-1' },
        });

        expect(result.flags).toEqual(['angry_customer', 'provider_failover']);
        expect(result.intent).toBe('COMPLAINT');
        expect(result.language).toBe('ar');
    });

    it('should call ai-worker directly (bypass circuit breaker) for failover', async () => {
        const { axiosMock } = setupFailoverMocks();

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { userId: 'user-1' },
        });

        // Verify direct axios.post call with fallback model
        expect(axiosMock.post).toHaveBeenCalledWith(
            'http://localhost:3002/generate',
            expect.objectContaining({
                comment: 'Hello',
                model: 'claude-haiku-4-5-20251001',
            }),
            expect.objectContaining({ timeout: 30000 }),
        );
    });

    it('should send Sentry warning on successful failover', async () => {
        setupFailoverMocks();

        const sentry = await import('@sentry/node');
        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { userId: 'user-1' },
        });

        expect(sentry.captureMessage).toHaveBeenCalledWith(
            'AI provider failover active',
            expect.objectContaining({
                level: 'warning',
                tags: { fallbackModel: 'claude-haiku-4-5-20251001' },
            }),
        );
    });

    it('should send deduplicated push notification on failover', async () => {
        setupFailoverMocks();

        const { redis } = await import('../../src/lib/redis');
        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { userId: 'user-1' },
        });

        // Should check Redis for dedup key
        expect(redis.get).toHaveBeenCalledWith('failover:notified:user-1');
        // Should set dedup key with 1-hour TTL
        expect(redis.set).toHaveBeenCalledWith('failover:notified:user-1', '1', 'EX', 3600);
    });

    it('should skip notification when already notified (dedup key exists)', async () => {
        setupFailoverMocks({ redisGet: '1' });

        const { redis } = await import('../../src/lib/redis');
        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { userId: 'user-1' },
        });

        // Should check for dedup key
        expect(redis.get).toHaveBeenCalledWith('failover:notified:user-1');
        // Should NOT set a new dedup key (already exists)
        const setCalls = vi.mocked(redis.set).mock.calls.filter(
            (call) => call[0] === 'failover:notified:user-1',
        );
        expect(setCalls).toHaveLength(0);
    });

    it('should throw when both primary and failover fail (no fake fallback)', async () => {
        // Previously: tail of the catch block returned `t('commentFallback', lang)`,
        // landing "Thank you for your comment!" mid-conversation. New contract:
        // rethrow so BullMQ retries the job and, if exhaustion is reached,
        // flagStuckJobOnFinalFailure surfaces the message as needs_attention.
        setupFailoverMocks({ failoverError: new Error('Claude API also down') });

        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await expect(service.generateReply({
            comment: 'Hello',
            context: { userId: 'user-1' },
        })).rejects.toThrow();
    });

    it('should not write to cache during failover', async () => {
        setupFailoverMocks();

        const { redis } = await import('../../src/lib/redis');
        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { userId: 'user-1' },
        });

        // Redis set should only be called for dedup key, NOT for cache
        const cacheSetCalls = vi.mocked(redis.set).mock.calls.filter(
            (call) => String(call[0]).startsWith('cache:'),
        );
        expect(cacheSetCalls).toHaveLength(0);
    });

    it('should instrument failover HTTP call with Sentry span', async () => {
        setupFailoverMocks();

        const sentry = await import('@sentry/node');
        const { AiService: FreshService } = await import('../../src/services/ai');
        const service = new FreshService();

        await service.generateReply({
            comment: 'Hello',
            context: { userId: 'user-1' },
        });

        expect(sentry.startSpan).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'ai.failover.http',
                op: 'http.client',
            }),
            expect.any(Function),
        );
    });
});

describe('AI Service (disabled)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should throw AiUnavailableError when AI_ENABLED=false (no fake fallback)', async () => {
        // Previously returned a hardcoded "Thank you" reply with model: 'disabled'.
        // That would land mid-conversation if the env var was ever misdeployed.
        // New contract: throw — the reply pipeline retries and (after retries
        // exhaust) flags the row needs_attention so the merchant handles it.
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
        const { AiUnavailableError } = await import('../../src/utils/fbGraphErrors');
        const disabledService = new DisabledAiService();

        await expect(disabledService.generateReply({ comment: 'Hello!' }))
            .rejects.toBeInstanceOf(AiUnavailableError);
    });
});

