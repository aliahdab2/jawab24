/**
 * Tests: daily lead digest service.
 * Verifies threshold gating, idempotent stamping, and language detection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { joinQueryRows, userQueryQueue, updateSetMock, updateWhereMock, emailSendMock, detectLanguageMock } = vi.hoisted(() => ({
    joinQueryRows: { value: [] as unknown[] },
    userQueryQueue: { value: [] as unknown[][] }, // shift()ed on each .limit() call
    updateSetMock: vi.fn(),
    updateWhereMock: vi.fn().mockResolvedValue(undefined),
    emailSendMock: vi.fn(),
    detectLanguageMock: vi.fn().mockReturnValue('en'),
}));

vi.mock('../db', () => {
    // The service issues two SELECT shapes:
    //   1. join query → terminal awaits `.where(...)`
    //   2. user lookup → terminal awaits `.limit(1)`
    // We return a chain whose `.where()` is awaitable AND chainable;
    // `.limit()` pulls from a separate queue.
    const makeChain = () => {
        const chain: Record<string, unknown> = {};
        chain.from      = vi.fn(() => chain);
        chain.innerJoin = vi.fn(() => chain);
        chain.where     = vi.fn(() => Object.assign(
            Promise.resolve(joinQueryRows.value),
            chain,
        ));
        chain.limit     = vi.fn(() => Promise.resolve(userQueryQueue.value.shift() ?? []));
        return chain;
    };

    const updateChain = {
        set:   updateSetMock.mockReturnThis(),
        where: updateWhereMock,
    };

    return {
        db: {
            select: vi.fn(() => makeChain()),
            update: vi.fn(() => updateChain),
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

import { runDailyLeadDigest, DIGEST_THRESHOLD } from '../services/leadDigest';

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

describe('runDailyLeadDigest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        detectLanguageMock.mockReturnValue('en');
        emailSendMock.mockResolvedValue({ success: true, id: 'email-1' });
    });

    it('does not send email when user has fewer than threshold leads', async () => {
        const joinRows = Array.from({ length: DIGEST_THRESHOLD - 1 }, (_, i) => makeLeadRow('user-1', i));
        // First select call returns join rows; user lookup never happens because we skip below threshold.
        joinQueryRows.value = joinRows;
        userQueryQueue.value = [];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).not.toHaveBeenCalled();
        expect(result.sent).toBe(0);
        expect(result.skipped).toBe(1);
    });

    it('sends one email and stamps all leads when threshold met', async () => {
        const joinRows = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        joinQueryRows.value = joinRows;
        userQueryQueue.value = [[{ email: 'owner@example.com' }]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        const sendArg = emailSendMock.mock.calls[0][0];
        expect(sendArg.to).toBe('owner@example.com');
        expect(sendArg.subject).toContain('10');
        expect(updateSetMock).toHaveBeenCalledTimes(1);
        expect(result.sent).toBe(1);
        expect(result.errors).toBe(0);
    });

    it('skips users with no email on file', async () => {
        const joinRows = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        joinQueryRows.value = joinRows;
        userQueryQueue.value = [[{ email: null }]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateSetMock).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
        expect(result.sent).toBe(0);
    });

    it('does not stamp leads if email send fails', async () => {
        const joinRows = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i));
        joinQueryRows.value = joinRows;
        userQueryQueue.value = [[{ email: 'owner@example.com' }]];
        emailSendMock.mockResolvedValueOnce({ success: false, error: 'Resend API down' });

        const result = await runDailyLeadDigest();

        expect(updateSetMock).not.toHaveBeenCalled();
        expect(result.errors).toBe(1);
        expect(result.sent).toBe(0);
    });

    it('uses Arabic subject when KB language is detected as ar', async () => {
        const joinRows = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-1', i, { kb: 'نحن نبيع الإلكترونيات' }));
        joinQueryRows.value = joinRows;
        userQueryQueue.value = [[{ email: 'owner@example.com' }]];
        detectLanguageMock.mockReturnValueOnce('ar');

        await runDailyLeadDigest();

        const subject = emailSendMock.mock.calls[0][0].subject;
        expect(subject).toMatch(/محتمل/);
    });

    it('processes multiple users independently — one above, one below threshold', async () => {
        const rowsA = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => makeLeadRow('user-A', i));
        const rowsB = Array.from({ length: 3 }, (_, i) => makeLeadRow('user-B', i));
        joinQueryRows.value = [...rowsA, ...rowsB];
        userQueryQueue.value = [[{ email: 'a@example.com' }]];

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(emailSendMock.mock.calls[0][0].to).toBe('a@example.com');
        expect(result.processed).toBe(2);
        expect(result.sent).toBe(1);
        expect(result.skipped).toBe(1);
    });
});
