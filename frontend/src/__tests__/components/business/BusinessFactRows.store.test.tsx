import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BusinessFactRows } from '@/components/business/BusinessFactRows';
import type { Page } from '@jawab24/shared';

vi.mock('@/components/ui', () => ({
  WhatsAppIcon: () => <svg data-testid="wa-icon" />,
}));

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1',
    name: 'Test',
    businessProfile: { merchant: {} },
    ...overrides,
  } as unknown as Page;
}

function renderRows(page: Page) {
  render(<BusinessFactRows page={page} onEditFact={vi.fn()} onEditHours={vi.fn()} />);
}

/**
 * A Salla/Zid/Shopify page already answers delivery and payment: the store's
 * `policiesSummary` ("shipping, returns, warranty, payment") reaches every reply
 * via getStoreContextForAI. Nagging «أضف معلومات التوصيل» would ask the merchant
 * to re-type a fact we already hold, and the two copies can then drift.
 */
describe('BusinessFactRows — connected store', () => {
  it('says the store answers delivery and payment instead of nagging', () => {
    renderRows(makePage({ ecommerceStoreId: 'store-1' } as Partial<Page>));
    expect(screen.getAllByText('Answered by your connected store')).toHaveLength(2);
    expect(screen.queryByText('Add delivery details')).not.toBeInTheDocument();
    expect(screen.queryByText('Add payment methods')).not.toBeInTheDocument();
  });

  it('still nags for facts the store does NOT sync', () => {
    renderRows(makePage({ ecommerceStoreId: 'store-1' } as Partial<Page>));
    // Hours, address, phone are not carried by the store sync.
    expect(screen.getByText('Add working hours')).toBeInTheDocument();
    expect(screen.getByText('Add your address')).toBeInTheDocument();
    expect(screen.getByText('Add a contact number')).toBeInTheDocument();
  });

  // Writing a value is a deliberate override — the merchant's own words must win
  // over the generic store text in the row.
  it('shows the merchant value over the store note when one exists', () => {
    renderRows(makePage({
      ecommerceStoreId: 'store-1',
      businessProfile: { merchant: { policies: { shipping: 'Free over 300' } } },
    } as unknown as Partial<Page>));
    expect(screen.getByText('Free over 300')).toBeInTheDocument();
    expect(screen.getAllByText('Answered by your connected store')).toHaveLength(1); // payment only
  });

  it('is unchanged for a page with no store', () => {
    renderRows(makePage());
    expect(screen.queryByText('Answered by your connected store')).not.toBeInTheDocument();
    expect(screen.getByText('Add delivery details')).toBeInTheDocument();
  });
});
