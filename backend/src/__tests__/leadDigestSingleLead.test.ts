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

const render = (lang: 'ar' | 'en', leads: LeadDigestRow[], leadCount = leads.length) =>
    leadDigestEmailTemplate({ lang, leadCount, leads, dashboardUrl: 'https://jawab24.com/ar/leads' }).html;

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

    it('keeps the CTA and the falsified-count copy intact', () => {
        const html = render('ar', [lead()]);
        expect(html).toContain('عرض العملاء المحتملين');
        expect(html).toContain('عميل واحد ترك رقمه');
    });
});
