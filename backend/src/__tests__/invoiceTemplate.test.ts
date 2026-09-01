/**
 * Tests: invoiceHtml + formatInvoiceMoney
 *
 * The document is the product here — nobody reviews an invoice's HTML before it
 * reaches a customer's accountant, so the properties that make it a valid,
 * unforgeable document are pinned rather than eyeballed.
 */

import { describe, it, expect } from 'vitest';
import { invoiceHtml, formatInvoiceMoney, type InvoiceView, type InvoiceSeller } from '../utils/invoiceTemplate';

const seller: InvoiceSeller = {
    displayName: 'Jawab24',
    legalName: 'Mohammad Ali Ahdab',
    legalForm: 'Enskild Näringsverksamhet',
    registrationNumber: '19810312-5335',
    addressLines: ['Bergavägen 15 A lgh 1002', '241 39 Eslöv', 'Sweden'],
    contactEmail: 'support@jawab24.com',
    website: 'jawab24.com',
};

function view(overrides: Partial<InvoiceView> = {}): InvoiceView {
    return {
        lang: 'ar',
        number: 'JW24-2026-002',
        issueDate: new Date('2026-09-01T09:44:00Z'),
        seller,
        customerName: 'MES',
        customerContact: 'Ahmad Tabbaa',
        customerEmail: 'a.tbbaa@mes-me.com',
        customerAddress: 'Syria',
        lineDescription: 'Jawab24 — Starter',
        lineDetail: 'Includes 1,500 replies',
        quantityLabel: '1 month',
        periodStart: new Date('2026-09-01T09:44:00Z'),
        periodEnd: new Date('2026-10-01T09:44:00Z'),
        currency: 'USD',
        subtotalCents: 1500,
        vatCents: 0,
        totalCents: 1500,
        vatNote: 'Outside the scope of Swedish VAT.',
        ...overrides,
    };
}

describe('formatInvoiceMoney', () => {
    it('renders cents as a two-decimal amount with its currency', () => {
        expect(formatInvoiceMoney(1500, 'USD')).toBe('15.00 USD');
        expect(formatInvoiceMoney(79000, 'usd')).toBe('790.00 USD');
    });

    it('keeps sub-dollar and zero amounts honest', () => {
        // A zero line is legitimate (a courtesy period) and must not print as
        // "0 USD" or empty — the reader needs to see it was priced at zero.
        expect(formatInvoiceMoney(0, 'USD')).toBe('0.00 USD');
        expect(formatInvoiceMoney(5, 'USD')).toBe('0.05 USD');
        expect(formatInvoiceMoney(99, 'USD')).toBe('0.99 USD');
    });

    it('groups thousands so a large figure cannot be misread', () => {
        // 79000000 cents is 790,000.00 — without grouping this reads as a
        // different order of magnitude at a glance.
        expect(formatInvoiceMoney(79_000_000, 'USD')).toBe('790,000.00 USD');
        expect(formatInvoiceMoney(100_000, 'USD')).toBe('1,000.00 USD');
    });

    it('never loses precision to floating point', () => {
        // The classic: 0.1 + 0.2 arithmetic on money. Integer cents in, string
        // out, no float ever touches it.
        expect(formatInvoiceMoney(1010, 'USD')).toBe('10.10 USD');
        expect(formatInvoiceMoney(2_099, 'USD')).toBe('20.99 USD');
    });
});

describe('invoiceHtml — direction and language', () => {
    it('renders Arabic right-to-left with Arabic labels', () => {
        const html = invoiceHtml(view({ lang: 'ar' }));
        expect(html).toContain('<html lang="ar" dir="rtl">');
        expect(html).toContain('فاتورة');
        expect(html).toContain('الإجمالي المستحق');
    });

    it('renders English left-to-right with English labels', () => {
        const html = invoiceHtml(view({ lang: 'en' }));
        expect(html).toContain('<html lang="en" dir="ltr">');
        expect(html).toContain('Total due');
        expect(html).not.toContain('الإجمالي المستحق');
    });

    it('flips the panel accent edge with the direction', () => {
        // A border pinned to `left` would sit on the wrong side of the Arabic
        // panel — the logical-property rule the whole product follows.
        expect(invoiceHtml(view({ lang: 'ar', paymentNote: 'x' }))).toContain('border-right: 3px solid');
        expect(invoiceHtml(view({ lang: 'en', paymentNote: 'x' }))).toContain('border-left: 3px solid');
    });

    it('prints Latin digits in Arabic dates, not Arabic-Indic', () => {
        // Deliberate deviation from every other merchant-facing surface: this
        // figure is keyed into bookkeeping software and matched to a bank
        // statement. If someone "fixes" formatInvoiceDate to use the shared
        // numeral locale, this fails.
        const html = invoiceHtml(view({ lang: 'ar' }));
        expect(html).toContain('2026');
        expect(html).not.toMatch(/[٠١٢٣٤٥٦٧٨٩]/);
    });
});

describe('invoiceHtml — the document is correct', () => {
    it('prints the number, the totals and the currency', () => {
        const html = invoiceHtml(view({ subtotalCents: 79_000, vatCents: 0, totalCents: 79_000 }));
        expect(html).toContain('JW24-2026-002');
        expect(html).toContain('790.00 USD');
    });

    it('computes the VAT percentage from the amounts, not from an assumption', () => {
        const zero = invoiceHtml(view({ subtotalCents: 1000, vatCents: 0, totalCents: 1000 }));
        expect(zero).toContain('(0%)');
        const vatted = invoiceHtml(view({ subtotalCents: 1000, vatCents: 250, totalCents: 1250 }));
        expect(vatted).toContain('(25%)');
    });

    it('does not divide by zero on a fully zero-rated invoice', () => {
        const html = invoiceHtml(view({ subtotalCents: 0, vatCents: 0, totalCents: 0 }));
        expect(html).toContain('(0%)');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('Infinity');
    });

    it('carries the registered identity even though the issuer shows as the trade name', () => {
        // The owner asked for "just Jawab24" as the issuer. That is what the
        // customer sees — but a Swedish invoice is invalid without the legal
        // name, org number and address, so they must survive as small print.
        const html = invoiceHtml(view());
        expect(html).toContain('Jawab24');
        expect(html).toContain('Mohammad Ali Ahdab');
        expect(html).toContain('19810312-5335');
        expect(html).toContain('Bergavägen 15 A lgh 1002');
    });

    it('omits the period line entirely when there is no period', () => {
        const html = invoiceHtml(view({ periodStart: null, periodEnd: null }));
        expect(html).not.toContain('فترة الاشتراك');
    });

    it('omits the payment panel when there is no payment note', () => {
        expect(invoiceHtml(view({ paymentNote: null }))).not.toContain('class="panel"');
        expect(invoiceHtml(view({ paymentNote: 'Bank transfer' }))).toContain('Bank transfer');
    });

    it('marks a preview as a draft so it cannot pass for an issued invoice', () => {
        const preview = invoiceHtml(view({ preview: true, lang: 'en' }));
        expect(preview).toContain('DRAFT — NOT ISSUED');
        expect(invoiceHtml(view({ preview: false, lang: 'en' }))).not.toContain('DRAFT');
    });
});

describe('invoiceHtml — untrusted input', () => {
    // Every one of these fields is admin-typed free text that is handed to a
    // browser engine. An unescaped value could reshape the document — including
    // its totals — which on a financial record is forgery, not a styling bug.
    it('escapes markup in the customer name', () => {
        const html = invoiceHtml(view({ customerName: '<script>alert(1)</script>' }));
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('escapes markup in the line description and detail', () => {
        const html = invoiceHtml(view({
            lineDescription: '</td><td>999.00 USD',
            lineDetail: '<img src=x onerror=1>',
        }));
        expect(html).not.toContain('</td><td>999.00 USD');
        expect(html).not.toContain('<img src=x');
    });

    it('escapes markup in the address, the payment note and the VAT note', () => {
        const html = invoiceHtml(view({
            customerAddress: '<b>bold</b>',
            paymentNote: '<b>pay</b>',
            vatNote: '<b>vat</b>',
        }));
        expect(html).not.toContain('<b>bold</b>');
        expect(html).not.toContain('<b>pay</b>');
        expect(html).not.toContain('<b>vat</b>');
    });

    it('escapes a quote-breaking logo URI rather than emitting a raw attribute', () => {
        const html = invoiceHtml(view({ logoDataUri: '" onload="alert(1)' }));
        expect(html).not.toContain('onload="alert(1)"');
    });
});
