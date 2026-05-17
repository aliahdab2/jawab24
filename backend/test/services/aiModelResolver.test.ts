import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle-orm helpers used by the resolver — return opaque objects so the
// chained query mock doesn't care what's passed.
vi.mock('drizzle-orm', () => ({
    eq: vi.fn((..._args: unknown[]) => ({ __op: 'eq' })),
}));

// In-memory mock for db.select().from().where().limit() — each test reassigns
// the resolved value via `setRow(...)` before calling the resolver.
const limit = vi.fn();
vi.mock('../../src/db', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({ limit }),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    settings: { aiModel: 'ai_model', userId: 'user_id' },
}));

function setRow(value: string | null | undefined): void {
    if (value === undefined) limit.mockResolvedValueOnce([]);
    else limit.mockResolvedValueOnce([{ aiModel: value }]);
}

describe('aiModelResolver', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset the module so the in-process LRU cache is fresh per test.
        vi.resetModules();
    });

    it('returns DEFAULT_AI_MODEL when userId is missing', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        await expect(getModelForUser(undefined)).resolves.toBe('gpt-4.1-mini');
        await expect(getModelForUser(null)).resolves.toBe('gpt-4.1-mini');
        await expect(getModelForUser('')).resolves.toBe('gpt-4.1-mini');
        // None of those should have hit the DB.
        expect(limit).not.toHaveBeenCalled();
    });

    it('returns DEFAULT_AI_MODEL when no settings row exists', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        setRow(undefined); // no row
        await expect(getModelForUser('u1')).resolves.toBe('gpt-4.1-mini');
    });

    it('returns DEFAULT_AI_MODEL when settings.ai_model is null', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        setRow(null);
        await expect(getModelForUser('u2')).resolves.toBe('gpt-4.1-mini');
    });

    it('returns DEFAULT_AI_MODEL when settings.ai_model is empty string', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        setRow('');
        await expect(getModelForUser('u3')).resolves.toBe('gpt-4.1-mini');
    });

    it('returns DEFAULT_AI_MODEL when settings.ai_model is not in the allowlist', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        setRow('gpt-99-typo');
        await expect(getModelForUser('u4')).resolves.toBe('gpt-4.1-mini');
    });

    it('returns the overridden model when it is in the allowlist', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        setRow('gpt-4o-mini');
        await expect(getModelForUser('u5')).resolves.toBe('gpt-4o-mini');
    });

    it('caches the resolution and avoids a second DB hit within TTL', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        setRow('gpt-4o-mini');
        await getModelForUser('u-cache');
        // Second call should be served from cache — no new mock value needed.
        await getModelForUser('u-cache');
        expect(limit).toHaveBeenCalledTimes(1);
    });

    it('clearAiModelCache invalidates a specific user', async () => {
        const { getModelForUser, clearAiModelCache } = await import('../../src/services/aiModelResolver');
        setRow('gpt-4o-mini');
        await getModelForUser('u-invalidate');
        clearAiModelCache('u-invalidate');
        // After invalidation, expect a second DB call.
        setRow('gpt-4.1-nano');
        await expect(getModelForUser('u-invalidate')).resolves.toBe('gpt-4.1-nano');
        expect(limit).toHaveBeenCalledTimes(2);
    });

    it('clearAiModelCache() with no arg invalidates every user', async () => {
        const { getModelForUser, clearAiModelCache } = await import('../../src/services/aiModelResolver');
        setRow('gpt-4o-mini');
        await getModelForUser('u-a');
        setRow('gpt-4o-mini');
        await getModelForUser('u-b');
        clearAiModelCache();
        setRow('gpt-4.1');
        setRow('gpt-4.1');
        await getModelForUser('u-a');
        await getModelForUser('u-b');
        expect(limit).toHaveBeenCalledTimes(4);
    });

    it('different users get independent cache entries', async () => {
        const { getModelForUser } = await import('../../src/services/aiModelResolver');
        setRow('gpt-4o-mini');
        setRow('gpt-4.1');
        const m1 = await getModelForUser('user-1');
        const m2 = await getModelForUser('user-2');
        expect(m1).toBe('gpt-4o-mini');
        expect(m2).toBe('gpt-4.1');
        expect(limit).toHaveBeenCalledTimes(2);
    });
});
