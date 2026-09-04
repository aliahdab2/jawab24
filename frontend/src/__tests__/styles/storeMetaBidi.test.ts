import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The connected-store card's «آخر مزامنة» timestamp must be bidi-isolated and
 * formatted in the APP's locale.
 *
 * Reported 2026-09-04 from the Arabic dashboard at /integrations, while shooting
 * the Salla App Store listing gallery. One line carried two defects:
 *
 *   toLocaleString(undefined, …)  formats in the BROWSER's locale, so the Arabic
 *                                 store card printed «4 Sept 2026, 00:22» in English
 *   the value sat bare in RTL     a formatted date-time is several runs joined by
 *                                 neutrals («4», «Sept», «2026», «00:22»); in an RTL
 *                                 paragraph the neutrals take the RTL level, so the
 *                                 runs paint right-to-left and the label's colon
 *                                 lands on the wrong side
 *
 * Same class as the Business facts list (BusinessFactRows.bidi.test.tsx) and the
 * same fix: an inline <bdi> around the VALUE plus an explicit Intl locale.
 *
 * These are SOURCE pins. jsdom performs NO bidi layout, so the painted order
 * cannot be re-measured here — it was verified before and after in real Chrome on
 * the Arabic /integrations page. What can be pinned is the mechanism.
 *
 * Mutation checks (each must turn one of these red):
 *   - drop the <bdi> around the lastSync value
 *   - pass `undefined` instead of `intlLocale` to formatTimestampDateTime
 *
 * The BROWSER-LOCALE half of this defect is pinned repo-wide in
 * localeDateFormatting.test.ts — reviewing this fix found the same defect in
 * LegalPageLayout and what-is-jawab24, which a single-file pin cannot see. What
 * stays here is what is specific to this line: the <bdi>, and that the formatting
 * goes through the shared dateUtils helper rather than a hand-rolled
 * `new Date(...).toLocaleString(...)` that drops its null/NaN fallback.
 */

const SOURCE = 'pages/integrations.tsx';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');

/** Comments quote the very shapes these tests forbid — strip them first. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('connected-store card meta line', () => {
  it('isolates the last-sync timestamp in a <bdi>', () => {
    const src = code(SOURCE);
    const at = src.indexOf("{t('lastSync')}");
    expect(at, 'the lastSync label is gone — this pin needs re-aiming').toBeGreaterThanOrEqual(0);
    const isolate = src.slice(at, src.indexOf('</p>', at));
    expect(
      /<bdi>[\s\S]*lastSyncAt[\s\S]*<\/bdi>/.test(isolate),
      'the last-sync timestamp is not wrapped in <bdi> — it will paint right-to-left in the Arabic store card',
    ).toBe(true);
  });

  it('formats the timestamp through dateUtils, in the app locale', () => {
    const src = code(SOURCE);
    expect(
      src,
      'the last-sync line no longer calls formatTimestampDateTime — a hand-rolled ' +
        'new Date(...).toLocaleString(...) loses the null/NaN fallback and renders "Invalid Date"',
    ).toContain('formatTimestampDateTime(store.lastSyncAt, intlLocale');
  });
});
