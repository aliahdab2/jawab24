import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `emailService.send` is shared infrastructure — every email we send (lead
 * digests, trial reminders, invites, page-reconnect alerts) goes through it.
 * Adding cc/bcc/attachments is only safe if an unused field is provably INERT,
 * so the first group of tests asserts the exact Resend request body rather than
 * just "it still works".
 */

vi.mock('../config', () => ({
    config: {
        resend: { apiKey: 'test-key', fromName: 'Jawab24', fromEmail: 'info@jawab24.com' },
    },
}));

const { mockInsertValues } = vi.hoisted(() => ({ mockInsertValues: vi.fn() }));

vi.mock('../db', () => ({
    db: {
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: mockInsertValues,
            }),
        }),
    },
}));

vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { emailService } from '../services/email';
import {
    SendMerchantEmailSchema,
    base64ByteLength,
    MAX_EMAIL_ATTACHMENT_BYTES,
    MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES,
} from '../utils/validation';

const fetchMock = vi.fn();

/** Base64 for a string of `n` bytes — used to build oversize payloads cheaply. */
function base64OfBytes(n: number): string {
    return Buffer.alloc(n, 0x41).toString('base64');
}

function lastRequestBody(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return JSON.parse((init as RequestInit).body as string);
}

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'resend-1' }),
    });
    mockInsertValues.mockReset().mockResolvedValue([{ id: 'es-1' }]);
    // NODE_ENV must not be 'development' or send() short-circuits before fetch.
    process.env.NODE_ENV = 'test';
});

describe('emailService.send — shared transport stays inert for existing callers', () => {
    const base = {
        to: 'merchant@example.com',
        subject: 'Subject',
        html: '<p>Body</p>',
        type: 'lead_digest' as const,
    };

    it('omits cc, bcc and attachments keys entirely when not supplied', async () => {
        await emailService.send(base);

        const body = lastRequestBody();
        expect(Object.keys(body).sort()).toEqual(['from', 'html', 'subject', 'to']);
        expect('cc' in body).toBe(false);
        expect('bcc' in body).toBe(false);
        expect('attachments' in body).toBe(false);
    });

    it('omits the keys when supplied but EMPTY (an empty list is not a recipient list)', async () => {
        await emailService.send({ ...base, cc: [], bcc: [], attachments: [] });

        const body = lastRequestBody();
        expect(Object.keys(body).sort()).toEqual(['from', 'html', 'subject', 'to']);
    });

    it('sends cc, bcc and attachments through when present', async () => {
        await emailService.send({
            ...base,
            cc: ['a@x.com', 'b@x.com'],
            bcc: ['hidden@x.com'],
            attachments: [{ filename: 'invoice.pdf', content: 'QUFB' }],
        });

        const body = lastRequestBody();
        expect(body.cc).toEqual(['a@x.com', 'b@x.com']);
        expect(body.bcc).toEqual(['hidden@x.com']);
        expect(body.attachments).toEqual([{ filename: 'invoice.pdf', content: 'QUFB' }]);
        // The original fields must be untouched by the addition.
        expect(body.to).toEqual(['merchant@example.com']);
        expect(body.subject).toBe('Subject');
    });
});

describe('base64ByteLength', () => {
    it.each([0, 1, 2, 3, 4, 100, 1024])('matches Buffer length for %i bytes', (n) => {
        const b64 = base64OfBytes(n);
        expect(base64ByteLength(b64)).toBe(Buffer.from(b64, 'base64').length);
    });
});

describe('SendMerchantEmailSchema', () => {
    const valid = { subject: 'Hello', body: 'Body text' };

    it('accepts a bare subject + body (no new fields required)', () => {
        expect(SendMerchantEmailSchema.safeParse(valid).success).toBe(true);
    });

    it('accepts valid cc/bcc and a PDF attachment', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            cc: ['info@jawab24.com'],
            bcc: ['rep@example.com'],
            attachments: [{ filename: 'invoice.pdf', content: base64OfBytes(1024) }],
        });
        expect(parsed.success).toBe(true);
    });

    it('rejects a malformed cc address', () => {
        const parsed = SendMerchantEmailSchema.safeParse({ ...valid, cc: ['not-an-email'] });
        expect(parsed.success).toBe(false);
    });

    it('rejects more than five cc addresses', () => {
        const cc = Array.from({ length: 6 }, (_, i) => `user${i}@x.com`);
        expect(SendMerchantEmailSchema.safeParse({ ...valid, cc }).success).toBe(false);
    });

    it('rejects a data: URI prefix — the most likely caller mistake', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: 'invoice.pdf', content: `data:application/pdf;base64,${base64OfBytes(16)}` }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects a disallowed file type', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: 'payload.exe', content: base64OfBytes(16) }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects a filename containing a path', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: '../../etc/passwd.pdf', content: base64OfBytes(16) }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects content that is not valid base64', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: 'invoice.pdf', content: 'not base64!!' }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects a single attachment over the per-file cap', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: 'big.pdf', content: base64OfBytes(MAX_EMAIL_ATTACHMENT_BYTES + 1024) }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects attachments that individually fit but together exceed the total cap', () => {
        // Two files under the per-file cap whose sum is over the total cap —
        // the case a per-file check alone would let through.
        const half = Math.floor(MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES / 2) + 1024;
        expect(half).toBeLessThanOrEqual(MAX_EMAIL_ATTACHMENT_BYTES);
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [
                { filename: 'a.pdf', content: base64OfBytes(half) },
                { filename: 'b.pdf', content: base64OfBytes(half) },
            ],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects more than three attachments', () => {
        const attachments = Array.from({ length: 4 }, (_, i) => ({
            filename: `f${i}.pdf`,
            content: base64OfBytes(16),
        }));
        expect(SendMerchantEmailSchema.safeParse({ ...valid, attachments }).success).toBe(false);
    });
});
