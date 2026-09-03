/**
 * Tests: CreateInvoiceSchema / SendInvoiceSchema / VoidInvoiceSchema
 *
 * This is the layer that stands between an admin's typo and a financial
 * document in a customer's inbox. Each refusal below exists for a reason that
 * is stated in the test name; deleting a rule should fail here loudly.
 */

import { describe, it, expect } from 'vitest';
import { CreateInvoiceSchema, SendInvoiceSchema, VoidInvoiceSchema } from '../utils/validation';

const valid = {
    lang: 'ar' as const,
    customerName: 'MES',
    lineDescription: 'Jawab24 — Starter',
    quantityLabel: '1 month',
    currency: 'usd',
    subtotalCents: 1500,
    vatCents: 0,
};

describe('CreateInvoiceSchema', () => {
    it('accepts a minimal valid invoice and upper-cases the currency', () => {
        const r = CreateInvoiceSchema.safeParse(valid);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.currency).toBe('USD');
    });

    it('rejects a currency that is not a 3-letter code', () => {
        expect(CreateInvoiceSchema.safeParse({ ...valid, currency: 'DOLLAR' }).success).toBe(false);
        expect(CreateInvoiceSchema.safeParse({ ...valid, currency: 'US' }).success).toBe(false);
    });

    it('rejects a negative amount — a refund is a credit note, not an invoice', () => {
        expect(CreateInvoiceSchema.safeParse({ ...valid, subtotalCents: -100 }).success).toBe(false);
        expect(CreateInvoiceSchema.safeParse({ ...valid, vatCents: -1 }).success).toBe(false);
    });

    it('accepts a zero-rated line — a courtesy period is legitimate', () => {
        expect(CreateInvoiceSchema.safeParse({ ...valid, subtotalCents: 0 }).success).toBe(true);
    });

    it('rejects fractional cents', () => {
        // 15.005 USD is not an amount anyone can pay, and it would break the
        // total = subtotal + vat CHECK in the database.
        expect(CreateInvoiceSchema.safeParse({ ...valid, subtotalCents: 1500.5 }).success).toBe(false);
    });

    it('rejects an amount above the typo ceiling', () => {
        // A slipped decimal is the realistic failure, not a million-dollar sale.
        expect(CreateInvoiceSchema.safeParse({ ...valid, subtotalCents: 100_000_001 }).success).toBe(false);
        expect(CreateInvoiceSchema.safeParse({ ...valid, subtotalCents: 100_000_000 }).success).toBe(true);
    });

    it('rejects a half-specified billing period', () => {
        // A period with only one end prints as a nonsense line, and the DB
        // CHECK would refuse it after the PDF had already been rendered.
        const start = new Date('2026-09-01').toISOString();
        expect(CreateInvoiceSchema.safeParse({ ...valid, periodStart: start }).success).toBe(false);
        expect(CreateInvoiceSchema.safeParse({ ...valid, periodEnd: start }).success).toBe(false);
    });

    it('rejects a period that ends before it starts', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...valid,
            periodStart: new Date('2026-10-01').toISOString(),
            periodEnd: new Date('2026-09-01').toISOString(),
        });
        expect(r.success).toBe(false);
    });

    it('accepts a well-formed period and coerces it to Dates', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...valid,
            periodStart: new Date('2026-09-01').toISOString(),
            periodEnd: new Date('2026-10-01').toISOString(),
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.periodStart).toBeInstanceOf(Date);
            expect(r.data.periodEnd).toBeInstanceOf(Date);
        }
    });

    it('requires a customer name — an invoice must say who it is for', () => {
        expect(CreateInvoiceSchema.safeParse({ ...valid, customerName: '   ' }).success).toBe(false);
    });

    it('rejects an unknown language', () => {
        expect(CreateInvoiceSchema.safeParse({ ...valid, lang: 'fr' }).success).toBe(false);
    });

    it('rejects a malformed customer email rather than sending into the void', () => {
        expect(CreateInvoiceSchema.safeParse({ ...valid, customerEmail: 'not-an-email' }).success).toBe(false);
    });
});

describe('SendInvoiceSchema', () => {
    it('has no attachment field — the server attaches the archived PDF by id', () => {
        // If a caller could supply the file, "the invoice we sent" and "the
        // invoice we stored" could differ, which is the one guarantee the
        // register exists to provide.
        const r = SendInvoiceSchema.safeParse({
            subject: 'Invoice', body: 'Attached.',
            attachments: [{ filename: 'evil.pdf', content: 'JVBERi0=' }],
        });
        expect(r.success).toBe(true);
        if (r.success) expect('attachments' in r.data).toBe(false);
    });

    it('rejects control characters in the subject', () => {
        expect(SendInvoiceSchema.safeParse({ subject: 'Hi\u0000there', body: 'x' }).success).toBe(false);
    });

    it('rejects an invalid CC address', () => {
        expect(SendInvoiceSchema.safeParse({ subject: 's', body: 'b', cc: ['nope'] }).success).toBe(false);
    });
});

describe('VoidInvoiceSchema', () => {
    it('requires a substantive reason', () => {
        // An unexplained void is an unexplained hole in the register at audit.
        expect(VoidInvoiceSchema.safeParse({ reason: '' }).success).toBe(false);
        expect(VoidInvoiceSchema.safeParse({ reason: ' x ' }).success).toBe(false);
        expect(VoidInvoiceSchema.safeParse({ reason: 'Issued to the wrong customer' }).success).toBe(true);
    });
});
