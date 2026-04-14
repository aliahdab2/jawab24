import { describe, it, expect } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        resend: {
            fromName: 'Jawab24 Test',
        },
    },
}));

import { waitlistEmailTemplate } from '../../src/utils/emailTemplates';

describe('waitlistEmailTemplate', () => {
    const baseParams = {
        subject: 'Welcome!',
        body: 'Hello, welcome to Jawab24.',
        unsubscribeUrl: 'https://jawab24.com/unsubscribe?token=abc123',
    };

    it('should return valid HTML with required structure', () => {
        const html = waitlistEmailTemplate(baseParams);

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('</html>');
        expect(html).toContain('<title>Welcome!</title>');
    });

    it('should include the email body content', () => {
        const html = waitlistEmailTemplate(baseParams);

        expect(html).toContain('Hello, welcome to Jawab24.');
    });

    it('should include the unsubscribe link', () => {
        const html = waitlistEmailTemplate(baseParams);

        expect(html).toContain('href="https://jawab24.com/unsubscribe?token=abc123"');
        expect(html).toContain('Unsubscribe');
    });

    it('should include brand name from config', () => {
        const html = waitlistEmailTemplate(baseParams);

        expect(html).toContain('Jawab24 Test');
    });

    it('should include preheader text from body', () => {
        const html = waitlistEmailTemplate(baseParams);

        // Preheader is hidden div with first 150 chars of body
        expect(html).toContain('display:none;max-height:0');
        expect(html).toContain('Hello, welcome to Jawab24.');
    });

    describe('HTML escaping', () => {
        it('should escape < > & in subject', () => {
            const html = waitlistEmailTemplate({
                ...baseParams,
                subject: 'Sale <50% & more>',
            });

            expect(html).toContain('<title>Sale &lt;50% &amp; more&gt;</title>');
            expect(html).not.toContain('<title>Sale <50%');
        });

        it('should escape < > & in body', () => {
            const html = waitlistEmailTemplate({
                ...baseParams,
                body: 'Use <script>alert("xss")</script> tag',
            });

            expect(html).toContain('&lt;script&gt;alert');
            expect(html).not.toContain('<script>');
        });
    });

    describe('newline handling', () => {
        it('should convert newlines to <br> tags', () => {
            const html = waitlistEmailTemplate({
                ...baseParams,
                body: 'Line one\nLine two\nLine three',
            });

            expect(html).toContain('Line one<br>Line two<br>Line three');
        });
    });

    describe('RTL detection', () => {
        it('should set dir="ltr" and lang="en" for English content', () => {
            const html = waitlistEmailTemplate(baseParams);

            expect(html).toContain('lang="en"');
            expect(html).toContain('dir="ltr"');
            expect(html).toContain('text-align:left');
        });

        it('should set dir="rtl" and lang="ar" for Arabic content', () => {
            const html = waitlistEmailTemplate({
                ...baseParams,
                subject: 'مرحبا',
                body: 'مرحبا بك في جواب ٢٤، نحن سعداء بانضمامك',
            });

            expect(html).toContain('lang="ar"');
            expect(html).toContain('dir="rtl"');
            expect(html).toContain('text-align:right');
        });

        it('should use Arabic font stack for RTL content', () => {
            const html = waitlistEmailTemplate({
                ...baseParams,
                body: 'مرحبا بك في جواب ٢٤، نحن سعداء بانضمامك',
            });

            expect(html).toContain("'Cairo'");
            expect(html).toContain("'Tajawal'");
        });

        it('should use system font stack for LTR content', () => {
            const html = waitlistEmailTemplate(baseParams);

            expect(html).not.toContain("'Cairo'");
            expect(html).toContain('BlinkMacSystemFont');
        });

        it('should detect RTL for mixed content with >30% Arabic chars', () => {
            // ~40% Arabic characters
            const html = waitlistEmailTemplate({
                ...baseParams,
                body: 'مرحبا Hello مرحبا Hi there',
            });

            expect(html).toContain('dir="rtl"');
        });

        it('should detect LTR for mixed content with <30% Arabic chars', () => {
            // Mostly English with a few Arabic words
            const html = waitlistEmailTemplate({
                ...baseParams,
                body: 'Hello world, this is a long English sentence with only مرحبا included.',
            });

            expect(html).toContain('dir="ltr"');
        });
    });

    describe('unsubscribe label', () => {
        it('should show English unsubscribe for LTR content', () => {
            const html = waitlistEmailTemplate(baseParams);

            expect(html).toContain('Unsubscribe');
        });

        it('should show Arabic unsubscribe for RTL content', () => {
            const html = waitlistEmailTemplate({
                ...baseParams,
                body: 'مرحبا بك في جواب ٢٤، نحن سعداء بانضمامك',
            });

            expect(html).toContain('إلغاء الاشتراك');
        });
    });

    describe('email structure', () => {
        it('should use table-based layout for email client compatibility', () => {
            const html = waitlistEmailTemplate(baseParams);

            expect(html).toContain('role="presentation"');
            expect(html).toContain('cellpadding="0"');
            expect(html).toContain('cellspacing="0"');
        });

        it('should include brand-colored header', () => {
            const html = waitlistEmailTemplate(baseParams);

            // Teal brand color
            expect(html).toContain('background-color:#0d9488');
        });

        it('should set max-width 600px for email content', () => {
            const html = waitlistEmailTemplate(baseParams);

            expect(html).toContain('max-width:600px');
        });

        it('should include dir="auto" on body cell', () => {
            const html = waitlistEmailTemplate(baseParams);

            expect(html).toContain('dir="auto"');
        });
    });
});
