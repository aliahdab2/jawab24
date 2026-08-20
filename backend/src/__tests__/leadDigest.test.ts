/**
 * Tests: daily lead digest service.
 * Verifies:
 *   - per-workspace threshold + grouping
 *   - age flush: below-threshold batches send once the oldest lead is stale
 *   - workspace-owner subscription gate
 *   - per-recipient gates: muted, no email, abandoned
 *   - fan-out: every owner+admin gets one email
 *   - idempotent stamping (success vs transient failure vs all-terminal)
 *   - audit-log writes carry workspaceId + per-recipient userId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    joinQueryRows,
    ownerSubQueue,
    recipientsQueue,
    updateSetMock,
    updateWhereMock,
    insertValuesMock,
    emailSendMock,
    detectLanguageMock,
} = vi.hoisted(() => ({
    joinQueryRows: { value: [] as unknown[] },
    ownerSubQueue: { value: [] as unknown[][] },
    recipientsQueue: { value: [] as unknown[][] },
    updateSetMock: vi.fn(),
    updateWhereMock: vi.fn().mockResolvedValue(undefined),
    insertValuesMock: vi.fn().mockResolvedValue(undefined),
    emailSendMock: vi.fn(),
    detectLanguageMock: vi.fn().mockReturnValue('en'),
}));

vi.mock('../db', () => {
    // Service issues SELECT queries in a fixed order:
    //   call #0:           main JOIN (leads ⋈ pages)        — terminal: .where(...) returns array
    //   call #1, 3, 5...:  owner-subscription per workspace — terminal: .limit(1) returns single-row array
    //   call #2, 4, 6...:  recipients per workspace         — terminal: .where(...) returns array
    //
    // Tests provide ownerSubQueue + recipientsQueue with one entry per workspace.
    let selectCallIndex = 0;

    const makeChain = () => {
        const myCallIndex = selectCallIndex++;
        const chain: Record<string, unknown> = {};
        chain.from      = vi.fn(() => chain);
        chain.innerJoin = vi.fn(() => chain);
        chain.leftJoin  = vi.fn(() => chain);
        chain.where     = vi.fn(() => {
            // Terminal for main query (call 0) and recipients queries (even indexes > 0).
            // For owner-sub queries (odd indexes), .where() is intermediate and .limit() is terminal.
            const isOwnerSubQuery = myCallIndex > 0 && myCallIndex % 2 === 1;
            if (isOwnerSubQuery) return chain; // intermediate, await happens at .limit()
            const value = myCallIndex === 0
                ? joinQueryRows.value
                : (recipientsQueue.value.shift() ?? []);
            return Object.assign(Promise.resolve(value), chain);
        });
        chain.limit     = vi.fn(() => Promise.resolve(ownerSubQueue.value.shift() ?? []));
        return chain;
    };

    return {
        db: {
            select: vi.fn(() => makeChain()),
            update: vi.fn(() => ({
                set: updateSetMock.mockReturnThis(),
                where: updateWhereMock,
            })),
            insert: vi.fn(() => ({
                values: insertValuesMock,
            })),
            __resetSelectIndex: () => { selectCallIndex = 0; },
        },
    };
});

vi.mock('../services/email', () => ({
    emailService: {
        send: emailSendMock,
        setLogger: vi.fn(),
    },
}));

vi.mock('../utils/language', () => ({
    detectLanguageCode: detectLanguageMock,
}));

vi.mock('../utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

vi.mock('../config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        resend: { fromName: 'Jawab24', fromEmail: 'info@jawab24.com', replyToEmail: '' },
    },
}));

import { runDailyLeadDigest, DIGEST_THRESHOLD, DIGEST_MAX_AGE_HOURS, ENGAGEMENT_WINDOW_DAYS } from '../services/leadDigest';
import { db } from '../db';

function makeLeadRow(workspaceId: string, i: number, overrides: Partial<{ phone: string; name: string; source: string; kb: string | null; createdAt: Date }> = {}) {
    return {
        leadId: `lead-${workspaceId}-${i}`,
        leadName: overrides.name ?? `Customer ${i}`,
        leadPhone: overrides.phone ?? `+9665550${String(i).padStart(4, '0')}`,
        leadSource: overrides.source ?? 'message',
        // Fresh by default (minutes ago, distinct per index): below-threshold
        // tests must not trip the age flush by accident.
        leadCreatedAt: overrides.createdAt ?? new Date(Date.now() - i * 60_000),
        pageKb: overrides.kb ?? 'We sell electronics and gadgets.',
        workspaceId,
    };
}

const recentDate = new Date();
const longAgo = new Date(Date.now() - (ENGAGEMENT_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1000);

const ownerSubActive = [{ ownerUserId: 'owner-1', subStatus: 'active' }];
const ownerSubCanceled = [{ ownerUserId: 'owner-1', subStatus: 'canceled' }];

const ownerRecipient = { userId: 'owner-1', email: 'owner@example.com', lastSeenAt: recentDate, leadDigestMutedAt: null };
const adminRecipient = { userId: 'admin-1', email: 'admin@example.com', lastSeenAt: recentDate, leadDigestMutedAt: null };

function audits() {
    return insertValuesMock.mock.calls.map(call => call[0] as Record<string, unknown>);
}

describe('runDailyLeadDigest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        detectLanguageMock.mockReturnValue('en');
        emailSendMock.mockImplementation(() => Promise.resolve({ success: true, id: 'resend-123', emailSendId: 'email-send-uuid-1' }));
        joinQueryRows.value = [];
        ownerSubQueue.value = [];
        recipientsQueue.value = [];
        (db as unknown as { __resetSelectIndex: () => void }).__resetSelectIndex();
    });

    it('does not send or stamp when workspace is below threshold and all leads are fresh', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD - 1 }, (_, i) => makeLeadRow('ws-1', i));

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).not.toHaveBeenCalled();
        expect(insertValuesMock).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
        expect(result.sent).toBe(0);
    });

    it('age flush: sends below threshold once the oldest unsent lead exceeds DIGEST_MAX_AGE_HOURS', async () => {
        const stale = new Date(Date.now() - (DIGEST_MAX_AGE_HOURS + 1) * 60 * 60 * 1000);
        joinQueryRows.value = [makeLeadRow('ws-1', 0, { createdAt: stale })];
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(updateSetMock).toHaveBeenCalled(); // stamped
        expect(result.sent).toBe(1);
        expect(result.skipped).toBe(0);
    });

    it('age flush keys on the OLDEST lead even when newer leads exist', async () => {
        const stale = new Date(Date.now() - (DIGEST_MAX_AGE_HOURS + 1) * 60 * 60 * 1000);
        joinQueryRows.value = [
            makeLeadRow('ws-1', 0), // fresh
            makeLeadRow('ws-1', 1, { createdAt: stale }),
            makeLeadRow('ws-1', 2), // fresh
        ];
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(result.sent).toBe(1);
        // The whole batch rides the flush: all three stamped together.
        expect(updateWhereMock).toHaveBeenCalledTimes(1);
    });

    // The volume threshold used to bound daily send volume; the age trigger
    // removed that bound, so age-only sends must be countable rather than
    // inferred from logs (they ARE the delta in send volume).
    it('counts an age-only send in result.ageFlushed', async () => {
        const stale = new Date(Date.now() - (DIGEST_MAX_AGE_HOURS + 1) * 60 * 60 * 1000);
        joinQueryRows.value = [makeLeadRow('ws-1', 0, { createdAt: stale })];
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];

        const result = await runDailyLeadDigest();

        expect(result.ageFlushed).toBe(1);
    });

    it('does NOT count a volume-triggered send as an age flush', async () => {
        // At/over threshold the digest would have fired anyway — not new volume.
        const stale = new Date(Date.now() - (DIGEST_MAX_AGE_HOURS + 1) * 60 * 60 * 1000);
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) =>
            makeLeadRow('ws-1', i, i === 0 ? { createdAt: stale } : {}));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];

        const result = await runDailyLeadDigest();

        expect(result.sent).toBe(1);
        expect(result.ageFlushed).toBe(0);
    });

    it('age flush does NOT fire for a lead younger than the max age', async () => {
        const nearlyStale = new Date(Date.now() - (DIGEST_MAX_AGE_HOURS - 1) * 60 * 60 * 1000);
        joinQueryRows.value = [makeLeadRow('ws-1', 0, { createdAt: nearlyStale })];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
    });

    it('fans out to owner + admins when all gates pass', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient, adminRecipient]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(2);
        const recipientsEmailed = emailSendMock.mock.calls.map(c => c[0].to).sort();
        expect(recipientsEmailed).toEqual(['admin@example.com', 'owner@example.com']);
        expect(updateSetMock).toHaveBeenCalledTimes(1); // stamp once after fan-out
        const sentRows = audits().filter(a => a.status === 'sent');
        expect(sentRows).toHaveLength(2);
        expect(sentRows.every(r => r.workspaceId === 'ws-1')).toBe(true);
        expect(result.sent).toBe(2);
    });

    it('skips workspace when owner has no active subscription', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubCanceled];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).toHaveBeenCalledTimes(1); // stamp so they don't pile up
        expect(audits()[0].status).toBe('skipped_no_subscription');
        expect(audits()[0].workspaceId).toBe('ws-1');
        expect(result.skipped).toBe(1);
    });

    it('skips workspace when no owner row exists', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [[]]; // empty

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(audits()[0].status).toBe('skipped_no_subscription');
        expect(result.skipped).toBe(1);
    });

    it('per-recipient: skips muted admin but still sends to owner', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubActive];
        const mutedAdmin = { ...adminRecipient, leadDigestMutedAt: new Date() };
        recipientsQueue.value = [[ownerRecipient, mutedAdmin]];

        await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(emailSendMock.mock.calls[0][0].to).toBe('owner@example.com');
        const mutedAudit = audits().find(a => a.status === 'skipped_muted');
        expect(mutedAudit?.userId).toBe('admin-1');
        expect(updateSetMock).toHaveBeenCalledTimes(1); // owner sent → stamp
    });

    it('per-recipient: skips admin without email, audits per-recipient', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient, { ...adminRecipient, email: null }]];

        await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1); // only owner
        const noEmailAudit = audits().find(a => a.status === 'skipped_no_email');
        expect(noEmailAudit?.userId).toBe('admin-1');
    });

    it('per-recipient: skips abandoned admin (lastSeenAt outside window)', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient, { ...adminRecipient, lastSeenAt: longAgo }]];

        await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        const abandonedAudit = audits().find(a => a.status === 'skipped_abandoned');
        expect(abandonedAudit?.userId).toBe('admin-1');
    });

    it('does NOT stamp when ALL recipients fail with transient errors (retry tomorrow)', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];
        emailSendMock.mockResolvedValueOnce({ success: false, error: 'Resend API down', emailSendId: 'email-send-uuid-failed' });

        const result = await runDailyLeadDigest();

        expect(updateSetMock).not.toHaveBeenCalled();
        const audit = audits()[0];
        expect(audit.status).toBe('failed');
        expect(audit.errorMessage).toBe('Resend API down');
        expect(result.errors).toBe(1);
    });

    it('STAMPS when at least one recipient sent successfully even if a sibling failed', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient, adminRecipient]];
        // owner fails, admin succeeds
        emailSendMock
            .mockResolvedValueOnce({ success: false, error: 'transient', emailSendId: 'fail-1' })
            .mockResolvedValueOnce({ success: true, id: 'resend-456', emailSendId: 'ok-1' });

        const result = await runDailyLeadDigest();

        expect(updateSetMock).toHaveBeenCalledTimes(1); // sibling success → stamp
        expect(result.sent).toBe(1);
        expect(result.errors).toBe(1);
    });

    it('STAMPS when every recipient is terminal-skipped (all muted) — prevents pile-up', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i));
        ownerSubQueue.value = [ownerSubActive];
        const mutedOwner = { ...ownerRecipient, leadDigestMutedAt: new Date() };
        const mutedAdmin = { ...adminRecipient, leadDigestMutedAt: new Date() };
        recipientsQueue.value = [[mutedOwner, mutedAdmin]];

        await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).toHaveBeenCalledTimes(1); // all-terminal → stamp
        expect(audits().every(a => a.status === 'skipped_muted')).toBe(true);
    });

    it('uses Arabic subject when KB language is detected as ar', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-1', i, { kb: 'نحن نبيع الإلكترونيات' }));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];
        detectLanguageMock.mockReturnValueOnce('ar');

        await runDailyLeadDigest();

        // Assert the LANGUAGE, not a copy substring: the previous form matched
        // «محتمل» from the old wording, so a copy edit broke a test about
        // language selection. Arabic script + no English words is the invariant.
        const subject: string = emailSendMock.mock.calls[0][0].subject;
        expect(subject).toMatch(/[؀-ۿ]/);
        expect(subject).not.toMatch(/You have/);
    });

    it('processes two workspaces independently — one sent, one below threshold', async () => {
        const rowsA = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-A', i));
        const rowsB = Array.from({ length: 3 }, (_, i) => makeLeadRow('ws-B', i));
        joinQueryRows.value = [...rowsA, ...rowsB];
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(result.processed).toBe(2);
        expect(result.sent).toBe(1);
    });

    it('records workspaceId on every audit row', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('ws-xyz', i));
        ownerSubQueue.value = [ownerSubActive];
        recipientsQueue.value = [[ownerRecipient]];

        await runDailyLeadDigest();

        expect(audits()[0].workspaceId).toBe('ws-xyz');
    });
});
