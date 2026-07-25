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
 * A Salla/Zid/Shopify page can already answer delivery and payment: the store's
 * `policiesSummary` ("shipping, returns, warranty, payment") reaches every reply
 * via getStoreContextForAI. Nagging «أضف معلومات التوصيل» would ask the merchant
 * to re-type a fact we already hold, and the two copies can then drift.
 *
 * The claim is keyed on `storeAnswersPolicies` (server-derived: store is active
 * AND has synced policy text), never on `ecommerceStoreId` — see the false-claim
 * cases below, where the id is set and the model still receives nothing.
 */
describe('BusinessFactRows — connected store', () => {
  it('says the store answers delivery and payment instead of nagging', () => {
    renderRows(makePage({ ecommerceStoreId: 'store-1', storeAnswersPolicies: true } as Partial<Page>));
    expect(screen.getAllByText('Answered by your connected store')).toHaveLength(2);
    expect(screen.queryByText('Add delivery details')).not.toBeInTheDocument();
    expect(screen.queryByText('Add payment methods')).not.toBeInTheDocument();
  });

  it('still nags for facts the store does NOT sync', () => {
    renderRows(makePage({ ecommerceStoreId: 'store-1', storeAnswersPolicies: true } as Partial<Page>));
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
      storeAnswersPolicies: true,
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

  /**
   * Regression — the store id is NOT proof the store answers. It survives a
   * platform-side uninstall (`deactivateStore` blanks the tokens but keeps the
   * link so a reconnect restores it) and it is set on a live store that synced no
   * policy text. In both cases `getStoreContextForAI` gives the model nothing, so
   * claiming an answer talks the merchant out of writing the fact their customers
   * ask about most, and «بتوصلوا؟» is then answered with "I don't know".
   */
  it('nags normally when a store is linked but does not answer policies', () => {
    renderRows(makePage({ ecommerceStoreId: 'store-1', storeAnswersPolicies: false } as Partial<Page>));
    expect(screen.queryByText('Answered by your connected store')).not.toBeInTheDocument();
    expect(screen.getByText('Add delivery details')).toBeInTheDocument();
    expect(screen.getByText('Add payment methods')).toBeInTheDocument();
  });

  // An older client (or any payload built before the flag existed) must not be
  // read as "the store answers" — absent means unproven, and unproven must nag.
  it('treats a missing flag as "does not answer", not as an answer', () => {
    renderRows(makePage({ ecommerceStoreId: 'store-1' } as Partial<Page>));
    expect(screen.queryByText('Answered by your connected store')).not.toBeInTheDocument();
    expect(screen.getByText('Add delivery details')).toBeInTheDocument();
  });
});
