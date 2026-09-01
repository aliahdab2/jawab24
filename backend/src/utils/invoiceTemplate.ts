/**
 * Invoice document template — the HTML that Chromium turns into the PDF we
 * attach to a merchant email.
 *
 * ## This layout is not a design choice, it is a reproduction
 *
 * It matches the invoice the owner issued by hand to InMedia on 2026-08-08
 * (`JW24-2026-0001`), which is the house style. Two things follow from that,
 * and both were corrections to an earlier draft of this file:
 *
 *  1. **The supplier block is three lines: name, site, email.** No legal name,
 *     no registration number, no registered address — not even as footer small
 *     print. An earlier draft printed all of it and was told to stop. Do not
 *     reintroduce it without the owner asking.
 *  2. **No VAT row when there is no VAT.** Our customers are outside the EU, so
 *     the row and its explanatory note are noise on every invoice we actually
 *     send. The row appears only when `vatCents > 0`, so the capability
 *     survives without cluttering the normal case.
 *
 * Brand tokens and font stacks come from utils/brand.ts, shared with the email
 * templates, so an invoice cannot drift into looking like a different company.
 *
 * ## Two rules govern edits here
 *
 *  1. **Everything printed arrives as an argument.** The renderer never reads
 *     the database, the clock, or the current plan price. A stored invoice is a
 *     snapshot, and reproducing it years later must not depend on anything that
 *     has since changed.
 *  2. **Every interpolated value is escaped.** Customer names, addresses and
 *     line descriptions are admin-typed free text handed to a browser engine.
 *     An apostrophe in a company name must not be able to reshape the page —
 *     and on a financial document, reshaping the totals is forgery.
 */

import { escapeHtml } from './htmlUtils';
import { formatInvoiceDate } from './formatDate';
import { BRAND, PDF_RTL_FONT_STACK, PDF_LTR_FONT_STACK } from './brand';
import { invoiceFontFaceCss } from './invoiceFonts';

export type InvoiceLang = 'ar' | 'en';

/**
 * The supplier block, as printed. Three fields, deliberately — see the header.
 * Passed in rather than imported from config so the renderer stays pure and
 * testable without a config fixture.
 */
export interface InvoiceSeller {
    displayName: string;
    website: string;
    contactEmail: string;
}

export interface InvoiceView {
    lang: InvoiceLang;
    number: string;
    issueDate: Date;
    /** Absent on a preview, which has no number allocated yet. */
    preview?: boolean;
    seller: InvoiceSeller;
    customerName: string;
    customerEmail?: string | null;
    /** Country, or a fuller address. Printed verbatim under the email. */
    customerAddress?: string | null;
    lineDescription: string;
    /** Feature/detail phrases. Joined to the period with the house separator. */
    lineDetail?: string | null;
    /** e.g. "1". Free text: a period is not always a count of months. */
    quantityLabel: string;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    currency: string;
    subtotalCents: number;
    /** Renders a VAT row ONLY when above zero. */
    vatCents: number;
    totalCents: number;
    /** Printed beside the VAT row; ignored when there is no VAT. */
    vatNote?: string | null;
    /** e.g. «حوالة مصرفية». Its meta box is omitted when absent. */
    paymentMethod?: string | null;
    /** When the money was received. Renders the paid badge; omit for an unpaid
     *  invoice — an invoice that wrongly claims payment is worse than useless. */
    paidAt?: Date | null;
    /** Free-text «ملاحظات». Section omitted when absent. */
    notes?: string | null;
    /** Data URI for the brand mark. Embedded so the PDF stands alone. */
    logoDataUri?: string | null;
}

interface Strings {
    invoiceLatin: string;
    invoice: string;
    supplier: string;
    customer: string;
    invoiceNumber: string;
    issueDate: string;
    paymentMethod: string;
    description: string;
    qty: string;
    unitPrice: string;
    lineTotal: string;
    subtotal: string;
    vat: string;
    totalDue: string;
    paidBadge: string;
    paidOn: string;
    notes: string;
    footerThanks: string;
    preview: string;
    periodFromTo: string;
}

/**
 * Copy, in both languages. Arabic is فصحى per AI_INSTRUCTIONS §5, and follows
 * the InMedia invoice's own wording where it had an opinion — «المورّد»,
 * «الإجمالي المستحق», «شكراً لثقتكم».
 *
 * Deliberately NOT in the i18n JSON that `t()` reads: those are merchant-facing
 * runtime strings, and an invoice is an archived document whose wording must not
 * silently change when someone rewords a UI key.
 */
const STRINGS: Record<InvoiceLang, Strings> = {
    ar: {
        invoiceLatin: 'INVOICE',
        invoice: 'فاتورة',
        supplier: 'المورّد',
        customer: 'العميل',
        invoiceNumber: 'رقم الفاتورة',
        issueDate: 'تاريخ الإصدار',
        paymentMethod: 'طريقة السداد',
        description: 'البيان',
        qty: 'الكمية',
        unitPrice: 'سعر الوحدة',
        lineTotal: 'الإجمالي',
        subtotal: 'المجموع',
        vat: 'ضريبة القيمة المضافة',
        totalDue: 'الإجمالي المستحق',
        paidBadge: 'مدفوعة',
        paidOn: 'تمّ استلام كامل قيمة الفاتورة بتاريخ {date}.',
        notes: 'ملاحظات',
        footerThanks: 'شكراً لثقتكم',
        preview: 'مسودة — غير صالحة للإصدار',
        periodFromTo: 'من {from} حتى {to}',
    },
    en: {
        invoiceLatin: 'INVOICE',
        invoice: 'Invoice',
        supplier: 'Supplier',
        customer: 'Customer',
        invoiceNumber: 'Invoice number',
        issueDate: 'Issue date',
        paymentMethod: 'Payment method',
        description: 'Description',
        qty: 'Qty',
        unitPrice: 'Unit price',
        lineTotal: 'Total',
        subtotal: 'Subtotal',
        vat: 'VAT',
        totalDue: 'Total due',
        paidBadge: 'PAID',
        paidOn: 'Paid in full on {date}.',
        notes: 'Notes',
        footerThanks: 'Thank you for your trust',
        preview: 'DRAFT — NOT ISSUED',
        periodFromTo: '{from} – {to}',
    },
};

/** The house separator between detail phrases, as on the InMedia invoice. */
const DETAIL_SEPARATOR = ' · ';

/**
 * Cents → "790.00 USD".
 *
 * Latin digits and a plain decimal point in BOTH languages, matching
 * `formatInvoiceDate` and the InMedia invoice: the figure is read by banks,
 * accountants and bookkeeping software. `Intl` is not used because its Arabic
 * output introduces locale grouping and an Arabic decimal separator, which is
 * exactly what an invoice must not have.
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
 *  money, invoice numbers. Without isolation the surrounding Arabic drags
 *  punctuation to the wrong end (a bidi bug, not a styling preference). */
function ltr(value: string): string {
    return `<span class="ltr">${escapeHtml(value)}</span>`;
}

/** «من 8 آب 2026 حتى 8 آب 2027 · عشرة آلاف ردّ ذكي شهرياً · …» — the period
 *  phrase and the feature phrases, joined the way the house invoice joins them. */
function buildDetail(view: InvoiceView, s: Strings): string {
    const parts: string[] = [];
    if (view.periodStart && view.periodEnd) {
        parts.push(
            s.periodFromTo
                .replace('{from}', formatInvoiceDate(view.periodStart, view.lang))
                .replace('{to}', formatInvoiceDate(view.periodEnd, view.lang)),
        );
    }
    if (view.lineDetail) parts.push(view.lineDetail);
    return parts.map(escapeHtml).join(DETAIL_SEPARATOR);
}

export function invoiceHtml(view: InvoiceView): string {
    const s = STRINGS[view.lang];
    const rtl = view.lang === 'ar';
    const dir = rtl ? 'rtl' : 'ltr';
    const font = rtl ? PDF_RTL_FONT_STACK : PDF_LTR_FONT_STACK;
    // Start/end rather than left/right, so one stylesheet serves both directions.
    const start = rtl ? 'right' : 'left';
    const end = rtl ? 'left' : 'right';

    const money = (c: number) => formatInvoiceMoney(c, view.currency);
    const detail = buildDetail(view, s);
    const hasVat = view.vatCents > 0;

    const logo = view.logoDataUri
        ? `<img src="${escapeHtml(view.logoDataUri)}" alt="" width="40" height="40">`
        : '';

    const metaBoxes = [
        { label: s.invoiceNumber, value: ltr(view.number) },
        { label: s.issueDate, value: escapeHtml(formatInvoiceDate(view.issueDate, view.lang)) },
        // Omitted rather than left blank: an empty box on a financial document
        // reads as missing information, not as "not applicable".
        ...(view.paymentMethod
            ? [{ label: s.paymentMethod, value: escapeHtml(view.paymentMethod) }]
            : []),
    ].map((b) => `
        <div class="metabox">
          <div class="metalabel">${escapeHtml(b.label)}</div>
          <div class="metavalue">${b.value}</div>
        </div>`).join('');

    const customerLines = [
        view.customerEmail ? ltr(view.customerEmail) : '',
        view.customerAddress ? escapeHtml(view.customerAddress) : '',
    ].filter(Boolean).join('\n');

    const vatRow = hasVat
        ? `<tr>
             <td class="lbl">${escapeHtml(s.vat)}${view.vatNote ? ` <span class="vatnote">${escapeHtml(view.vatNote)}</span>` : ''}</td>
             <td class="val money">${escapeHtml(money(view.vatCents))}</td>
           </tr>`
        : '';

    const paidPanel = view.paidAt
        ? `<div class="paid">
             <span class="paidpill">${escapeHtml(s.paidBadge)}</span>
             <span>${escapeHtml(s.paidOn.replace('{date}', formatInvoiceDate(view.paidAt, view.lang)))}</span>
           </div>`
        : '';

    const notesSection = view.notes
        ? `<div class="notes">
             <h2>${escapeHtml(s.notes)}</h2>
             <p>${escapeHtml(view.notes)}</p>
           </div>`
        : '';

    // The Latin "INVOICE" heading carries a translated subtitle beneath it —
    // «فاتورة» in Arabic. In English that subtitle would just repeat the
    // heading, so it is dropped rather than printed twice. Compared rather than
    // hardcoded per language, so a third language gets the right behaviour for
    // free.
    const subtitle = s.invoice.toLowerCase() === s.invoiceLatin.toLowerCase()
        ? ''
        : `<div class="subtitle">${escapeHtml(s.invoice)}</div>`;

    const previewBanner = view.preview
        ? `<div class="preview">${escapeHtml(s.preview)}</div>`
        : '';

    return `<!doctype html>
<html lang="${view.lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(s.invoice)} ${escapeHtml(view.number)}</title>
<style>
  ${invoiceFontFaceCss()}

  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: ${BRAND.surface};
    font-family: ${font};
    color: ${BRAND.body}; font-size: 13.5px; line-height: 1.7; direction: ${dir};
  }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 40px; height: 40px; border-radius: 10px; display: block; }
  .brand span { font-size: 21px; font-weight: 700; color: ${BRAND.accent}; letter-spacing: -0.01em; }
  .doctype { text-align: ${end}; }
  .doctype h1 {
    margin: 0; font-size: 30px; font-weight: 700; color: ${BRAND.accent};
    letter-spacing: 2px; line-height: 1.1;
  }
  .doctype .subtitle { font-size: 14px; color: ${BRAND.muted}; margin-top: 2px; }
  .rule { height: 3px; background: ${BRAND.accent}; margin: 20px 0 26px; border-radius: 2px; }

  .preview {
    margin-bottom: 22px; padding: 8px 14px; border: 1.5px dashed ${BRAND.accent};
    border-radius: 6px; color: ${BRAND.accent}; font-weight: 700; font-size: 13px;
    text-align: center; letter-spacing: 1px;
  }

  .parties { display: flex; gap: 16px; }
  .parties section {
    flex: 1; background: ${BRAND.panel}; border: 1px solid ${BRAND.border};
    border-radius: 10px; padding: 16px 18px;
  }
  h2 { font-size: 12px; color: ${BRAND.accent}; margin: 0 0 8px; font-weight: 700; }
  .pname { font-weight: 700; color: ${BRAND.ink}; font-size: 16px; margin-bottom: 4px; }
  /* 500, not 400: the house invoice's font table carries Tajawal-Medium, and
     these party-card lines are where it shows. It also keeps the embedded
     500 weight in use rather than shipping a face nothing references. */
  address { font-style: normal; white-space: pre-line; font-size: 13px; font-weight: 500; color: ${BRAND.muted}; }
  .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }

  .meta { display: flex; gap: 16px; margin-top: 16px; }
  .metabox {
    flex: 1; border: 1px solid ${BRAND.border}; border-radius: 10px; padding: 12px 16px;
  }
  .metalabel { font-size: 11.5px; color: ${BRAND.muted}; }
  .metavalue { font-weight: 700; color: ${BRAND.ink}; font-size: 14.5px; margin-top: 2px; }

  table.items { width: 100%; border-collapse: collapse; margin-top: 26px; }
  table.items thead th {
    background: ${BRAND.accent}; color: #ffffff; font-size: 12.5px; font-weight: 700;
    text-align: ${start}; padding: 11px 14px;
  }
  /* Rounded via the WRAPPER, not per-cell. A collapsed table draws each
     header cell's background separately, so per-cell radii leave 1px seams at
     every column boundary; clipping the wrapper has no seams to leave. */
  .itemswrap { border-radius: 8px; overflow: hidden; margin-top: 26px; }
  .itemswrap table.items { margin-top: 0; }
  table.items thead th.num, table.items tbody td.num { text-align: ${end}; }
  table.items tbody td { padding: 16px 14px; border-bottom: 1px solid ${BRAND.rule}; vertical-align: top; }
  .desc { font-weight: 700; color: ${BRAND.ink}; font-size: 15px; }
  .sub { color: ${BRAND.muted}; font-size: 12.5px; margin-top: 5px; line-height: 1.75; }
  .money { direction: ltr; unicode-bidi: isolate; white-space: nowrap; }

  /* Half width, pushed to the far side — as on the house invoice. A
     full-width totals ladder leaves the label stranded far from its figure. */
  .totals { width: 52%; margin-${start}: auto; margin-top: 14px; }
  table.sums { width: 100%; border-collapse: collapse; }
  table.sums td { padding: 8px 14px; }
  table.sums .lbl { color: ${BRAND.muted}; text-align: ${start}; }
  table.sums .val { text-align: ${end}; color: ${BRAND.ink}; }
  .vatnote { color: ${BRAND.muted}; font-size: 11.5px; }

  /* The grand total is ONE element, not a table row.
     Rounding the two ends of a row means rounding two separate cells, and they
     meet in the middle as a visible step in the teal bar however the borders
     are collapsed. A single flex block cannot have that seam. */
  .grandtotal {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    background: ${BRAND.accent}; color: #ffffff; border-radius: 8px;
    padding: 13px 14px; margin-top: 6px; font-size: 16px; font-weight: 700;
  }

  /* Tinted with the brand teal, not neutral grey: on the house invoice the
     paid panel reads as a positive confirmation, not as a note. */
  .paid {
    margin-top: 24px; background: #eefaf7; border: 1px solid #bfe8e0;
    border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; gap: 12px;
    color: ${BRAND.bodyMuted}; font-size: 13px;
  }
  .paidpill {
    background: ${BRAND.accent}; color: #ffffff; font-weight: 700; font-size: 12.5px;
    padding: 5px 14px; border-radius: 999px; white-space: nowrap;
  }

  .notes { margin-top: 28px; }
  .notes p { margin: 0; font-size: 12.5px; color: ${BRAND.muted}; line-height: 1.8; }

  .foot {
    margin-top: 40px; padding-top: 16px; border-top: 1px solid ${BRAND.rule};
    display: flex; justify-content: space-between; gap: 20px;
    font-size: 12px; color: ${BRAND.muted};
  }
  .foot a, .foot .site { color: ${BRAND.accent}; text-decoration: none; }
</style>
</head>
<body>

  <div class="head">
    <div class="brand">${logo}<span>${escapeHtml(view.seller.displayName)}</span></div>
    <div class="doctype">
      <h1>${escapeHtml(s.invoiceLatin)}</h1>
      ${subtitle}
    </div>
  </div>

  <div class="rule"></div>
  ${previewBanner}

  <div class="parties">
    <section>
      <h2>${escapeHtml(s.supplier)}</h2>
      <div class="pname">${escapeHtml(view.seller.displayName)}</div>
      <address>${ltr(view.seller.website)}
${ltr(view.seller.contactEmail)}</address>
    </section>
    <section>
      <h2>${escapeHtml(s.customer)}</h2>
      <div class="pname">${escapeHtml(view.customerName)}</div>
      <address>${customerLines}</address>
    </section>
  </div>

  <div class="meta">${metaBoxes}</div>

  <div class="itemswrap">
  <table class="items">
    <thead>
      <tr>
        <th>${escapeHtml(s.description)}</th>
        <th class="num">${escapeHtml(s.qty)}</th>
        <th class="num">${escapeHtml(s.unitPrice)}</th>
        <th class="num">${escapeHtml(s.lineTotal)}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="desc">${escapeHtml(view.lineDescription)}</div>
          ${detail ? `<div class="sub">${detail}</div>` : ''}
        </td>
        <td class="num">${escapeHtml(view.quantityLabel)}</td>
        <td class="num money">${escapeHtml(money(view.subtotalCents))}</td>
        <td class="num money">${escapeHtml(money(view.subtotalCents))}</td>
      </tr>
    </tbody>
  </table>
  </div>

  <div class="totals">
    <table class="sums">
      <tr><td class="lbl">${escapeHtml(s.subtotal)}</td><td class="val money">${escapeHtml(money(view.subtotalCents))}</td></tr>
      ${vatRow}
    </table>

    <div class="grandtotal">
      <span>${escapeHtml(s.totalDue)}</span>
      <span class="money">${escapeHtml(money(view.totalCents))}</span>
    </div>
  </div>

  ${paidPanel}
  ${notesSection}

  <div class="foot">
    <div>${escapeHtml(view.seller.displayName)} — ${escapeHtml(s.footerThanks)}</div>
    <div class="site">${ltr(view.seller.website)}</div>
  </div>

</body>
</html>`;
}
