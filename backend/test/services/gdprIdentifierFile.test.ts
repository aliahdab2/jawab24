import { describe, it, expect } from 'vitest';
import { parseMetaIdentifierIds } from '../../src/services/gdprIdentifierFile';

/**
 * These ids decide whose personal data gets deleted. A parser bug is silent in
 * both directions: drop an id and we stay non-compliant, invent one and we delete
 * a customer who never asked. Every branch is pinned.
 *
 * Ids below are synthetic, shaped like real Meta app-/page-scoped ids.
 */
const A = '17841444521380298';
const B = '122163635846667034';
const C = '26440088459025937';
/** UTF-8 BOM — present at byte 0 of every real Meta export. */
const BOM = '\uFEFF';

describe('parseMetaIdentifierIds', () => {
    describe('CSV / TXT', () => {
        it('parses one id per line', () => {
            expect(parseMetaIdentifierIds(`${A}\n${B}\n${C}`).sort()).toEqual([A, B, C].sort());
        });

        it('parses comma-separated ids', () => {
            expect(parseMetaIdentifierIds(`${A},${B}`).sort()).toEqual([A, B].sort());
        });

        it('handles CRLF line endings', () => {
            expect(parseMetaIdentifierIds(`${A}\r\n${B}\r\n`).sort()).toEqual([A, B].sort());
        });

        it('strips surrounding quotes', () => {
            expect(parseMetaIdentifierIds(`"${A}"\n'${B}'`).sort()).toEqual([A, B].sort());
        });

        it('skips a header row', () => {
            expect(parseMetaIdentifierIds(`user_id\n${A}`)).toEqual([A]);
        });

        it('dedupes ids repeated within a file', () => {
            expect(parseMetaIdentifierIds(`${A}\n${A}\n${B}`).sort()).toEqual([A, B].sort());
        });

        it('ignores non-numeric and too-short tokens', () => {
            expect(parseMetaIdentifierIds(`abc\n1234\n${A}\n-\n`)).toEqual([A]);
        });

        it('returns an empty list for an empty file', () => {
            expect(parseMetaIdentifierIds('')).toEqual([]);
            expect(parseMetaIdentifierIds('   \n\n')).toEqual([]);
        });
    });

    describe('UTF-8 BOM', () => {
        // Meta's real exports are UTF-8 WITH a BOM, so the first id arrives
        // prefixed by U+FEFF. If normalization ever stops stripping it, the FIRST
        // deletion request of every file is silently skipped — invisible, because
        // the file still parses and the run still reports success.
        it('does not drop the first id of a BOM-prefixed file', () => {
            const withBom = `${BOM}${A}\n${B}`;
            expect(parseMetaIdentifierIds(withBom).sort()).toEqual([A, B].sort());
        });

        it('yields the same ids with and without the BOM', () => {
            expect(parseMetaIdentifierIds(`${BOM}${A}\n${B}`).sort())
                .toEqual(parseMetaIdentifierIds(`${A}\n${B}`).sort());
        });
    });

    describe('JSON', () => {
        it('parses an array of strings', () => {
            expect(parseMetaIdentifierIds(JSON.stringify([A, B])).sort()).toEqual([A, B].sort());
        });

        it('parses an array of numbers', () => {
            expect(parseMetaIdentifierIds('[123456789]')).toEqual(['123456789']);
        });

        it.each(['id', 'user_id', 'asid', 'psid', 'identifier'])(
            'parses an array of objects keyed by %s',
            (key) => {
                expect(parseMetaIdentifierIds(JSON.stringify([{ [key]: A }]))).toEqual([A]);
            },
        );

        it('parses a { data: [...] } envelope', () => {
            expect(parseMetaIdentifierIds(JSON.stringify({ data: [A, B] })).sort()).toEqual([A, B].sort());
        });

        it('ignores objects with no id-like field', () => {
            expect(parseMetaIdentifierIds(JSON.stringify([{ name: 'x' }, { id: A }]))).toEqual([A]);
        });

        it('falls back to CSV when a bracketed file is not valid JSON', () => {
            expect(parseMetaIdentifierIds(`[broken\n${A}`)).toEqual([A]);
        });
    });

    describe('multi-file batches must be parsed separately', () => {
        // Meta sends one file per alert. Both real exports (2026-06-28, 2026-07-11)
        // end WITHOUT a trailing newline, so `cat a.csv b.csv` welds a's last id to
        // b's first — the merged token fails the numeric test and TWO real deletion
        // requests vanish with no error. This is why the script takes a file LIST
        // rather than one pre-concatenated file.
        const fileA = `${A}\n${B}`;        // no trailing newline, as Meta ships it
        const fileB = `${BOM}${C}`;        // BOM, as Meta ships it

        it('finds every id when each file is parsed on its own', () => {
            const ids = new Set([...parseMetaIdentifierIds(fileA), ...parseMetaIdentifierIds(fileB)]);
            expect([...ids].sort()).toEqual([A, B, C].sort());
        });

        it('loses ids when the files are naively concatenated', () => {
            const welded = parseMetaIdentifierIds(fileA + fileB);
            expect(welded).not.toContain(B);
            expect(welded).not.toContain(C);
            expect(welded).toEqual([A]);
        });

        it('is safe when the files are joined with a newline', () => {
            expect(parseMetaIdentifierIds(`${fileA}\n${fileB}`).sort()).toEqual([A, B, C].sort());
        });
    });
});
