/**
 * Tests: plural agreement in the lead-digest email.
 *
 * Origin (2026-08-04): the digest's volume trigger (DIGEST_THRESHOLD = 10) meant
 * `count` was never below 10, so the copy was written in a single frozen plural
 * form. The age trigger made low counts reachable, and the FIRST email a
 * low-volume merchant would ever receive read "You have 1 new leads on Jawab24"
 * — «لديك 1 عميل محتمل جديد» in Arabic, where one and two are not numbered at
 * all. These assertions pin the boundary counts in both languages.
 */
import { describe, it, expect } from 'vitest';
import { tPlural } from '../utils/i18n';
import { leadDigestEmailTemplate } from '../utils/emailTemplates';

const leadsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        name: `Customer ${i}`,
        phone: `+96355500${String(i).padStart(4, '0')}`,
        sourceType: 'message',
        createdAt: new Date('2026-08-04T10:00:00Z'),
        summary: null,
    }));

const render = (lang: 'ar' | 'en', count: number) =>
    leadDigestEmailTemplate({
        lang,
        leadCount: count,
        leads: leadsOf(Math.min(count, 3)),
        dashboardUrl: 'https://jawab24.com/en/leads',
    });

describe('lead digest plurals', () => {
    describe('English', () => {
        it('uses the singular for one waiting customer — never "1 customers"', () => {
            const { subject, html } = render('en', 1);
            expect(subject).toBe('You have 1 customer waiting on Jawab24');
            expect(subject).not.toMatch(/1 customers/);
            expect(html).toContain('1 customer left their number and is still waiting');
            expect(html).not.toMatch(/1 customers left/);
        });

        it('uses the plural from two upwards', () => {
            expect(render('en', 2).subject).toBe('You have 2 customers waiting on Jawab24');
            expect(render('en', 10).subject).toBe('You have 10 customers waiting on Jawab24');
        });
    });

    describe('Arabic (فصحى, all six CLDR categories)', () => {
        // Arabic does not number one or two — «عميل واحد» / «عميلان», never «1 عميل».
        it('does not put a digit before the noun for one or two', () => {
            expect(tPlural('leadDigestSubject', 1, 'ar')).toBe('لديك عميل واحد بانتظار التواصل على Jawab24');
            expect(tPlural('leadDigestSubject', 2, 'ar')).toBe('لديك عميلان بانتظار التواصل على Jawab24');
            // No numeral immediately before the noun (the brand "Jawab24" has digits).
            expect(tPlural('leadDigestSubject', 1, 'ar')).not.toMatch(/\d+\s*عميل/);
            expect(tPlural('leadDigestSubject', 2, 'ar')).not.toMatch(/\d+\s*عميل/);
        });

        it('selects few / many / other by CLDR category', () => {
            expect(tPlural('leadDigestSubject', 3, 'ar')).toBe('لديك 3 عملاء بانتظار التواصل على Jawab24');
            expect(tPlural('leadDigestSubject', 10, 'ar')).toBe('لديك 10 عملاء بانتظار التواصل على Jawab24');
            expect(tPlural('leadDigestSubject', 19, 'ar')).toBe('لديك 19 عميلاً بانتظار التواصل على Jawab24');
            expect(tPlural('leadDigestSubject', 100, 'ar')).toBe('لديك 100 عميل بانتظار التواصل على Jawab24');
        });

        it('agrees in the email body too', () => {
            expect(render('ar', 1).html).toContain('عميل واحد ترك رقمه ولا يزال بانتظار التواصل');
            expect(render('ar', 2).html).toContain('عميلان تركا رقميهما');
            expect(render('ar', 19).html).toContain('19 عميلاً تركوا أرقامهم');
        });
    });

    it('falls back to the `other` variant for an unknown locale', () => {
        // Unknown locale resolves to English, which selects one/other only.
        expect(tPlural('leadDigestSubject', 5, 'fr')).toBe('You have 5 customers waiting on Jawab24');
    });
});
