/**
 * Tests: daily lead digest service.
 * Verifies:
 *   - per-workspace threshold + grouping
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
        resend: { fromName: 'Jawab24' },
    },
}));

import { runDailyLeadDigest, DIGEST_THRESHOLD, ENGAGEMENT_WINDOW_DAYS } from '../services/leadDigest';
import { db } from '../db';

function makeLeadRow(workspaceId: string, i: number, overrides: Partial<{ phone: string; name: string; source: string; kb: string | null }> = {}) {
    return {
        leadId: `lead-${workspaceId}-${i}`,
        leadName: overrides.name ?? `Customer ${i}`,
        leadPhone: overrides.phone ?? `+9665550${String(i).padStart(4, '0')}`,
        leadSource: overrides.source ?? 'message',
        leadCreatedAt: new Date(2026, 3, 1, 10, i),
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

    it('does not send or stamp when workspace is below threshold', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD - 1 }, (_, i) => makeLeadRow('ws-1', i));

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).not.toHaveBeenCalled();
        expect(insertValuesMock).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
        expect(result.sent).toBe(0);
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

        expect(emailSendMock.mock.calls[0][0].subject).toMatch(/محتمل/);
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
