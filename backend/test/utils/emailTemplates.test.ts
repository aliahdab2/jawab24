import { describe, it, expect } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        resend: {
            fromName: 'Jawab24 Test',
            fromEmail: 'info@jawab24.com',
            replyToEmail: '',
        },
    },
}));

import { waitlistEmailTemplate, inviteEmailTemplate } from '../../src/utils/emailTemplates';
import { config } from '../../src/config';

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

        it('should lead with the logo lockup rather than a coloured bar', () => {
            const html = waitlistEmailTemplate(baseParams);

            // The header is the logo mark plus the wordmark on a white card. The
            // old solid teal band is gone; teal survives only on the CTA and the
            // callout edge, so asserting the colour alone would pass either way.
            expect(html).toContain('/brand/logo-small.png');
            expect(html).toContain('width="34" height="34"');
            expect(html).not.toContain('background-color:#0d9488;padding:24px 32px');
        });

        it('should declare dark-mode support', () => {
            const html = waitlistEmailTemplate(baseParams);

            expect(html).toContain('name="color-scheme"');
            expect(html).toContain('prefers-color-scheme: dark');
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

describe('inviteEmailTemplate', () => {
    const params = {
        workspaceName: 'Acme Co',
        inviteUrl: 'https://jawab24.com/invites/accept?token=tok123',
    };

    it('should return a subject and a valid HTML document', () => {
        const { subject, html } = inviteEmailTemplate(params);

        expect(subject).toBeTruthy();
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('</html>');
    });

    it('should include the workspace name in both subject and body', () => {
        const { subject, html } = inviteEmailTemplate(params);

        expect(subject).toContain('Acme Co');
        expect(html).toContain('Acme Co');
    });

    it('should be bilingual — render both Arabic and English content', () => {
        const { subject, html } = inviteEmailTemplate(params);

        // English heading + Arabic heading both present
        expect(html).toContain("You've been invited");
        expect(html).toContain('لديك دعوة');
        // Both direction blocks are rendered
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('dir="ltr"');
        // Bilingual subject pieces (AR | EN) both carry the product name
        expect(subject).toContain('Jawab24');
    });

    it('should link the CTA to the accept URL', () => {
        const { html } = inviteEmailTemplate(params);

        expect(html).toContain('href="https://jawab24.com/invites/accept?token=tok123"');
    });

    it('should HTML-escape the workspace name', () => {
        const { html } = inviteEmailTemplate({ ...params, workspaceName: 'Tom & <Jerry>' });

        expect(html).toContain('Tom &amp; &lt;Jerry&gt;');
        expect(html).not.toContain('<Jerry>');
    });

    it('should include the brand name and brand-colored header', () => {
        const { html } = inviteEmailTemplate(params);

        expect(html).toContain('Jawab24 Test'); // from mocked config.resend.fromName
        expect(html).toContain('background-color:#0d9488');
    });

    it('should render a workspace name containing $-replacement patterns literally', () => {
        // Regression: String.replace/replaceAll interpret `$&`, `$\``, `$'`, `$$`
        // in a replacement STRING. A workspace name like "Acme $& Co" must not
        // corrupt the email or leak the literal {workspace} placeholder.
        const { subject, html } = inviteEmailTemplate({ workspaceName: 'Acme $& Co', inviteUrl: 'https://jawab24.com/invites/accept?token=t' });

        expect(html).not.toContain('{workspace}');       // placeholder fully substituted
        expect(html).toContain('Acme $&amp; Co');        // body intro: & escaped, $& kept literal
        expect(subject).toContain('Acme $& Co');         // subject: raw name, $& kept literal
    });
});

describe('shared footer', () => {
    const params = { workspaceName: 'Acme', inviteUrl: 'https://jawab24.com/invites/accept?token=t' };

    it('prints the Reply-To address when one is configured', () => {
        config.resend.replyToEmail = 'support@jawab24.com';

        try {
            const { html } = inviteEmailTemplate(params);

            // The printed address and the reply_to header come from the same
            // value, so what a merchant reads is where their reply lands.
            expect(html).toContain('mailto:support@jawab24.com');
        } finally {
            config.resend.replyToEmail = '';
        }
    });

    it('falls back to the From address when no Reply-To is set', () => {
        const { html } = inviteEmailTemplate(params);

        expect(html).toContain('mailto:info@jawab24.com');
    });

    it('escapes the configured address into the mailto and the text node', () => {
        // config is trusted, but it is an env file a human edits, and the value
        // lands in an href attribute as well as a text node.
        config.resend.replyToEmail = 'a"b@jawab24.com';

        try {
            const { html } = inviteEmailTemplate(params);

            expect(html).toContain('mailto:a&quot;b@jawab24.com');
            expect(html).not.toContain('mailto:a"b@');
        } finally {
            config.resend.replyToEmail = '';
        }
    });
});
