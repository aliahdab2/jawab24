/**
 * The other three write surfaces on /business — the catalog rows, the fact
 * rows and the fact lists — follow the SAME rule as Business Info: everyone
 * reads, only owner/admin writes. Their endpoints already did
 * (`routes/catalog.ts` and `routes/factCollections.ts` are both
 * `requireRole('admin')`); until this change the UI did not, so a member could
 * tap a price, type, and collect a 403 — on the very page whose Business Info
 * panel says "Only admins can make changes".
 *
 * These are component-level: `readOnly` is what /business threads into all
 * three from one `canEdit`, so pinning the components pins the page.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { CatalogItem, Page } from '@jawab24/shared';
import businessEn from '@/i18n/en/business.json';
import catalogEn from '@/i18n/en/catalog.json';
import { BusinessFactRows } from './BusinessFactRows';
import { CatalogItemRow } from '../catalog/CatalogItemRow';

const noop = () => {};

function page(): Page {
  return {
    id: 'page-1',
    name: 'Test Page',
    businessProfile: { merchant: { address: 'شارع الجمهورية، طرابلس' } },
  } as unknown as Page;
}

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'item-1',
    name: 'عطر التوتيان',
    price: '119',
    currency: 'LYD',
    isAvailable: true,
    type: 'product',
    sortOrder: 0,
    ...overrides,
  } as CatalogItem;
}

function renderRow(readOnly: boolean, catalogItem = item()) {
  return render(
    <ul>
      <CatalogItemRow
        item={catalogItem}
        isFirst
        isLast
        disabled={false}
        onEdit={noop}
        onDelete={noop}
        onMove={noop}
        onToggleAvailability={noop}
        onSavePrice={noop}
        readOnly={readOnly}
      />
    </ul>,
  );
}

describe('BusinessFactRows — view-only', () => {
  it('member: rows keep their value and badge but stop being tap targets', () => {
    const onEditFact = vi.fn();
    render(<BusinessFactRows page={page()} onEditFact={onEditFact} onEditHours={noop} readOnly />);

    // The information survives — coverage is the same question for everyone.
    expect(screen.getByText('شارع الجمهورية، طرابلس')).toBeInTheDocument();
    expect(screen.getAllByText(businessEn.state.missing).length).toBeGreaterThan(0);

    // Nothing to tap, and no «Edit»/«Add» pill promising there is.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(businessEn.facts.edit)).not.toBeInTheDocument();
    expect(screen.queryByText(businessEn.facts.add)).not.toBeInTheDocument();
    expect(onEditFact).not.toHaveBeenCalled();
  });

  it('member: an empty fact states its absence instead of ordering a fix', () => {
    render(<BusinessFactRows page={page()} onEditFact={noop} onEditHours={noop} readOnly />);

    expect(screen.getAllByText(businessEn.facts.notSet).length).toBeGreaterThan(0);
    expect(screen.queryByText(businessEn.facts.add_hours)).not.toBeInTheDocument();
  });

  it('admin: the rows ARE tappable (so the assertions above can fail)', () => {
    render(<BusinessFactRows page={page()} onEditFact={noop} onEditHours={noop} />);

    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getByText(businessEn.facts.add_hours)).toBeInTheDocument();
  });
});

describe('CatalogItemRow — view-only', () => {
  it('member: price and availability are readable, every control is gone', () => {
    renderRow(true);

    expect(screen.getByText('عطر التوتيان')).toBeInTheDocument();
    expect(screen.getByText('119')).toBeInTheDocument();
    expect(screen.getByText(catalogEn.availability.in)).toBeInTheDocument();

    for (const name of [catalogEn.actions.edit, catalogEn.actions.delete, catalogEn.actions.moveUp, catalogEn.actions.moveDown]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('member: a price-less item says so, instead of inviting a price', () => {
    renderRow(true, item({ price: null }));

    expect(screen.getByText(catalogEn.inlinePrice.noPrice)).toBeInTheDocument();
    expect(screen.queryByText(catalogEn.inlinePrice.addPrice)).not.toBeInTheDocument();
  });

  it('admin: the controls ARE present (so the assertions above can fail)', () => {
    renderRow(false);

    expect(screen.getByRole('button', { name: catalogEn.actions.edit })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: catalogEn.actions.delete })).toBeInTheDocument();
  });
});
