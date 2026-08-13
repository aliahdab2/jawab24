import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { BusinessFactRows } from '@/components/business/BusinessFactRows';
import { BusinessReadinessCard } from '@/components/business/BusinessReadinessCard';
import type { Page } from '@jawab24/shared';
import { businessPage as makePage, businessPageFbSynced } from '@/utils/__tests__/businessPageFixture';


function renderRows(page: Page) {
  return render(<BusinessFactRows page={page} onEditFact={vi.fn()} onEditHours={vi.fn()} />);
}

/** The row whose field name is `label`, within `scope`. */
function row(label: string, scope: HTMLElement = document.body): HTMLElement {
  const li = within(scope).getByText(label).closest('li');
  if (!li) throw new Error(`no row for ${label}`);
  return li as HTMLElement;
}

const FILLED = {
  hours: { sat: ['09:00-19:00'] },
  address: 'دمشق، البرامكة',
  phones: ['0912345678'],
  policies: { shipping: 'توصيل داخل دمشق', payment: 'نقداً' },
  website: 'example.com',
};

/**
 * State on these rows used to be carried by COLOUR alone (brand teal for set,
 * muted for empty), which fails WCAG 1.4.1 Use of Colour. The badge is the
 * non-colour carrier and the legend is what makes the two dot colours legible.
 */
describe('BusinessFactRows — state badges', () => {
  it('badges every row, and the badge text (not just a colour) carries the state', () => {
    renderRows(makePage(FILLED));
    expect(screen.getAllByText('Complete')).toHaveLength(6);
    expect(screen.queryByText('Missing')).not.toBeInTheDocument();
  });

  // Only SCORED facts read Missing. Phone, website and email sit outside
  // READINESS_AREAS, and an amber «ناقص» on a row the counter ignores is the
  // two-scoreboards contradiction this module family exists to prevent — those
  // rows read a neutral Optional instead.
  it('marks empty scored facts Missing and unscored ones Optional', () => {
    renderRows(makePage());
    expect(screen.getAllByText('Missing')).toHaveLength(4);
    expect(screen.getAllByText('Optional')).toHaveLength(3);
    expect(within(row('Phone')).getByText('Optional')).toBeInTheDocument();
    expect(within(row('Website')).getByText('Optional')).toBeInTheDocument();
    expect(within(row('Email')).getByText('Optional')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('a filled unscored fact reads Complete like any other', () => {
    renderRows(makePage({ website: 'example.com' }));
    expect(within(row('Website')).getByText('Complete')).toBeInTheDocument();
  });

  it('badges per row, not in bulk', () => {
    renderRows(makePage({ hours: FILLED.hours }));
    expect(within(row('Working hours')).getByText('Complete')).toBeInTheDocument();
    expect(within(row('Address')).getByText('Missing')).toBeInTheDocument();
  });

  it('explains all three dot colours in a legend', () => {
    renderRows(makePage());
    expect(screen.getByText('Complete — Jawab uses it')).toBeInTheDocument();
    expect(screen.getByText('Missing — needs your input')).toBeInTheDocument();
    expect(screen.getByText('Optional — add it if you have one')).toBeInTheDocument();
  });

  // Any listed number can be on WhatsApp — the mark is per-number, not a
  // single exclusive flag (legacy single-string storage still renders).
  it('marks every WhatsApp number, not just one', () => {
    renderRows(makePage({
      phones: ['0911111111', '0922222222'],
      channels: { whatsapp: ['0911111111', '0922222222'] },
    }));
    expect(within(row('Phone')).getAllByLabelText('WhatsApp')).toHaveLength(2);
  });

  // An unconfirmed Facebook-synced value must be VISIBLE but never settled:
  // MES's stale UAE phone sat hidden in the profile until an unrelated save
  // laundered it into replies (2026-08-08). The row now shows the value,
  // names its origin, and asks for review.
  it('shows an fb_sync value as «Needs review» with its origin, never as Complete', () => {
    renderRows(businessPageFbSynced({ phones: ['+971556087128'] }));
    const phoneRow = row('Phone');
    expect(within(phoneRow).getByText('Needs review')).toBeInTheDocument();
    expect(within(phoneRow).getByText(/From your Facebook Page/)).toBeInTheDocument();
    expect(within(phoneRow).getByText(/\+971556087128/)).toBeInTheDocument();
    expect(within(phoneRow).queryByText('Complete')).not.toBeInTheDocument();
    expect(within(phoneRow).getByText('Review')).toBeInTheDocument();
  });

  // A store-answered fact is not a gap: the store's policiesSummary reaches
  // every reply, so nagging would ask the merchant to re-type what we hold.
  it('counts a store-answered policy as Complete', () => {
    renderRows(makePage({}, { ecommerceStoreId: 's1', storeAnswersPolicies: true } as Partial<Page>));
    expect(within(row('Delivery')).getByText('Complete')).toBeInTheDocument();
    expect(within(row('Delivery')).getByText('Answered by your connected store')).toBeInTheDocument();
  });
});

/**
 * The mock puts the action in a ~70px button at the row end. It is rendered as a
 * <span>, not a <button>: a nested button is invalid HTML, and it would shrink
 * the 56px full-width tap target down to 70px on the viewport where the target
 * matters most (the owner mis-tapped the previous 19×16px link immediately).
 */
describe('BusinessFactRows — action affordance', () => {
  it('keeps the WHOLE row as the single tap target', () => {
    renderRows(makePage(FILLED));
    // One control per row — the "Edit" pill must not be a second one.
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(within(row('Address')).getByRole('button')).toHaveClass('w-full');
  });

  it('opens the field editor from the pill as well as the rest of the row', () => {
    const onEditFact = vi.fn();
    render(<BusinessFactRows page={makePage(FILLED)} onEditFact={onEditFact} onEditHours={vi.fn()} />);
    fireEvent.click(within(row('Website')).getByText('Edit'));
    expect(onEditFact).toHaveBeenCalledWith('website');
  });

  it('says Edit for a saved fact and Add for an empty one', () => {
    renderRows(makePage({ hours: FILLED.hours }));
    expect(within(row('Working hours')).getByText('Edit')).toBeInTheDocument();
    expect(within(row('Address')).getByText('Add')).toBeInTheDocument();
  });

  it('names the field, its state, its value and the action in one accessible name', () => {
    renderRows(makePage({ address: 'دمشق، البرامكة' }));
    const name = within(row('Address')).getByRole('button').textContent ?? '';
    for (const part of ['Address', 'Complete', 'دمشق، البرامكة', 'Edit']) {
      expect(name).toContain(part);
    }
  });
});

/**
 * THE constraint behind the shared `computeBusinessCoverage` module: the ring and
 * the badges are two readings of one truth. The mock that started this work had a
 * 60% ring above a list where 4 of 6 rows read "complete" — two scoreboards
 * disagreeing on one screen, and a merchant who fills a field and watches one
 * surface ignore it stops believing either.
 */
describe('the readiness ring and the fact badges agree', () => {
  /**
   * Chip label → row field name. Deliberately DIFFERENT words for the same field
   * («Payment» vs «Payment methods»), which is why the states have to be compared
   * rather than assumed from the labels.
   */
  const SHARED_FIELDS: ReadonlyArray<[chip: string, row: string]> = [
    ['Working hours', 'Working hours'],
    ['Address', 'Address'],
    ['Delivery', 'Delivery'],
    ['Payment', 'Payment methods'],
  ];

  it.each([
    ['an empty profile', makePage()],
    ['a half-filled profile', makePage({ hours: FILLED.hours, policies: { payment: 'نقداً' } })],
    ['a city-only address', makePage({ city: 'دمشق' })],
    ['a store id with no synced policies', makePage({}, { ecommerceStoreId: 's1' } as Partial<Page>)],
    ['a policy-answering store', makePage({}, { ecommerceStoreId: 's1', storeAnswersPolicies: true } as Partial<Page>)],
  ])('reports the same state for every shared field — %s', (_name, page) => {
    render(
      <>
        <div data-testid="ring">
          <BusinessReadinessCard page={page} productsCount={0} onTryReply={vi.fn()} onFixChip={vi.fn()} />
        </div>
        <div data-testid="rows">
          <BusinessFactRows page={page} onEditFact={vi.fn()} onEditHours={vi.fn()} />
        </div>
      </>,
    );
    const ring = screen.getByTestId('ring');
    const rows = screen.getByTestId('rows');

    for (const [chipLabel, rowLabel] of SHARED_FIELDS) {
      // The chip carries its state as sr-only text: "— Complete" / "— Missing".
      const chipText = row(chipLabel, ring).textContent ?? '';
      const chipState = /Missing/.test(chipText) ? 'Missing' : 'Complete';
      const rowState = within(row(rowLabel, rows)).getByText(/^(Complete|Missing)$/).textContent;
      expect(rowState, `${rowLabel} row vs ${chipLabel} chip`).toBe(chipState);
    }
  });
});
