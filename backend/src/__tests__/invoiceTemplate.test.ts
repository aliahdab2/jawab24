/**
 * Tests: invoiceHtml + formatInvoiceMoney
 *
 * The document is the product here — nobody reviews an invoice's HTML before it
 * reaches a customer's accountant, so the properties that make it a valid,
 * unforgeable document are pinned rather than eyeballed.
 *
 * Several assertions below pin the SHAPE of the house invoice (JW24-2026-0001,
 * issued by hand 2026-08-08) rather than a preference: the absent legal block,
 * the absent VAT row, and the Levantine month names were all corrections to an
 * earlier draft. They are here so the draft cannot creep back.
 */

import { describe, it, expect } from 'vitest';
import { invoiceHtml, formatInvoiceMoney, type InvoiceView, type InvoiceSeller } from '../utils/invoiceTemplate';

const seller: InvoiceSeller = {
    displayName: 'جواب24',
    website: 'jawab24.com',
    contactEmail: 'info@jawab24.com',
};

function view(overrides: Partial<InvoiceView> = {}): InvoiceView {
    return {
        lang: 'ar',
        number: 'JW24-2026-0002',
        issueDate: new Date('2026-09-01T09:44:00Z'),
        seller,
        customerName: 'ام. اي. اس',
        customerEmail: 'a.tbbaa@mes-me.com',
        customerAddress: 'الجمهورية العربية السورية',
        lineDescription: 'اشتراك شهري — باقة المبتدئ',
        lineDetail: 'ألف وخمس مئة ردّ ذكي شهرياً',
        quantityLabel: '1',
        periodStart: new Date('2026-09-01T09:44:00Z'),
        periodEnd: new Date('2026-10-01T09:44:00Z'),
        currency: 'USD',
        subtotalCents: 1500,
        vatCents: 0,
        totalCents: 1500,
        ...overrides,
    };
}

describe('formatInvoiceMoney', () => {
    it('renders cents as a two-decimal amount with its currency', () => {
        expect(formatInvoiceMoney(1500, 'USD')).toBe('15.00 USD');
        expect(formatInvoiceMoney(79000, 'usd')).toBe('790.00 USD');
    });

    it('keeps sub-dollar and zero amounts honest', () => {
        expect(formatInvoiceMoney(0, 'USD')).toBe('0.00 USD');
        expect(formatInvoiceMoney(5, 'USD')).toBe('0.05 USD');
        expect(formatInvoiceMoney(99, 'USD')).toBe('0.99 USD');
    });

    it('groups thousands so a large figure cannot be misread', () => {
        expect(formatInvoiceMoney(79_000_000, 'USD')).toBe('790,000.00 USD');
        expect(formatInvoiceMoney(100_000, 'USD')).toBe('1,000.00 USD');
    });

    it('never loses precision to floating point', () => {
        expect(formatInvoiceMoney(1010, 'USD')).toBe('10.10 USD');
        expect(formatInvoiceMoney(2_099, 'USD')).toBe('20.99 USD');
    });
});

describe('invoiceHtml — the house shape', () => {
    it('prints ONLY name, site and email as the supplier block', () => {
        // The correction that produced this template: an earlier draft printed
        // the legal name, the org number and the registered address. The house
        // invoice prints none of it, anywhere — not even as footer small print.
        const html = invoiceHtml(view());
        expect(html).toContain('جواب24');
        expect(html).toContain('jawab24.com');
        expect(html).toContain('info@jawab24.com');
        expect(html).not.toContain('Ahdab');
        expect(html).not.toContain('19810312');
        expect(html).not.toContain('Bergavägen');
        expect(html).not.toContain('Enskild');
        expect(html).not.toMatch(/Org\.?\s*nr/i);
    });

    it('omits the VAT row entirely when there is no VAT', () => {
        // Our customers are outside the EU. A "VAT 0%" line plus a paragraph
        // explaining why is noise on every invoice we actually send.
        const html = invoiceHtml(view({ vatCents: 0, vatNote: 'should not appear' }));
        expect(html).not.toContain('ضريبة القيمة المضافة');
        expect(html).not.toContain('should not appear');
        expect(html).toContain('المجموع');
        expect(html).toContain('الإجمالي المستحق');
    });

    it('renders the VAT row when VAT is actually charged', () => {
        const html = invoiceHtml(view({
            subtotalCents: 1000, vatCents: 250, totalCents: 1250, vatNote: 'Reverse charge',
        }));
        expect(html).toContain('ضريبة القيمة المضافة');
        expect(html).toContain('2.50 USD');
        expect(html).toContain('Reverse charge');
    });

    it('uses Levantine month names in Arabic, with Latin digits', () => {
        // «1 أيلول 2026», not «1 سبتمبر 2026» and not «١ أيلول ٢٠٢٦». Bare `ar`
        // gives the wrong month name AND Arabic-Indic digits; both are wrong for
        // this document and for these customers.
        const html = invoiceHtml(view({ lang: 'ar' }));
        expect(html).toContain('أيلول');
        expect(html).not.toContain('سبتمبر');
        expect(html).not.toMatch(/[٠١٢٣٤٥٦٧٨٩]/);
    });

    it('joins the period and the detail with the house separator', () => {
        const html = invoiceHtml(view());
        expect(html).toContain('من 1 أيلول 2026 حتى 1 تشرين الأول 2026 · ألف وخمس مئة ردّ ذكي شهرياً');
    });

    it('omits the payment-method box when the method is unknown', () => {
        // An empty box on a financial document reads as missing information,
        // not as "not applicable".
        expect(invoiceHtml(view({ paymentMethod: null }))).not.toContain('طريقة السداد');
        expect(invoiceHtml(view({ paymentMethod: 'حوالة مصرفية' }))).toContain('حوالة مصرفية');
    });

    it('makes no claim about payment unless paidAt is set', () => {
        const unpaid = invoiceHtml(view({ paidAt: null }));
        expect(unpaid).not.toContain('مدفوعة');
        expect(unpaid).not.toContain('تمّ استلام');

        const paid = invoiceHtml(view({ paidAt: new Date('2026-09-01T09:44:00Z') }));
        expect(paid).toContain('مدفوعة');
        expect(paid).toContain('تمّ استلام كامل قيمة الفاتورة بتاريخ 1 أيلول 2026.');
    });

    it('omits the notes section when there are no notes', () => {
        expect(invoiceHtml(view({ notes: null }))).not.toContain('ملاحظات');
        expect(invoiceHtml(view({ notes: 'ملاحظة تجريبية' }))).toContain('ملاحظة تجريبية');
    });

    it('carries the thank-you footer and the site, and no small print', () => {
        const html = invoiceHtml(view());
        expect(html).toContain('شكراً لثقتكم');
        expect(html).not.toContain('19810312');
    });
});

describe('invoiceHtml — direction and language', () => {
    it('renders Arabic right-to-left with Arabic labels', () => {
        const html = invoiceHtml(view({ lang: 'ar' }));
        expect(html).toContain('<html lang="ar" dir="rtl">');
        expect(html).toContain('المورّد');
        expect(html).toContain('العميل');
        expect(html).toContain('الإجمالي المستحق');
    });

    it('renders English left-to-right with English labels', () => {
        const html = invoiceHtml(view({ lang: 'en' }));
        expect(html).toContain('<html lang="en" dir="ltr">');
        expect(html).toContain('Supplier');
        expect(html).toContain('Total due');
        expect(html).not.toContain('الإجمالي المستحق');
    });

    it('keeps the Latin INVOICE heading in both languages', () => {
        // The house invoice leads with "INVOICE" and puts «فاتورة» beneath it.
        expect(invoiceHtml(view({ lang: 'ar' }))).toContain('INVOICE');
        expect(invoiceHtml(view({ lang: 'en' }))).toContain('INVOICE');
    });

    it('uses day-first dates in English', () => {
        // Bare `en` gives "September 1, 2026", which reads as an error to these
        // customers and disagrees with the Arabic side's shape.
        const html = invoiceHtml(view({ lang: 'en' }));
        expect(html).toContain('1 September 2026');
        expect(html).not.toContain('September 1, 2026');
    });

    it('flips the table header corners and text alignment with the direction', () => {
        // Logical properties, so one stylesheet serves both directions.
        expect(invoiceHtml(view({ lang: 'ar' }))).toContain('text-align: right');
        expect(invoiceHtml(view({ lang: 'en' }))).toContain('text-align: left');
    });
});

describe('invoiceHtml — totals', () => {
    it('prints the number and the totals', () => {
        const html = invoiceHtml(view({ subtotalCents: 79_000, vatCents: 0, totalCents: 79_000 }));
        expect(html).toContain('JW24-2026-0002');
        expect(html).toContain('790.00 USD');
    });

    it('handles a fully zero-rated invoice without NaN', () => {
        const html = invoiceHtml(view({ subtotalCents: 0, vatCents: 0, totalCents: 0 }));
        expect(html).toContain('0.00 USD');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('Infinity');
    });

    it('omits the detail line when there is neither a period nor a detail', () => {
        const html = invoiceHtml(view({ periodStart: null, periodEnd: null, lineDetail: null }));
        expect(html).not.toContain('class="sub"');
    });
});

describe('invoiceHtml — untrusted input', () => {
    // Every one of these fields is admin-typed free text handed to a browser
    // engine. An unescaped value could reshape the document — including its
    // totals — which on a financial record is forgery, not a styling bug.
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

    it('escapes markup in the address, the payment method and the notes', () => {
        const html = invoiceHtml(view({
            customerAddress: '<b>bold</b>',
            paymentMethod: '<b>wire</b>',
            notes: '<b>note</b>',
        }));
        expect(html).not.toContain('<b>bold</b>');
        expect(html).not.toContain('<b>wire</b>');
        expect(html).not.toContain('<b>note</b>');
    });

    it('escapes the VAT note when a VAT row is rendered', () => {
        const html = invoiceHtml(view({ vatCents: 100, totalCents: 1600, vatNote: '<b>vat</b>' }));
        expect(html).not.toContain('<b>vat</b>');
    });

    it('escapes a quote-breaking logo URI rather than emitting a raw attribute', () => {
        const html = invoiceHtml(view({ logoDataUri: '" onload="alert(1)' }));
        expect(html).not.toContain('onload="alert(1)"');
    });
});

describe('invoiceHtml — preview', () => {
    it('marks a preview as a draft so it cannot pass for an issued invoice', () => {
        expect(invoiceHtml(view({ preview: true, lang: 'en' }))).toContain('DRAFT — NOT ISSUED');
        expect(invoiceHtml(view({ preview: false, lang: 'en' }))).not.toContain('DRAFT');
    });
});
