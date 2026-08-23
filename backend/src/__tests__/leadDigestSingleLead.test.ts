/**
 * Tests: the single-lead digest layout, and the dark-mode header override.
 *
 * Origin (2026-08-23): the age flush made a ONE-lead digest reachable, and the
 * email still rendered the five-column `table-layout:fixed` grid built for
 * twenty rows — the reason column wrapped to three lines and the date clipped
 * at the 720px card edge. In the same screenshot the header bar was white with
 * invisible labels: the dark block named `.ld-head, .ld-head td`, but the
 * header cells are `<th>` and the #fafafa ground is inline on the `<tr>`, so
 * the override reached neither while the broad `.card th { color:#e6efef }`
 * sweep landed anyway.
 */
import { describe, it, expect } from 'vitest';
import { leadDigestEmailTemplate, type LeadDigestRow } from '../utils/emailTemplates';

const lead = (over: Partial<LeadDigestRow> = {}): LeadDigestRow => ({
    name: 'Rânâ Mohamed',
    phone: '01229554912',
    sourceType: 'message',
    createdAt: new Date('2026-08-20T05:31:00Z'),
    summary: 'يوجد مريضة في العناية المركزة تعاني من ارتفاع ضغط الدم وتحتاج إلى اهتمام وعناية أفضل.',
    ...over,
});

// Fixed `now` — three hours after the fixture's createdAt — so the waiting pill
// is not wall-clock dependent.
const NOW = new Date('2026-08-20T08:31:00Z');

const render = (lang: 'ar' | 'en', leads: LeadDigestRow[], leadCount = leads.length, now: Date = NOW) =>
    leadDigestEmailTemplate({ lang, leadCount, leads, dashboardUrl: 'https://jawab24.com/ar/leads', now }).html;

describe('lead digest — dark mode header', () => {
    // Mutation check: revert the selector to `.ld-head, .ld-head td` and both
    // of these fail — the first on `tr`, the second on `th`.
    it('overrides the header background on the tr and the th, not only the thead', () => {
        const html = render('ar', [lead(), lead({ name: 'Sara' })]);
        const rule = html.match(/\.ld-head[^\n]*background-color:#0d1719[^\n]*/)?.[0] ?? '';
        expect(rule).toContain('.ld-head tr');
        expect(rule).toContain('.ld-head th');
    });

    it('still carries the inline light-mode header ground for clients that drop <style>', () => {
        expect(render('ar', [lead(), lead({ name: 'Sara' })])).toContain('background-color:#fafafa;');
    });
});

describe('lead digest — single lead layout', () => {
    it('drops the fixed five-column table for one lead', () => {
        const html = render('ar', [lead()]);
        expect(html).not.toContain('table-layout:fixed');
        expect(html).not.toContain('class="ld-table"');
        expect(html).not.toContain('<thead');
    });

    it('renders in the standard 600px shell, not the 720px table card', () => {
        expect(render('ar', [lead()])).toContain('max-width:600px');
        expect(render('ar', [lead()])).not.toContain('max-width:720px');
    });

    it('keeps the 720px table from two leads upwards', () => {
        const html = render('ar', [lead(), lead({ name: 'Sara' })]);
        expect(html).toContain('max-width:720px');
        expect(html).toContain('table-layout:fixed');
    });

    it('labels every field with the same i18n strings the table uses', () => {
        const html = render('ar', [lead()]);
        for (const label of ['الاسم', 'الهاتف', 'السبب', 'المصدر', 'التاريخ']) {
            expect(html).toContain(label);
        }
    });

    it('renders the phone as a tel: link', () => {
        expect(render('ar', [lead()])).toContain('href="tel:01229554912"');
    });

    it('strips separators from the tel: href but keeps the displayed number', () => {
        const html = render('en', [lead({ phone: '+20 122 955 4912' })]);
        expect(html).toContain('href="tel:+201229554912"');
        expect(html).toContain('+20 122 955 4912');
    });

    it('escapes lead-supplied values in both layouts', () => {
        const xss = lead({ name: '<script>alert(1)</script>', summary: '"><img src=x>' });
        const single = render('en', [xss]);
        expect(single).not.toContain('<script>alert(1)</script>');
        expect(single).toContain('&lt;script&gt;');
        const table = render('en', [xss, lead({ name: 'Sara' })]);
        expect(table).not.toContain('<script>alert(1)</script>');
    });

    it('shows the "and N more" line when one row stands for a larger count', () => {
        // A truncated digest can still render one row (MAX_ROWS is 20, but the
        // caller may pass fewer leads than it counted).
        expect(render('en', [lead()], 4)).toContain('and 3 more');
    });

    it('keeps the plural-agreeing intro copy intact', () => {
        expect(render('ar', [lead()])).toContain('عميل واحد ترك رقمه');
    });
});

describe('lead digest — action hierarchy', () => {
    it('makes calling the lead the primary action for a single lead', () => {
        const html = render('ar', [lead()]);
        // The teal button carries the tel: URL, not the dashboard.
        expect(html).toMatch(/bgcolor="#0d9488"[\s\S]{0,200}href="tel:01229554912"/);
        expect(html).toContain('اتصل الآن بـ');
    });

    it('demotes the dashboard to a secondary outline button, still present', () => {
        const html = render('ar', [lead()]);
        expect(html).toContain('class="ghost"');
        expect(html).toMatch(/class="ghost"[\s\S]{0,300}https:\/\/jawab24\.com\/ar\/leads/);
        expect(html).toContain('فتح صفحة العملاء المحتملين');
    });

    it('keeps exactly one button, the dashboard, when there are many leads', () => {
        const html = render('ar', [lead(), lead({ name: 'Sara' })]);
        expect(html).toContain('عرض العملاء المحتملين');
        expect(html).not.toContain('class="ghost"');
        expect(html).not.toContain('href="tel:');
    });

    it('re-asserts the ghost background in dark mode so the sweep cannot strip it', () => {
        const rule = render('ar', [lead()]).match(/\.ghost[^\n]*background-color[^\n]*/)?.[0] ?? '';
        expect(rule).toContain('.ghost td');
    });
});

describe('lead digest — waiting pill', () => {
    it('states the wait in hours rather than making the reader subtract', () => {
        expect(render('ar', [lead()])).toContain('بانتظار التواصل منذ ٣ ساعات');
    });

    it('uses the Arabic dual for two hours, never «2 ساعات»', () => {
        const html = render('ar', [lead()], 1, new Date('2026-08-20T07:31:00Z'));
        expect(html).toContain('بانتظار التواصل منذ ساعتين');
        expect(html).not.toMatch(/\d\s*ساعات/);
    });

    it('says "less than an hour" instead of "0 hours"', () => {
        const html = render('en', [lead()], 1, new Date('2026-08-20T05:50:00Z'));
        expect(html).toContain('Waiting less than an hour');
        expect(html).not.toContain('Waiting 0 hours');
    });

    it('switches to days past 24 hours', () => {
        expect(render('en', [lead()], 1, new Date('2026-08-23T05:31:00Z'))).toContain('Waiting 3 days');
        expect(render('ar', [lead()], 1, new Date('2026-08-22T05:31:00Z'))).toContain('منذ يومين');
    });

    it('carries the pill only on the single-lead layout', () => {
        expect(render('ar', [lead(), lead({ name: 'Sara' })])).not.toContain('class="pill"');
    });
});

describe('lead digest — Arabic numerals', () => {
    it('renders the date in Arabic-Indic numerals', () => {
        const html = render('ar', [lead()]);
        expect(html).toMatch(/[٠-٩]/);
        expect(html).not.toContain('20 أغسطس');
    });

    it('keeps the phone in Latin digits so it stays dialable', () => {
        const html = render('ar', [lead()]);
        expect(html).toContain('href="tel:01229554912"');
        expect(html).toContain('>01229554912<');
    });

    it('uses Arabic-Indic numerals in the multi-lead table too', () => {
        // Two layouts disagreeing about the numeral system is the worse bug.
        expect(render('ar', [lead(), lead({ name: 'Sara' })])).not.toContain('20 أغسطس');
    });

    it('leaves English dates in Latin digits', () => {
        expect(render('en', [lead()])).toMatch(/Aug 20/);
    });
});

describe('email footer identity', () => {
    it('no longer calls Jawab24 an auto-reply service', () => {
        // The landing page sells us as «أذكى من بوتات الرد التلقائي»; the footer
        // used to describe us as exactly the thing that line differentiates from.
        const html = render('ar', [lead()]);
        expect(html).not.toContain('ردود تلقائية');
        expect(html).toContain('موظف مبيعاتك الذكي على واتساب وفيسبوك وإنستغرام');
    });

    it('reads naturally in English', () => {
        expect(render('en', [lead()])).toContain('Your smart sales assistant on WhatsApp, Facebook and Instagram');
    });
});
