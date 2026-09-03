import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BusinessFactRows } from '@/components/business/BusinessFactRows';
import type { Page } from '@jawab24/shared';
import { businessPage as makePage, businessPageFbSynced } from '@/utils/__tests__/businessPageFixture';

/**
 * Every fact VALUE must be bidi-isolated from the row it sits in.
 *
 * WHY: a phone number, a URL with a trailing slash and an hours range are each
 * SEVERAL directional runs joined by neutrals (spaces, "-", "/"). In the Arabic
 * dashboard the paragraph is RTL, so those neutrals take the RTL level (UBA N1 —
 * numbers act as R for neutral resolution) and the runs are painted
 * right-to-left. Shipped symptom, all three visible in one screenshot of the
 * Arabic Business facts list:
 *
 *     +46 70 022 47 20      painted as   20 47 022 70 46+
 *     https://jawab24.com/  painted as   /https://jawab24.com
 *     00:00-23:59           painted as   23:59-00:00
 *
 * The merchant typed the value correctly and the database holds it correctly;
 * only the painting was wrong — which is why it survived every existing test.
 *
 * ⚠️ jsdom performs NO bidi layout, so these tests assert the ISOLATION ELEMENT,
 * never the painted order. The painted order was verified in real Chrome
 * (before/after, all three rows) when this fix landed; a unit test cannot do it.
 * If you change the isolation mechanism, re-verify in a real browser — a green
 * run here proves only that the value is wrapped.
 *
 * Mutation checks (each must turn one of these red):
 *   - replace <bdi> with <span> around p.number
 *   - drop the <bdi> around row.value
 *   - drop the <bdi> around the Facebook-suggested value
 */

function renderRows(page: Page) {
  return render(<BusinessFactRows page={page} onEditFact={vi.fn()} onEditHours={vi.fn()} />);
}

function row(label: string): HTMLElement {
  const li = screen.getByText(label).closest('li');
  if (!li) throw new Error(`no row for ${label}`);
  return li as HTMLElement;
}

/** The value must be inside a <bdi>, not merely present in the row. */
function expectIsolated(rowEl: HTMLElement, value: string) {
  const isolates = Array.from(rowEl.querySelectorAll('bdi'));
  expect(
    isolates.some((b) => b.textContent === value),
    `"${value}" is not wrapped in <bdi> — it will paint right-to-left in the Arabic dashboard`,
  ).toBe(true);
}

describe('BusinessFactRows — bidi isolation of fact values', () => {
  it('isolates a multi-run phone number', () => {
    renderRows(makePage({ phones: ['+46 70 022 47 20'] }));
    expectIsolated(row('Phone'), '+46 70 022 47 20');
  });

  it('isolates each number when several are listed', () => {
    // Unisolated, the ENTRIES reorder relative to each other too, not just the
    // digit groups inside one of them.
    renderRows(makePage({ phones: ['+46 70 022 47 20', '0912345678'] }));
    const phone = row('Phone');
    expectIsolated(phone, '+46 70 022 47 20');
    expectIsolated(phone, '0912345678');
  });

  it('isolates a URL, whose trailing slash otherwise jumps to the front', () => {
    renderRows(makePage({ website: 'https://jawab24.com/' }));
    expectIsolated(row('Website'), 'https://jawab24.com/');
  });

  it('isolates an hours range', () => {
    renderRows(makePage({ hours: { sat: ['00:00-23:59'] } }));
    const hours = row('Working hours');
    expect(hours.querySelectorAll('bdi').length).toBeGreaterThan(0);
  });

  it('isolates an Arabic value too — <bdi> resolves direction per value', () => {
    // bdi is dir="auto" over its own contents, so Arabic prose still renders
    // RTL. The isolation is not an LTR override.
    renderRows(makePage({ address: 'دمشق، البرامكة' }));
    expectIsolated(row('Address'), 'دمشق، البرامكة');
  });

  it('isolates the unreviewed Facebook value, without isolating the sentence', () => {
    // Wrapping the whole "From your Facebook Page: <value>" sentence would
    // resolve RTL from its first Arabic word and leave the value's runs
    // reordered inside it — so only the VALUE carries the isolate.
    renderRows(businessPageFbSynced({ website: 'https://jawab24.com/' }));
    const website = row('Website');
    const isolates = Array.from(website.querySelectorAll('bdi'));
    expect(isolates.some((b) => b.textContent === 'https://jawab24.com/')).toBe(true);
    // The sentence itself is not the isolated node.
    expect(isolates.every((b) => !b.textContent?.includes('Facebook'))).toBe(true);
  });

  it('does not force a direction on the row, only isolate the value', () => {
    // dir="auto"/"ltr" on the BLOCK would left-align the whole row in an RTL
    // page — the regression that dropping dir="auto" was protecting against.
    renderRows(makePage({ phones: ['+46 70 022 47 20'] }));
    const phone = row('Phone');
    const bdi = Array.from(phone.querySelectorAll('bdi'))
      .find((b) => b.textContent === '+46 70 022 47 20')!;
    const block = bdi.closest('span.block');
    expect(block?.getAttribute('dir')).toBeNull();
  });
});
