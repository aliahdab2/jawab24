/**
 * Integration regression for the invoice number series.
 *
 * Swedish bookkeeping requires the series to be sequential and unbroken, and
 * that is a property of the DATABASE under concurrency — no unit test can prove
 * it. What is exercised here is the real allocator against a real Postgres:
 * the advisory lock, the max+1 read, the unique index, and the transaction
 * boundary that makes a failed render give its number back instead of burning
 * a hole in the sequence.
 *
 * The PDF renderer is stubbed. Chromium's presence is not what these assertions
 * are about, and requiring a browser binary would make the suite unrunnable on
 * a machine that has none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';

// Hoisted so the mock factory can reach it — vi.mock is lifted above imports.
const renderMock = vi.hoisted(() => vi.fn(async () => Buffer.from('%PDF-1.4 stub')));

vi.mock('../../src/services/invoicePdf', () => ({
    renderInvoicePdf: renderMock,
    // The factory must be EXHAUSTIVE: a missing export becomes `undefined` at
    // the call site and surfaces as an unrelated failure deep in the service.
    InvoiceRenderError: class InvoiceRenderError extends Error {},
}));

import './setup';
import { testDb, createTestUser } from './setup';
import { adminInvoicesService } from '../../src/services/admin/invoices';
import { formatInvoiceNumber } from '../../src/services/admin/invoices';

function draft(overrides: Record<string, unknown> = {}) {
    return {
        lang: 'en' as const,
        customerName: 'Acme Trading',
        lineDescription: 'Jawab24 — Starter',
        quantityLabel: '1 month',
        currency: 'USD',
        subtotalCents: 1500,
        vatCents: 0,
        ...overrides,
    };
}

describe('invoice numbering (integration)', () => {
    beforeEach(() => {
        renderMock.mockClear();
        renderMock.mockImplementation(async () => Buffer.from('%PDF-1.4 stub'));
    });

    it('allocates consecutive numbers within a series and year', async () => {
        const user = await createTestUser();
        const a = await adminInvoicesService.createInvoice(user.id, draft(), undefined);
        const b = await adminInvoicesService.createInvoice(user.id, draft(), undefined);
        const c = await adminInvoicesService.createInvoice(user.id, draft(), undefined);

        const seqs = [a, b, c].map((i) => Number(i.number.split('-').pop()));
        expect(seqs[1]).toBe(seqs[0] + 1);
        expect(seqs[2]).toBe(seqs[1] + 1);
    });

    it('zero-pads the printed number so the series reads as a series', () => {
        expect(formatInvoiceNumber('JW24', 2026, 7)).toBe('JW24-2026-007');
        expect(formatInvoiceNumber('JW24', 2026, 42)).toBe('JW24-2026-042');
        // Padding is a minimum, never a truncation.
        expect(formatInvoiceNumber('JW24', 2026, 1234)).toBe('JW24-2026-1234');
    });

    it('never issues the same number twice under concurrency', async () => {
        // The real risk: two admins clicking at once, both reading max(seq) and
        // both writing seq+1. The advisory lock is what prevents it — without
        // it, one of these either duplicates or dies on the unique index.
        const user = await createTestUser();
        const results = await Promise.all(
            Array.from({ length: 8 }, () => adminInvoicesService.createInvoice(user.id, draft(), undefined)),
        );
        const numbers = results.map((r) => r.number);
        expect(new Set(numbers).size).toBe(numbers.length);

        // And they form an unbroken run, not merely distinct values.
        const seqs = numbers.map((n) => Number(n.split('-').pop())).sort((x, y) => x - y);
        for (let i = 1; i < seqs.length; i += 1) {
            expect(seqs[i]).toBe(seqs[i - 1] + 1);
        }
    });

    it('gives the number back when the render fails — no gap, no orphan row', async () => {
        const user = await createTestUser();
        const before = await adminInvoicesService.createInvoice(user.id, draft(), undefined);
        const beforeSeq = Number(before.number.split('-').pop());

        renderMock.mockImplementationOnce(async () => { throw new Error('chromium exploded'); });
        await expect(adminInvoicesService.createInvoice(user.id, draft(), undefined)).rejects.toThrow();

        // The next successful issue takes the very next number: the failed
        // attempt consumed nothing, because allocation and render share one
        // transaction.
        const after = await adminInvoicesService.createInvoice(user.id, draft(), undefined);
        expect(Number(after.number.split('-').pop())).toBe(beforeSeq + 1);
    });

    it('archives the rendered bytes with a hash that matches them', async () => {
        const user = await createTestUser();
        const issued = await adminInvoicesService.createInvoice(user.id, draft(), undefined);
        const doc = await adminInvoicesService.getDocument(issued.id);

        expect(doc.number).toBe(issued.number);
        expect(doc.byteLength).toBe(issued.byteLength);
        // The hash we hand the merchant-email audit row must describe the bytes
        // we actually stored, or a later dispute cannot be settled.
        const { createHash } = await import('crypto');
        expect(createHash('sha256').update(doc.bytes).digest('hex')).toBe(issued.sha256);
    });

    it('refuses to be deleted out from under a user row', async () => {
        // `restrict`, not cascade: an invoice is a record we must keep, so a
        // user delete has to stop and make a human decide.
        const user = await createTestUser();
        await adminInvoicesService.createInvoice(user.id, draft(), undefined);
        await expect(
            testDb.execute(sql`DELETE FROM users WHERE id = ${user.id}`),
        ).rejects.toThrow();
    });

    it('keeps a voided invoice and its number in the register', async () => {
        const user = await createTestUser();
        const issued = await adminInvoicesService.createInvoice(user.id, draft(), undefined);
        await adminInvoicesService.voidInvoice(issued.id, 'Issued to the wrong customer', undefined);

        const rows = await testDb.execute<{ number: string; status: string; void_reason: string }>(
            sql`SELECT number, status, void_reason FROM invoices WHERE id = ${issued.id}`,
        );
        const row = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
        expect((row as Record<string, string>[])[0].status).toBe('void');
        expect((row as Record<string, string>[])[0].number).toBe(issued.number);
    });
});
