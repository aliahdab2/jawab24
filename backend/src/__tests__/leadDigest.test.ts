/**
 * Tests: daily lead digest service.
 * Verifies threshold, subscription + engagement gates, idempotent stamping,
 * language detection, and audit-log writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    joinQueryRows,
    userQueryQueue,
    subQueryQueue,
    limitCounter,
    updateSetMock,
    updateWhereMock,
    insertValuesMock,
    emailSendMock,
    detectLanguageMock,
} = vi.hoisted(() => ({
    joinQueryRows: { value: [] as unknown[] },
    userQueryQueue: { value: [] as unknown[][] },
    subQueryQueue: { value: [] as unknown[][] },
    limitCounter: { value: 0 },
    updateSetMock: vi.fn(),
    updateWhereMock: vi.fn().mockResolvedValue(undefined),
    insertValuesMock: vi.fn().mockResolvedValue(undefined),
    emailSendMock: vi.fn(),
    detectLanguageMock: vi.fn().mockReturnValue('en'),
}));

vi.mock('../db', () => {
    // Service uses three SELECT shapes:
    //   1. join query      → terminal: .where(...)
    //   2. user lookup     → terminal: .limit(1), from(users)
    //   3. subscription    → terminal: .limit(1), from(subscriptions)
    // We distinguish #2 vs #3 by call order: user lookup comes first per user.
    const makeChain = () => {
        const chain: Record<string, unknown> = {};
        chain.from      = vi.fn(() => chain);
        chain.innerJoin = vi.fn(() => chain);
        chain.where     = vi.fn(() => Object.assign(
            Promise.resolve(joinQueryRows.value),
            chain,
        ));
        chain.limit     = vi.fn(() => {
            const isUserLookup = limitCounter.value % 2 === 0;
            limitCounter.value++;
            const queue = isUserLookup ? userQueryQueue.value : subQueryQueue.value;
            return Promise.resolve(queue.shift() ?? []);
        });
        return chain;
    };

    const updateChain = {
        set:   updateSetMock.mockReturnThis(),
        where: updateWhereMock,
    };

    const insertChain = {
        values: insertValuesMock,
    };

    return {
        db: {
            select: vi.fn(() => makeChain()),
            update: vi.fn(() => updateChain),
            insert: vi.fn(() => insertChain),
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

function makeLeadRow(userId: string, i: number, overrides: Partial<{ phone: string; name: string; source: string; kb: string | null }> = {}) {
    return {
        leadId: `lead-${userId}-${i}`,
        leadName: overrides.name ?? `Customer ${i}`,
        leadPhone: overrides.phone ?? `+9665550${String(i).padStart(4, '0')}`,
        leadSource: overrides.source ?? 'message',
        leadCreatedAt: new Date(2026, 3, 1, 10, i),
        pageKb: overrides.kb ?? 'We sell electronics and gadgets.',
        userId,
    };
}

const activeUser = { email: 'owner@example.com', lastSeenAt: new Date() };
const activeSub = { status: 'active' };

function audits() {
    return insertValuesMock.mock.calls.map(call => call[0] as Record<string, unknown>);
}

describe('runDailyLeadDigest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        detectLanguageMock.mockReturnValue('en');
        emailSendMock.mockResolvedValue({ success: true, id: 'resend-123', emailSendId: 'email-send-uuid-1' });
        joinQueryRows.value = [];
        userQueryQueue.value = [];
        subQueryQueue.value = [];
        limitCounter.value = 0;
    });

    it('does not send or stamp when user is below threshold', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD - 1 }, (_, i) => makeLeadRow('user-1', i));

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).not.toHaveBeenCalled();
        expect(insertValuesMock).not.toHaveBeenCalled(); // no audit row for below-threshold
        expect(result.skipped).toBe(1);
        expect(result.sent).toBe(0);
    });

    it('sends email, stamps leads, and writes a sent audit row when all gates pass', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[activeSub]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(emailSendMock.mock.calls[0][0].to).toBe('owner@example.com');
        expect(updateSetMock).toHaveBeenCalledTimes(1);
        const audit = audits()[0];
        expect(audit.status).toBe('sent');
        expect(audit.leadCount).toBe(10);
        expect(audit.resendEmailId).toBe('resend-123');
        expect(result.sent).toBe(1);
    });

    it('skipped_no_email: stamps leads and audits when user has no email', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[{ email: null, lastSeenAt: new Date() }]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).toHaveBeenCalledTimes(1); // stamped
        expect(audits()[0].status).toBe('skipped_no_email');
        expect(result.skipped).toBe(1);
    });

    it('skipped_no_subscription: stamps leads when subscription is canceled', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[{ status: 'canceled' }]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).toHaveBeenCalledTimes(1); // stamped so they don't pile up
        expect(audits()[0].status).toBe('skipped_no_subscription');
        expect(result.skipped).toBe(1);
    });

    it('skipped_no_subscription: when user has no subscription row at all', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[]]; // empty

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(audits()[0].status).toBe('skipped_no_subscription');
        expect(result.skipped).toBe(1);
    });

    it('skipped_abandoned: stamps and audits when last_seen_at is older than window', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        const longAgo = new Date(Date.now() - (ENGAGEMENT_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1000);
        userQueryQueue.value = [[{ email: 'owner@example.com', lastSeenAt: longAgo }]];
        subQueryQueue.value = [[activeSub]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).toHaveBeenCalledTimes(1);
        expect(audits()[0].status).toBe('skipped_abandoned');
        expect(result.skipped).toBe(1);
    });

    it('failed: does NOT stamp leads when email send fails; writes failed audit row', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[activeSub]];
        emailSendMock.mockResolvedValueOnce({ success: false, error: 'Resend API down', emailSendId: 'email-send-uuid-failed' });

        const result = await runDailyLeadDigest();

        expect(updateSetMock).not.toHaveBeenCalled();
        const audit = audits()[0];
        expect(audit.status).toBe('failed');
        expect(audit.errorMessage).toBe('Resend API down');
        expect(audit.emailSendId).toBe('email-send-uuid-failed');
        expect(result.errors).toBe(1);
    });

    it('uses Arabic subject when KB language is detected as ar', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i, { kb: 'نحن نبيع الإلكترونيات' }));
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[activeSub]];
        detectLanguageMock.mockReturnValueOnce('ar');

        await runDailyLeadDigest();

        expect(emailSendMock.mock.calls[0][0].subject).toMatch(/محتمل/);
    });

    it('passes type=lead_digest and userId to emailService for cross-email auditability', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[activeSub]];

        await runDailyLeadDigest();

        const sendCall = emailSendMock.mock.calls[0][0];
        expect(sendCall.type).toBe('lead_digest');
        expect(sendCall.userId).toBe('user-1');
    });

    it('stores the emailSendId returned by emailService on the sent audit row (links digest row to email body)', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[activeSub]];

        await runDailyLeadDigest();

        const audit = audits()[0];
        expect(audit.status).toBe('sent');
        expect(audit.emailSendId).toBe('email-send-uuid-1');
    });

    it('does not store an emailSendId on skipped rows (nothing was sent)', async () => {
        joinQueryRows.value = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        userQueryQueue.value = [[{ email: null, lastSeenAt: new Date() }]];

        await runDailyLeadDigest();

        const audit = audits()[0];
        expect(audit.status).toBe('skipped_no_email');
        expect(audit.emailSendId).toBeNull();
    });

    it('processes two users independently — one sent, one below threshold', async () => {
        const rowsA = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-A', i));
        const rowsB = Array.from({ length: 3 }, (_, i) => makeLeadRow('user-B', i));
        joinQueryRows.value = [...rowsA, ...rowsB];
        userQueryQueue.value = [[activeUser]];
        subQueryQueue.value = [[activeSub]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(result.processed).toBe(2);
        expect(result.sent).toBe(1);
        expect(result.skipped).toBe(1);
    });
});
