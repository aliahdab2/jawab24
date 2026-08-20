import { describe, it, expect } from 'vitest';
import { htmlToPlainText, stripHtml } from '../../src/utils/htmlUtils';

describe('htmlToPlainText', () => {
    it('keeps a link destination alongside its label', () => {
        // The regression this function exists to survive. The first draft wrote
        // `label <href>` inline and stripped tags afterwards, so the stripper
        // ate the angle brackets it had just written and every URL vanished.
        const text = htmlToPlainText('<p>Ready? <a href="https://jawab24.com/en/pricing">Choose a plan</a></p>');

        expect(text).toBe('Ready? Choose a plan <https://jawab24.com/en/pricing>');
    });

    it('prints a link once when its label already is the destination', () => {
        const text = htmlToPlainText('<p>Write to <a href="mailto:support@jawab24.com">support@jawab24.com</a></p>');

        expect(text).toBe('Write to support@jawab24.com');
    });

    it('keeps every destination when a message carries several links', () => {
        const text = htmlToPlainText(
            '<p><a href="https://a.example">First</a></p><p><a href="https://b.example">Second</a></p>',
        );

        expect(text).toContain('First <https://a.example>');
        expect(text).toContain('Second <https://b.example>');
    });

    it('turns block elements into line breaks instead of spaces', () => {
        const text = htmlToPlainText('<h1>Heading</h1><p>One.</p><p>Two.</p>');

        expect(text).toBe('Heading\n\nOne.\n\nTwo.');
    });

    it('renders list items as bullets', () => {
        const text = htmlToPlainText('<ul><li>Alpha</li><li>Beta</li></ul>');

        expect(text).toContain('• Alpha');
        expect(text).toContain('• Beta');
    });

    it('drops the hidden preheader, which merely repeats the opening line', () => {
        const text = htmlToPlainText(
            '<div style="display:none;max-height:0;">Preview line</div><p>Real body.</p>',
        );

        expect(text).toBe('Real body.');
    });

    it('drops style and script blocks entirely', () => {
        const text = htmlToPlainText('<style>.card { color: red; }</style><p>Body.</p>');

        expect(text).toBe('Body.');
    });

    it('decodes the entities our templates emit', () => {
        const text = htmlToPlainText('<p>Jawab24 &middot; a &mdash; b &amp; c</p>');

        expect(text).toBe('Jawab24 · a — b & c');
    });

    it('collapses runs of blank lines left by nested tables', () => {
        const text = htmlToPlainText('<table><tr><td><p>A</p></td></tr></table><p>B</p>');

        expect(text).not.toMatch(/\n{3,}/);
        expect(text).toBe('A\n\nB');
    });

    it('preserves RTL content unchanged', () => {
        const text = htmlToPlainText('<p>مرحبا بك في جواب24</p>');

        expect(text).toBe('مرحبا بك في جواب24');
    });
});

describe('stripHtml', () => {
    it('still collapses everything onto one line for product blurbs', () => {
        // Unchanged contract — the e-commerce importers depend on it.
        expect(stripHtml('<p>One.</p>\n<p>Two.</p>')).toBe('One. Two.');
    });

    it('resolves a double-encoded entity the same way it always did', () => {
        expect(stripHtml('<p>&amp;lt;b&amp;gt;</p>')).toBe('<b>');
    });
});
