import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same import-side-effect mocks as auth.test.ts — the handoff-code methods
// only touch Redis + crypto, but the module pulls in db/subscriptions.
vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/db/schema', () => ({ users: {}, subscriptions: {} }));
vi.mock('../../src/services/subscriptions', () => ({ subscriptionsService: {} }));
vi.mock('drizzle-orm', () => ({
    eq: vi.fn(), inArray: vi.fn(), sql: vi.fn(), and: vi.fn(), or: vi.fn(), gt: vi.fn(),
}));

// In-memory Redis fake: enough of SET EX + MULTI GET/DEL to prove the
// single-use contract the real ioredis provides atomically.
const store = vi.hoisted(() => new Map<string, string>());
const mockRedis = vi.hoisted(() => ({
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    multi: vi.fn(() => {
        let readKey = '';
        const chain = {
            get(key: string) { readKey = key; return chain; },
            del(_key: string) { return chain; },
            exec: async () => {
                const value = store.get(readKey) ?? null;
                const existed = store.delete(readKey);
                return [[null, value], [null, existed ? 1 : 0]] as [Error | null, unknown][];
            },
        };
        return chain;
    }),
}));
vi.mock('../../src/lib/redis', () => ({ redis: mockRedis }));

import { authService } from '../../src/services/auth';

describe('authService browser-handoff code (single-use contract)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.clear();
    });

    it('mints an opaque high-entropy code stored under handoff:browser:* with a 60s TTL', async () => {
        const code = await authService.mintBrowserHandoffCode('user-1');

        // 32 random bytes base64url ≈ 43 chars — opaque, no claims to decode.
        expect(code.length).toBeGreaterThanOrEqual(40);
        expect(code).not.toContain('.');
        expect(mockRedis.set).toHaveBeenCalledWith(`handoff:browser:${code}`, 'user-1', 'EX', 60);
    });

    it('two mints never collide', async () => {
        const a = await authService.mintBrowserHandoffCode('user-1');
        const b = await authService.mintBrowserHandoffCode('user-1');
        expect(a).not.toBe(b);
    });

    it('consume returns the userId ONCE — the second consume gets null (replay dead)', async () => {
        const code = await authService.mintBrowserHandoffCode('user-1');

        await expect(authService.consumeBrowserHandoffCode(code)).resolves.toBe('user-1');
        await expect(authService.consumeBrowserHandoffCode(code)).resolves.toBeNull();
    });

    it('consume of an unknown code returns null', async () => {
        await expect(authService.consumeBrowserHandoffCode('never-minted')).resolves.toBeNull();
    });
});
