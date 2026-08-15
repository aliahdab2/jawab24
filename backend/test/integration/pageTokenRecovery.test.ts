/**
 * Page-token recovery against a REAL database.
 *
 * The unit suite mocks `db.update()`, so its `.where(...)` mock returns whatever
 * the test tells it to REGARDLESS of the condition — it can prove the CAS clause
 * is constructed, never that Postgres agrees with it. That gap matters here more
 * than anywhere else in the module: if the compare-and-set silently never
 * matched, every unit test would still pass while production stopped
 * disconnecting pages altogether — the 2026-08-10 / 2026-08-14 silence, restored
 * by the fix for it. If it matched too eagerly, a merchant's fresh token would be
 * wiped. Both directions are checked below, with the real crypto in play.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestWorkspace, createTestPage } from './setup';
import * as schema from '../../src/db/schema';
import { markPageNeedsReconnect } from '../../src/services/pageTokenRecovery';
import { encryptFbToken, isEncrypted } from '../../src/services/facebookCrypto';

// The alert fan-out is not what this file is about — it is covered by the unit
// suite. Stub the two outbound channels so the DB assertions stand alone.
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
        sendNotification: vi.fn().mockResolvedValue('notif-1'),
    },
}));
vi.mock('../../src/services/email', () => ({
    emailService: { trySend: vi.fn().mockResolvedValue({ delivered: true }) },
}));

const readRow = async (id: string) => {
    const [row] = await testDb
        .select({ accessToken: schema.pages.accessToken, disconnectReason: schema.pages.disconnectReason })
        .from(schema.pages)
        .where(eq(schema.pages.id, id));
    return row;
};

/** The shape `runRecovery` hands `markPageNeedsReconnect`, including the stored
 *  ciphertext it read at entry — the CAS operand. */
const recoverable = (page: { id: string; userId: string; workspaceId: string | null }, accessToken: string) => ({
    id: page.id,
    userId: page.userId,
    workspaceId: page.workspaceId,
    name: 'Integration Page',
    facebookPageId: 'fb-recovery-int',
    accessToken,
});

describe('markPageNeedsReconnect — the CAS guard against a real Postgres', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears the token when the row still holds the credential Facebook rejected', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const stored = encryptFbToken('EAABsbCS4iNw-dead-token');
        const page = await createTestPage(user.id, { workspaceId: workspace.id, accessToken: stored });
        expect(isEncrypted(stored)).toBe(true);

        await markPageNeedsReconnect(recoverable({ ...page, userId: user.id }, stored) as never, 'password_changed');

        const row = await readRow(page.id);
        expect(row.accessToken).toBe('');
        expect(row.disconnectReason).toBe('token_revoked');
    });

    it('leaves a token written AFTER the verdict was formed completely alone', async () => {
        // The 2026-08-14 shape: the merchant reconnects while `/me/accounts` is
        // still in flight, so the row now holds a credential the dead-token
        // verdict says nothing about.
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const staleToken = encryptFbToken('EAABsbCS4iNw-token-read-at-entry');
        const page = await createTestPage(user.id, { workspaceId: workspace.id, accessToken: staleToken });

        // …the reconnect lands.
        const freshToken = encryptFbToken('EAABsbCS4iNw-freshly-reconnected');
        await testDb
            .update(schema.pages)
            .set({ accessToken: freshToken, disconnectReason: null })
            .where(eq(schema.pages.id, page.id));

        // …and only now does the stale verdict try to apply itself.
        await markPageNeedsReconnect(recoverable({ ...page, userId: user.id }, staleToken) as never, 'password_changed');

        const row = await readRow(page.id);
        expect(row.accessToken).toBe(freshToken);
        expect(row.disconnectReason).toBeNull();
    });

    it('stays idempotent — a repeat pass over an already-cleared row still matches', async () => {
        // The CAS operand on the second pass is the '' the first pass wrote, so
        // '' = '' matches and the write remains idempotent rather than becoming
        // a permanent no-op.
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id, accessToken: '' });

        await markPageNeedsReconnect(recoverable({ ...page, userId: user.id }, '') as never, 'password_changed');

        const row = await readRow(page.id);
        expect(row.accessToken).toBe('');
        expect(row.disconnectReason).toBe('token_revoked');
    });
});
