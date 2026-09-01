/**
 * Invoice document template — the HTML that Chromium turns into the PDF we
 * attach to a merchant email.
 *
 * Brand tokens and font stacks come from utils/brand.ts, shared with the email
 * templates, so an invoice cannot drift into looking like a different company's
 * document. The LAYOUT is intentionally its own thing: an email is a single
 * column of prose read on a phone, an invoice is a fixed A4 page with a party
 * block, a line table and a totals ladder.
 *
 * Two rules govern edits here:
 *
 *  1. **Everything printed arrives as an argument.** The renderer never reads
 *     the database, the clock, or the current plan price. A stored invoice is a
 *     snapshot (see the `invoices` table comment), and reproducing it years
 *     later must not depend on anything that has since changed.
 *  2. **Every interpolated value is escaped.** Merchant names, addresses and
 *     line descriptions are admin-typed free text. `escapeHtml` on all of them
 *     — an apostrophe in a company name must not be able to reshape the page,
 *     and this HTML is handed to a browser engine.
 */

import { escapeHtml } from './htmlUtils';
import { formatInvoiceDate } from './formatDate';
import { BRAND, PDF_RTL_FONT_STACK, PDF_LTR_FONT_STACK } from './brand';

export type InvoiceLang = 'ar' | 'en';

/** The seller block. Mirrors `config.invoicing`, passed in rather than imported
 *  so the renderer stays pure and testable without a config fixture. */
export interface InvoiceSeller {
    displayName: string;
    legalName: string;
    legalForm: string;
    registrationNumber: string;
    addressLines: string[];
    contactEmail: string;
    website: string;
}

export interface InvoiceView {
    lang: InvoiceLang;
    number: string;
    issueDate: Date;
    /** Absent on a preview, which has no number allocated yet. */
    preview?: boolean;
    seller: InvoiceSeller;
    customerName: string;
    customerContact?: string | null;
    customerEmail?: string | null;
    customerAddress?: string | null;
    lineDescription: string;
    lineDetail?: string | null;
    /** e.g. "شهر واحد" / "1 month". Free text: a period is not always months. */
    quantityLabel: string;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    currency: string;
    subtotalCents: number;
    vatCents: number;
    totalCents: number;
    vatNote?: string | null;
    /** Data URI for the brand mark. Embedded so the PDF stands alone. */
    logoDataUri?: string | null;
    /** Payment instructions panel. Omitted entirely when absent. */
    paymentNote?: string | null;
}

interface Strings {
    invoice: string;
    invoiceDate: string;
    supplyDate: string;
    dueDate: string;
    dueOnReceipt: string;
    from: string;
    billTo: string;
    description: string;
    qty: string;
    unitPrice: string;
    amount: string;
    subtotal: string;
    vat: string;
    totalDue: string;
    period: string;
    currencyNote: string;
    vatLabel: string;
    paymentLabel: string;
    page: string;
    preview: string;
}

/**
 * Copy, in both languages. Arabic is فصحى per AI_INSTRUCTIONS §5 — this is text
 * Jawab24 authors, so no dialect.
 *
 * Deliberately NOT in the i18n JSON that `t()` reads: those files are the
 * merchant-facing runtime strings, and an invoice is an archived legal document
 * whose wording must not silently change when someone rewords a UI key. If the
 * word «الإجمالي» changes here, that is a decision about documents; if it
 * changed under us via a shared key, it would be an accident.
 */
const STRINGS: Record<InvoiceLang, Strings> = {
    ar: {
        invoice: 'فاتورة',
        invoiceDate: 'تاريخ الفاتورة',
        supplyDate: 'تاريخ تقديم الخدمة',
        dueDate: 'تاريخ الاستحقاق',
        dueOnReceipt: 'عند الاستلام',
        from: 'الجهة المُصدِرة',
        billTo: 'فاتورة إلى',
        description: 'البيان',
        qty: 'الكمية',
        unitPrice: 'سعر الوحدة',
        amount: 'المبلغ',
        subtotal: 'المجموع الفرعي',
        vat: 'ضريبة القيمة المضافة',
        totalDue: 'الإجمالي المستحق',
        period: 'فترة الاشتراك',
        currencyNote: 'العملة',
        vatLabel: 'ضريبة القيمة المضافة',
        paymentLabel: 'طريقة الدفع',
        page: 'صفحة 1 من 1',
        preview: 'مسودة — غير صالحة للإصدار',
    },
    en: {
        invoice: 'Invoice',
        invoiceDate: 'Invoice date',
        supplyDate: 'Supply date',
        dueDate: 'Due',
        dueOnReceipt: 'On receipt',
        from: 'From',
        billTo: 'Bill to',
        description: 'Description',
        qty: 'Qty',
        unitPrice: 'Unit price',
        amount: 'Amount',
        subtotal: 'Subtotal',
        vat: 'VAT',
        totalDue: 'Total due',
        period: 'Billing period',
        currencyNote: 'Currency',
        vatLabel: 'VAT',
        paymentLabel: 'Payment',
        page: 'Page 1 of 1',
        preview: 'DRAFT — NOT ISSUED',
    },
};

/**
 * Cents → "15.00 USD".
 *
 * Latin digits and a plain decimal point in BOTH languages, matching
 * `formatInvoiceDate`: the figure is read by banks, accountants and bookkeeping
 * software. `Intl` is not used because its Arabic output introduces
 * locale-specific grouping and an Arabic decimal separator, which is precisely
 * what an invoice must not have.
 */
export function formatInvoiceMoney(cents: number, currency: string): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const major = Math.floor(abs / 100);
    const minor = String(abs % 100).padStart(2, '0');
    // Thousands separators, so 79000 reads 790.00 and 7900000 reads 79,000.00.
    const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${grouped}.${minor} ${currency.toUpperCase()}`;
}

/** Wrap a value that must render left-to-right inside RTL copy — emails, URLs,
 *  registration numbers, money. Without isolation the surrounding Arabic drags
 *  punctuation to the wrong end (a bidi bug, not a styling preference). */
function ltr(value: string): string {
    return `<span class="ltr">${escapeHtml(value)}</span>`;
}

function renderPeriod(view: InvoiceView, s: Strings): string {
    if (!view.periodStart || !view.periodEnd) return '';
    const from = formatInvoiceDate(view.periodStart, view.lang);
    const to = formatInvoiceDate(view.periodEnd, view.lang);
    return `${escapeHtml(s.period)}: ${escapeHtml(from)} – ${escapeHtml(to)}`;
}

export function invoiceHtml(view: InvoiceView): string {
    const s = STRINGS[view.lang];
    const rtl = view.lang === 'ar';
    const dir = rtl ? 'rtl' : 'ltr';
    const font = rtl ? PDF_RTL_FONT_STACK : PDF_LTR_FONT_STACK;
    // Start/end rather than left/right, so one stylesheet serves both
    // directions — the same logical-property rule the frontend follows.
    const start = rtl ? 'right' : 'left';
    const end = rtl ? 'left' : 'right';

    const money = (c: number) => formatInvoiceMoney(c, view.currency);
    const issue = formatInvoiceDate(view.issueDate, view.lang);
    const periodLine = renderPeriod(view, s);

    const logo = view.logoDataUri
        ? `<img src="${escapeHtml(view.logoDataUri)}" alt="" width="34" height="34">`
        : '';

    const customerLines = [
        view.customerContact
            ? `${rtl ? 'عناية' : 'Attn'}: ${escapeHtml(view.customerContact)}`
            : '',
        view.customerEmail ? ltr(view.customerEmail) : '',
        view.customerAddress ? escapeHtml(view.customerAddress) : '',
    ].filter(Boolean).join('\n');

    const sellerLines = [
        ltr(view.seller.website),
        ltr(view.seller.contactEmail),
    ].join('\n');

    const paymentPanel = view.paymentNote
        ? `<div class="panel"><b>${escapeHtml(s.paymentLabel)}:</b> ${escapeHtml(view.paymentNote)}</div>`
        : '';

    const vatNote = view.vatNote
        ? `<p><b>${escapeHtml(s.vatLabel)}:</b> ${escapeHtml(view.vatNote)}</p>`
        : '';

    // The registration block: trade name to the customer, registered identity as
    // footer small print. Both are required for the document to be valid; only
    // one of them needs to be prominent.
    const legalFooter = [
        `${view.seller.displayName} — ${view.seller.legalName}, ${view.seller.legalForm}`,
        `Org. nr ${view.seller.registrationNumber}`,
        view.seller.addressLines.join(', '),
    ].join(' · ');

    const previewBanner = view.preview
        ? `<div class="preview">${escapeHtml(s.preview)}</div>`
        : '';

    return `<!doctype html>
<html lang="${view.lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(s.invoice)} ${escapeHtml(view.number)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: ${BRAND.surface};
    font-family: ${font};
    color: ${BRAND.body}; font-size: 14px; line-height: 1.7; direction: ${dir};
  }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 34px; height: 34px; border-radius: 8px; display: block; }
  .brand span { font-size: 17px; font-weight: 700; color: ${BRAND.ink}; letter-spacing: -0.01em; }
  .doctype { text-align: ${end}; }
  .doctype h1 { margin: 0; font-size: 25px; font-weight: 700; color: ${BRAND.ink}; letter-spacing: -0.02em; line-height: 1.25; }
  .doctype .num { font-size: 14px; font-weight: 600; color: ${BRAND.accent}; margin-top: 2px; direction: ltr; }
  .preview {
    margin-top: 14px; padding: 8px 14px; border: 1.5px dashed ${BRAND.accent};
    border-radius: 6px; color: ${BRAND.accent}; font-weight: 700; font-size: 13px;
    text-align: center; letter-spacing: 1px;
  }
  .metabar {
    display: flex; flex-wrap: wrap; gap: 8px 28px;
    padding: 14px 0 18px; border-bottom: 1px solid ${BRAND.rule}; margin: 14px 0 22px; font-size: 13.5px;
  }
  .metabar span { color: ${BRAND.muted}; }
  .metabar b { color: ${BRAND.ink}; font-weight: 600; }
  .parties { display: flex; gap: 28px; }
  .parties section { flex: 1; }
  h2 { font-size: 12px; color: ${BRAND.muted}; margin: 0 0 6px; font-weight: 700; }
  .pname { font-weight: 700; color: ${BRAND.ink}; font-size: 15px; }
  address { font-style: normal; white-space: pre-line; font-size: 13.5px; }
  .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 26px; }
  table.items thead th {
    font-size: 12px; color: ${BRAND.muted}; font-weight: 700; text-align: ${start};
    border-bottom: 1.5px solid ${BRAND.ink}; padding: 0 0 8px;
  }
  table.items thead th.num, table.items td.num { text-align: ${end}; }
  table.items tbody td { padding: 14px 0; border-bottom: 1px solid ${BRAND.rule}; vertical-align: top; }
  .desc { font-weight: 600; color: ${BRAND.ink}; font-size: 14.5px; }
  .sub { color: ${BRAND.muted}; font-size: 13px; margin-top: 4px; }
  .money { direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
  table.sums { width: 100%; margin-top: 4px; border-collapse: collapse; }
  table.sums td { padding: 7px 0; }
  table.sums .lbl { color: ${BRAND.muted}; text-align: ${start}; }
  table.sums .val { text-align: ${end}; }
  table.sums tr.total td {
    border-top: 1.5px solid ${BRAND.ink}; padding-top: 12px;
    font-size: 17px; font-weight: 700; color: ${BRAND.ink};
  }
  .panel {
    background: ${BRAND.panel}; border-${start}: 3px solid ${BRAND.accent}; border-radius: 6px;
    padding: 14px 16px; color: ${BRAND.bodyMuted}; font-size: 14px; margin-top: 26px;
  }
  .panel b { color: ${BRAND.ink}; }
  .notes { margin-top: 20px; font-size: 13px; color: ${BRAND.muted}; }
  .notes p { margin: 0 0 6px; }
  .notes b { color: ${BRAND.bodyMuted}; }
  .foot {
    border-top: 1px solid ${BRAND.rule}; margin-top: 34px; padding-top: 16px;
    color: ${BRAND.fine}; font-size: 11px; line-height: 1.6;
  }
  .foot .pageno { margin-top: 5px; color: ${BRAND.muted}; }
</style>
</head>
<body>

  <div class="head">
    <div class="brand">${logo}<span>${escapeHtml(view.seller.displayName)}</span></div>
    <div class="doctype">
      <h1>${escapeHtml(s.invoice)}</h1>
      <div class="num">${escapeHtml(view.number)}</div>
    </div>
  </div>
  ${previewBanner}

  <div class="metabar">
    <div><span>${escapeHtml(s.invoiceDate)}:</span> <b>${escapeHtml(issue)}</b></div>
    <div><span>${escapeHtml(s.supplyDate)}:</span> <b>${escapeHtml(issue)}</b></div>
    <div><span>${escapeHtml(s.dueDate)}:</span> <b>${escapeHtml(s.dueOnReceipt)}</b></div>
  </div>

  <div class="parties">
    <section>
      <h2>${escapeHtml(s.from)}</h2>
      <div class="pname">${escapeHtml(view.seller.displayName)}</div>
      <address>${sellerLines}</address>
    </section>
    <section>
      <h2>${escapeHtml(s.billTo)}</h2>
      <div class="pname">${escapeHtml(view.customerName)}</div>
      <address>${customerLines}</address>
    </section>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>${escapeHtml(s.description)}</th>
        <th class="num">${escapeHtml(s.qty)}</th>
        <th class="num">${escapeHtml(s.unitPrice)}</th>
        <th class="num">${escapeHtml(s.amount)}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="desc">${escapeHtml(view.lineDescription)}</div>
          <div class="sub">${periodLine}${periodLine && view.lineDetail ? '<br>' : ''}${view.lineDetail ? escapeHtml(view.lineDetail) : ''}</div>
        </td>
        <td class="num">${escapeHtml(view.quantityLabel)}</td>
        <td class="num money">${escapeHtml(money(view.subtotalCents))}</td>
        <td class="num money">${escapeHtml(money(view.subtotalCents))}</td>
      </tr>
    </tbody>
  </table>

  <table class="sums">
    <tr><td class="lbl">${escapeHtml(s.subtotal)}</td><td class="val money">${escapeHtml(money(view.subtotalCents))}</td></tr>
    <tr><td class="lbl">${escapeHtml(s.vat)} (${view.subtotalCents > 0 ? Math.round((view.vatCents / view.subtotalCents) * 100) : 0}%)</td><td class="val money">${escapeHtml(money(view.vatCents))}</td></tr>
    <tr class="total"><td class="lbl">${escapeHtml(s.totalDue)}</td><td class="val money">${escapeHtml(money(view.totalCents))}</td></tr>
  </table>

  ${paymentPanel}

  <div class="notes">
    ${vatNote}
    <p><b>${escapeHtml(s.currencyNote)}:</b> ${ltr(view.currency.toUpperCase())}</p>
  </div>

  <div class="foot">
    <div>${ltr(legalFooter)}</div>
    <div class="pageno">${escapeHtml(s.invoice)} ${ltr(view.number)} · ${escapeHtml(s.page)}</div>
  </div>

</body>
</html>`;
}
