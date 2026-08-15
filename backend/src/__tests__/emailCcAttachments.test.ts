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
import { SendMerchantEmailSchema, base64ByteLength } from '../utils/validation';
import { MAX_EMAIL_ATTACHMENT_BYTES, MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES } from '@jawab24/shared';

const fetchMock = vi.fn();

/** Base64 for a string of `n` bytes — used to build oversize payloads cheaply. */
function base64OfBytes(n: number): string {
    return Buffer.alloc(n, 0x41).toString('base64');
}

/** Base64 of `n` bytes that begin with a genuine %PDF- signature. */
function pdfBase64OfBytes(n: number): string {
    const buf = Buffer.alloc(Math.max(n, 5), 0x41);
    buf.write('%PDF-', 0, 'ascii');
    return buf.toString('base64');
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

    it('translates contentType to Resend snake_case content_type, omitting it when absent', async () => {
        await emailService.send({
            ...base,
            attachments: [
                { filename: 'invoice.pdf', content: 'QUFB', contentType: 'application/pdf' },
                { filename: 'proof.png', content: 'QUFB' },
            ],
        });

        const body = lastRequestBody();
        expect(body.attachments).toEqual([
            { filename: 'invoice.pdf', content: 'QUFB', content_type: 'application/pdf' },
            { filename: 'proof.png', content: 'QUFB' },
        ]);
        // camelCase must never leak onto the wire.
        expect(JSON.stringify(body)).not.toContain('contentType');
    });

    it('sends no Idempotency-Key header when the payload has none — existing callers unchanged', async () => {
        await emailService.send(base);

        const [, init] = fetchMock.mock.calls[0];
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type']);
    });

    it('forwards idempotencyKey as the Idempotency-Key header when present', async () => {
        await emailService.send({ ...base, idempotencyKey: 'compose-1234-abcd' });

        const [, init] = fetchMock.mock.calls[0];
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['Idempotency-Key']).toBe('compose-1234-abcd');
    });

    it('refuses attachments over the provider ceiling BEFORE the fetch, as a failed attempt', async () => {
        const huge = 'A'.repeat(31 * 1024 * 1024);
        const result = await emailService.send({ ...base, attachments: [{ filename: 'huge.pdf', content: huge }] });

        expect(result.success).toBe(false);
        expect(result.error).toContain('provider ceiling');
        expect(fetchMock).not.toHaveBeenCalled();
        // The refusal is still recorded in email_sends as a failed attempt.
        expect(mockInsertValues).toHaveBeenCalled();
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

    it('accepts valid cc/bcc and a genuine PDF attachment', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            cc: ['info@jawab24.com'],
            bcc: ['rep@example.com'],
            attachments: [{ filename: 'invoice.pdf', content: pdfBase64OfBytes(1024) }],
        });
        expect(parsed.success).toBe(true);
    });

    it('accepts genuine PNG and JPEG signatures under their extensions', () => {
        const png = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(64),
        ]).toString('base64');
        const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]).toString('base64');
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [
                { filename: 'proof.png', content: png },
                { filename: 'photo.jpg', content: jpg },
            ],
        });
        expect(parsed.success).toBe(true);
    });

    it('rejects content whose magic bytes do not match the extension (renamed payload)', () => {
        // 'MZ...' — a Windows executable header — renamed to .pdf.
        const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)]).toString('base64');
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: 'invoice.pdf', content: exe }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects a filename containing CRLF (MIME header injection surface)', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: 'inv\r\nX-Injected: yes.pdf', content: pdfBase64OfBytes(16) }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects a filename containing a NUL byte (jsonb audit-write poisoning)', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{ filename: 'inv\u0000null.pdf', content: pdfBase64OfBytes(16) }],
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects NUL bytes in subject and body (same audit-write poisoning class)', () => {
        expect(SendMerchantEmailSchema.safeParse({ subject: 'a\u0000b', body: 'ok' }).success).toBe(false);
        expect(SendMerchantEmailSchema.safeParse({ subject: 'ok', body: 'a\u0000b' }).success).toBe(false);
    });

    it('strips unknown attachment keys — a smuggled Resend `path` (server-side URL fetch) never survives parsing', () => {
        const parsed = SendMerchantEmailSchema.safeParse({
            ...valid,
            attachments: [{
                filename: 'invoice.pdf',
                content: pdfBase64OfBytes(16),
                path: 'https://evil.example/otherfile',
                contentType: 'text/html',
            }],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(Object.keys(parsed.data.attachments![0]).sort()).toEqual(['content', 'filename']);
        }
    });

    it('accepts a well-formed idempotencyKey and rejects a too-short one', () => {
        expect(SendMerchantEmailSchema.safeParse({ ...valid, idempotencyKey: 'a3a44c86-0a51-4d8c' }).success).toBe(true);
        expect(SendMerchantEmailSchema.safeParse({ ...valid, idempotencyKey: 'short' }).success).toBe(false);
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
