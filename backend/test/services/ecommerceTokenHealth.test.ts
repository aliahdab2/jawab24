import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Pins the write-side of the "store needs reconnect" (S3) feature, which is
 * otherwise mocked everywhere:
 *  - markStoreNeedsReauth merges tokenHealth='invalid' without clobbering keys,
 *    and is idempotent.
 *  - updateStoreTokens clears the flag on a successful refresh, only touching
 *    platformData when it was actually flagged.
 *  - createStore's conflict (reconnect) path always resets platformData — the H1
 *    regression: the claim path passes no platformData, and before the fix Drizzle
 *    omitted it, leaving a stale needs-reauth flag after reconnect.
 *
 * Real crypto (createStore/updateStoreTokens encrypt tokens); only the DB is mocked,
 * capturing the SET / conflict args so the merge logic is genuinely asserted.
 */

process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY = 'test-encryption-key-must-be-32-chars-long!!';

const state = vi.hoisted(() => ({
    selectResult: [] as unknown[],
    capturedUpdateSet: undefined as Record<string, unknown> | undefined,
    capturedConflict: undefined as { set?: Record<string, unknown> } | undefined,
    updateCalls: 0,
}));

vi.mock('../../src/config', () => ({
    config: { shopify: { tokenEncryptionKey: 'test-encryption-key-must-be-32-chars-long!!' } },
}));
vi.mock('../../src/lib/redis', () => ({
    redis: {}, redisScanDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { seedDefaults: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: vi.fn(() => Promise.resolve(state.selectResult)) }),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((set: Record<string, unknown>) => {
                state.capturedUpdateSet = set;
                state.updateCalls++;
                return { where: vi.fn().mockResolvedValue(undefined) };
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockImplementation((conf: { set?: Record<string, unknown> }) => {
                    state.capturedConflict = conf;
                    return { returning: vi.fn().mockResolvedValue([{ id: 'store-x' }]) };
                }),
            }),
        }),
    },
}));

import { markStoreNeedsReauth, updateStoreTokens, createStore, applySyncedStoreInfo, deactivateStore, disconnectStore } from '../../src/services/ecommerce';

beforeEach(() => {
    state.selectResult = [];
    state.capturedUpdateSet = undefined;
    state.capturedConflict = undefined;
    state.updateCalls = 0;
});

describe('markStoreNeedsReauth', () => {
    it('merges tokenHealth=invalid, preserving existing platformData keys', async () => {
        state.selectResult = [{ platformData: { merchantId: '123', webhookStatus: { ok: true } } }];
        await markStoreNeedsReauth('store-1');
        expect(state.capturedUpdateSet?.platformData).toEqual({
            merchantId: '123', webhookStatus: { ok: true }, tokenHealth: 'invalid',
        });
    });

    it('flagging an already-invalid store keeps it invalid (end-state idempotent merge)', async () => {
        state.selectResult = [{ platformData: { merchantId: '123', tokenHealth: 'invalid' } }];
        await markStoreNeedsReauth('store-1');
        expect(state.capturedUpdateSet?.platformData).toEqual({ merchantId: '123', tokenHealth: 'invalid' });
    });
});

describe('applySyncedStoreInfo — fullSync must not clobber platformData', () => {
    // Regression (audit 2026-07-09): fullSync used to REPLACE the whole platformData
    // column with { merchantId }, wiping webhookStatus (the "Re-register webhooks"
    // CTA + retry-worker exhaustion marker) and tokenHealth (the Reconnect banner)
    // on every 6h scheduled sync, product webhook, and manual Sync click.
    it('merges the patch, preserving webhookStatus and tokenHealth', async () => {
        state.selectResult = [{
            platformData: {
                merchantId: 'old-id',
                webhookStatus: { registered: 2, failed: 1, exhausted: true },
                tokenHealth: 'invalid',
            },
        }];
        await applySyncedStoreInfo('store-1', { storeName: 'New Name', storeCurrency: 'SAR' }, { merchantId: 'new-id' });
        expect(state.capturedUpdateSet?.storeName).toBe('New Name');
        expect(state.capturedUpdateSet?.storeCurrency).toBe('SAR');
        expect(state.capturedUpdateSet?.platformData).toEqual({
            merchantId: 'new-id',
            webhookStatus: { registered: 2, failed: 1, exhausted: true },
            tokenHealth: 'invalid',
        });
    });

    it('handles a store with no prior platformData', async () => {
        state.selectResult = [{ platformData: null }];
        await applySyncedStoreInfo('store-1', { storeName: 'N' }, { merchantId: 'm-1' });
        expect(state.capturedUpdateSet?.platformData).toEqual({ merchantId: 'm-1' });
    });
});

describe('updateStoreTokens — clear-on-success', () => {
    it('clears tokenHealth to ok (preserving other keys) when previously invalid', async () => {
        state.selectResult = [{ platformData: { merchantId: '123', tokenHealth: 'invalid' } }];
        await updateStoreTokens('store-1', { accessToken: 'a', refreshToken: 'r', tokenExpiresAt: new Date() });
        expect(state.capturedUpdateSet?.platformData).toEqual({ merchantId: '123', tokenHealth: 'ok' });
    });

    it('does NOT touch platformData when the store was never flagged', async () => {
        state.selectResult = [{ platformData: { merchantId: '123' } }];
        await updateStoreTokens('store-1', { accessToken: 'a' });
        expect(state.capturedUpdateSet).toBeDefined();
        expect('platformData' in (state.capturedUpdateSet as object)).toBe(false);
    });
});

describe('token blanking on inactive (SI-4)', () => {
    // Defense-in-depth: the encrypted OAuth tokens must be cleared the instant a store
    // goes inactive, not left at rest for the 30-day retention window before purgeStore.
    it('deactivateStore blanks access/refresh tokens (accessToken NOT NULL → "") and flips isActive', async () => {
        await deactivateStore('salla', 'my-store.salla.sa');
        expect(state.capturedUpdateSet).toMatchObject({
            isActive: false,
            accessToken: '',
            accessTokenIv: '',
            refreshToken: null,
            refreshTokenIv: null,
        });
        expect(state.capturedUpdateSet?.uninstalledAt).toBeInstanceOf(Date);
    });

    it('disconnectStore also blanks tokens (store update is the last SET captured)', async () => {
        await disconnectStore('store-1');
        expect(state.capturedUpdateSet).toMatchObject({
            isActive: false,
            accessToken: '',
            accessTokenIv: '',
            refreshToken: null,
            refreshTokenIv: null,
        });
    });
});

describe('createStore reconnect (H1 regression)', () => {
    it('always sets platformData on conflict even when none is passed (claim path) — clears stale tokenHealth', async () => {
        await createStore({ userId: 'u', platform: 'salla', storeDomain: 'x.salla.sa', accessToken: 'a' });
        // The conflict SET must carry a platformData expression (the jsonb merge that
        // resets tokenHealth). Before the fix this was `opts.platformData` = undefined,
        // which Drizzle omitted, leaving a stale needs-reauth flag after a claim reconnect.
        expect(state.capturedConflict?.set?.platformData).toBeDefined();
    });
});
