import { describe, it, expect } from 'vitest';
import { buildFacebookMentionToken, prefixMention, mentionRendered, renderedTagIdMismatch } from '../../src/utils/commentMention';
import { pickNudgeVariation, NUDGE_MAX_LENGTH } from '../../src/services/reply/nudge';

describe('commentMention', () => {
    describe('buildFacebookMentionToken', () => {
        it('builds the Graph mention syntax for a PSID', () => {
            expect(buildFacebookMentionToken('1784123456789')).toBe('@[1784123456789]');
        });

        it('trims surrounding whitespace before validating', () => {
            expect(buildFacebookMentionToken('  1784123456789 ')).toBe('@[1784123456789]');
        });

        // Every rejection below would otherwise publish raw text on the merchant's page.
        it.each([
            ['missing', undefined],
            ['null', null],
            ['empty', ''],
            ['non-numeric', 'user_456'],
            ['too short', '123'],
            ['injection attempt', '123456] hi @[999999'],
            ['decimal', '17841234.5'],
        ])('returns null for a %s id', (_label, value) => {
            expect(buildFacebookMentionToken(value as string | null | undefined)).toBeNull();
        });
    });

    describe('prefixMention', () => {
        it('puts the mention first, separated by one space', () => {
            expect(prefixMention('@[123456]', 'أرسلنا لك التفاصيل بالخاص')).toBe('@[123456] أرسلنا لك التفاصيل بالخاص');
        });

        it('returns the text untouched when there is no token', () => {
            expect(prefixMention(null, 'أرسلنا لك التفاصيل')).toBe('أرسلنا لك التفاصيل');
        });

        it('never emits a trailing space when the text is empty', () => {
            expect(prefixMention('@[123456]', '   ')).toBe('@[123456]');
        });

        // The regression this ordering exists for: pickNudgeVariation slices to
        // NUDGE_MAX_LENGTH. Prefixing BEFORE that slice could cut the token in half and
        // publish a literal `@[1784` in front of customers.
        it('survives the nudge length cap — the token is never truncated', () => {
            const longNudge = 'ن'.repeat(NUDGE_MAX_LENGTH + 40);
            const truncated = pickNudgeVariation({ ar: [longNudge] }, 'ar');
            const result = prefixMention(buildFacebookMentionToken('1784123456789'), truncated);

            expect(truncated.length).toBe(NUDGE_MAX_LENGTH);
            expect(result.startsWith('@[1784123456789] ')).toBe(true);
            expect(result).not.toMatch(/@\[\d*$/);
        });
    });

    describe('mentionRendered', () => {
        const psid = '1784123456789';

        it('is true when Facebook returned a user tag', () => {
            expect(mentionRendered([{ id: psid, type: 'user' }])).toBe(true);
        });

        it('is false when nothing rendered (the stripped-token failure)', () => {
            expect(mentionRendered([])).toBe(false);
            expect(mentionRendered(null)).toBe(false);
            expect(mentionRendered(undefined)).toBe(false);
        });

        it('is false when the only tag is a page, not a person', () => {
            expect(mentionRendered([{ id: '878802365317875', type: 'page' }])).toBe(false);
        });

        // The asymmetry that drove this design: requiring `tag.id === psid` would read a
        // differently-scoped echo as failure, and the caller would then STRIP a mention that
        // worked — on every reply, on every page. Presence is the safe side.
        it('is true even when Facebook echoes a different id for the tagged person', () => {
            expect(mentionRendered([{ id: '999999999999', type: 'user' }])).toBe(true);
        });
    });

    describe('renderedTagIdMismatch', () => {
        const psid = '1784123456789';

        it('reports the echoed id when it differs from the one we sent', () => {
            expect(renderedTagIdMismatch([{ id: '999999999999', type: 'user' }], psid)).toBe('999999999999');
        });

        it('is null when the ids agree', () => {
            expect(renderedTagIdMismatch([{ id: psid, type: 'user' }], psid)).toBeNull();
        });

        it('is null when nothing rendered', () => {
            expect(renderedTagIdMismatch([], psid)).toBeNull();
        });
    });
});
