/**
 * Regression test for duplicate FCM device tokens.
 *
 * Bug context: `registerDeviceToken` was a non-transactional check-then-insert
 * (SELECT → branch → INSERT) against a table with no unique constraint. Two
 * concurrent registrations of the SAME token both read zero rows and both
 * inserted, so `getUserDeviceTokens` — which does not DISTINCT — handed
 * `sendEachForMulticast` the list `[T, T]` and FCM delivered the identical push
 * to the same device twice, milliseconds apart. It looked like a notification
 * bug; it was a write-path race.
 *
 * The 30-day stale-token prune could never recover from it: both rows carry the
 * same token, and the prune deletes only siblings where `token != <this token>`.
 * So a single racing registration produced permanent double pushes for that user.
 *
 * The mocked unit tests in test/services/notifications.test.ts can only assert
 * the SHAPE of the call. Only a real database can prove the race is closed, so
 * that is what these do — they fail against the old implementation and against
 * a schema missing migration 0165.
 */
import { describe, it, expect } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import './setup';
import { testDb, createTestUser } from './setup';
import { deviceTokens } from '../../src/db/schema';
import { notificationService } from '../../src/services/notifications';

async function rowsFor(userId: string, token: string) {
    return testDb
        .select()
        .from(deviceTokens)
        .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
}

describe('device_tokens uniqueness (regression for the duplicate-push race)', () => {
    it('keeps ONE row when the same token registers concurrently', async () => {
        const user = await createTestUser();
        const token = 'fcm-concurrent-token';

        // The real shape of the race: initPushNotifications on mount and
        // refreshPushRegistration on resume both call PushNotifications.register(),
        // and each `registration` event POSTs here. These run on separate pool
        // connections, so they genuinely interleave.
        await Promise.all([
            notificationService.registerDeviceToken(user.id, token, 'android'),
            notificationService.registerDeviceToken(user.id, token, 'android'),
            notificationService.registerDeviceToken(user.id, token, 'android'),
            notificationService.registerDeviceToken(user.id, token, 'android'),
            notificationService.registerDeviceToken(user.id, token, 'android'),
        ]);

        const rows = await rowsFor(user.id, token);
        expect(rows).toHaveLength(1);
    });

    it('sends the token exactly once to FCM after a racing registration', async () => {
        // The assertion that matches the merchant-visible symptom: whatever the
        // table holds, the multicast must not carry the same token twice.
        const user = await createTestUser();
        const token = 'fcm-multicast-token';

        await Promise.all([
            notificationService.registerDeviceToken(user.id, token, 'android'),
            notificationService.registerDeviceToken(user.id, token, 'android'),
        ]);

        const tokens = await notificationService.getUserDeviceTokens(user.id);
        const values = tokens.map(t => t.token);
        expect(values).toEqual([token]);
        expect(new Set(values).size).toBe(values.length);
    });

    it('refreshes lastUsedAt on re-registration instead of inserting a second row', async () => {
        const user = await createTestUser();
        const token = 'fcm-refresh-token';

        await notificationService.registerDeviceToken(user.id, token, 'android');
        const [first] = await rowsFor(user.id, token);

        // Re-register after a measurable gap so the bump is observable.
        await new Promise(resolve => setTimeout(resolve, 25));
        await notificationService.registerDeviceToken(user.id, token, 'android');

        const rows = await rowsFor(user.id, token);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(first.id);
        expect(rows[0].lastUsedAt!.getTime()).toBeGreaterThan(first.lastUsedAt!.getTime());
        // The token belongs to the install that minted it — platform is not rewritten.
        expect(rows[0].platform).toBe('android');
    });

    it('still stores distinct tokens for the same user (rotation must not collapse)', async () => {
        const user = await createTestUser();

        await notificationService.registerDeviceToken(user.id, 'fcm-rotate-a', 'android');
        await notificationService.registerDeviceToken(user.id, 'fcm-rotate-b', 'android');

        const tokens = await notificationService.getUserDeviceTokens(user.id);
        expect(tokens.map(t => t.token).sort()).toEqual(['fcm-rotate-a', 'fcm-rotate-b']);
    });

    it('rejects a duplicate (user_id, token) at the database level', async () => {
        // Pins the constraint itself, not just the code that cooperates with it.
        // Without migration 0165 this insert succeeds and the test fails.
        const user = await createTestUser();
        const token = 'fcm-constraint-token';

        await testDb.insert(deviceTokens).values({ userId: user.id, token, platform: 'android' });

        // drizzle wraps the driver error, so the SQLSTATE lives on `cause` —
        // asserting `err.code` directly reads `undefined` and passes nothing.
        const err = await testDb
            .insert(deviceTokens)
            .values({ userId: user.id, token, platform: 'android' })
            .then(() => null)
            .catch((e: unknown) => e as { cause?: { code?: string; constraint_name?: string } });

        expect(err, 'a second identical row must be rejected').not.toBeNull();
        expect(err!.cause?.code).toBe('23505');
        expect(err!.cause?.constraint_name).toBe('idx_device_tokens_user_token');
    });

    it('carries the unique index the upsert names as its conflict target', async () => {
        // onConflictDoUpdate targets (user_id, token). If the index were dropped
        // or renamed, every registration would throw "no unique or exclusion
        // constraint matching the ON CONFLICT specification" — in production, on
        // the path that keeps push working at all.
        const [row] = await testDb.execute<{ indexdef: string }>(sql`
            SELECT indexdef FROM pg_indexes
            WHERE tablename = 'device_tokens' AND indexname = 'idx_device_tokens_user_token'
        `);

        expect(row?.indexdef).toBeDefined();
        expect(row.indexdef).toContain('UNIQUE');
        expect(row.indexdef).toMatch(/\(user_id, token\)/);
    });
});
