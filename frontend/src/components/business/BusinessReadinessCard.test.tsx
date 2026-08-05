import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@jawab24/shared';
import { BusinessReadinessCard } from './BusinessReadinessCard';
import { businessPage as pageWith } from '@/utils/__tests__/businessPageFixture';


function renderCard(page: Page, productsCount: number | undefined = 0, factRowsCount: number | undefined = 0) {
  return render(
    <BusinessReadinessCard
      page={page}
      productsCount={productsCount}
      factRowsCount={factRowsCount}
      onTryReply={vi.fn()}
      onFixChip={vi.fn()}
    />,
  );
}

describe('BusinessReadinessCard progress', () => {
  it('reports a percentage that matches the chips it renders', () => {
    // hours + address confirmed; products, delivery, payment missing → 2 of 5.
    renderCard(pageWith({
      hours: { sat: [{ from: '09:00', to: '19:00' }] },
      address: 'جرمانا، الشارع العام',
    }));

    expect(screen.getByText('Jawab is 40% ready')).toBeInTheDocument();
    expect(screen.getByText('2 of 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('names the missing areas with the SAME labels as the chips', () => {
    renderCard(pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] } }));

    // One screen must not call a field two things — the sentence reuses the chip
    // label, so "Payment" can never appear here as "Payment methods".
    const gap = screen.getByText(/^Add /);
    for (const label of ['Delivery', 'Payment', 'Address']) {
      expect(gap.textContent).toContain(label);
    }
    expect(gap.textContent).toMatch(/to be fully ready\.$/);
  });

  /**
   * Regression — the sentence used to interpolate the products CHIP label, which
   * is a count readout, so it read "Add No products yet to be fully ready." /
   * «أضف لا منتجات بعد ليصبح جاهزًا بالكامل.» Caught on prod. A list of things to
   * add needs the area's NOUN, not its status.
   */
  it('names products with a noun in the gap sentence, not with the chip\'s count', () => {
    const { container } = renderCard(pageWith({
      hours: { sat: [{ from: '09:00', to: '19:00' }] },
      address: 'جرمانا',
      policies: { shipping: 'توصيل داخل دمشق', payment: 'نقداً' },
    }), 0);

    // Exact, not `toContain`: reverting to the chip label would still "contain"
    // products and pass, while reading "Add 0 products to be fully ready."
    expect(screen.getByText(/to be fully ready/).textContent).toBe('Add Products to be fully ready.');
    // The chip keeps the count — that IS what a chip should show. (Asserted on
    // the chip list rather than by its text: the count phrasing differs between
    // this environment and the browser, where ICU's `=0` branch selects «No
    // products yet» — the plural form is not what this test is about.)
    expect(container.querySelector('li')?.textContent).toMatch(/products/);
  });

  it('only reads 100% when nothing is missing, and then drops the gap sentence', () => {
    renderCard(pageWith({
      hours: { sat: [{ from: '09:00', to: '19:00' }] },
      address: 'جرمانا',
      policies: { shipping: 'توصيل داخل دمشق', payment: 'نقداً عند الاستلام' },
    }), 3);

    expect(screen.getByText('Jawab is 100% ready')).toBeInTheDocument();
    expect(screen.getByText('Jawab can answer all of these for your customers.')).toBeInTheDocument();
    expect(screen.queryByText(/^Add /)).not.toBeInTheDocument();
  });

  it('never rounds an incomplete profile up to 100%', () => {
    // 4 of 5 covered = 80%; flooring keeps 100% honest for the last gap.
    renderCard(pageWith({
      hours: { sat: [{ from: '09:00', to: '19:00' }] },
      address: 'جرمانا',
      policies: { shipping: 'توصيل داخل دمشق', payment: 'نقداً' },
    }), 0);

    expect(screen.getByText('Jawab is 80% ready')).toBeInTheDocument();
  });

  it('counts a connected store as covering delivery, payment and products', () => {
    const page = {
      ...pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] }, address: 'جرمانا' }),
      ecommerceStoreId: 'store-1',
      storeAnswersPolicies: true,
    } as Page;
    renderCard(page, 0);
    expect(screen.getByText('Jawab is 100% ready')).toBeInTheDocument();
  });

  /**
   * Regression — the chips used to key the delivery/payment areas on
   * `ecommerceStoreId` alone, which is NOT proof the store answers: the id
   * survives a platform-side uninstall and is set on a live store that synced no
   * policy text (see `storeAnswersPolicies` in backend/src/services/ecommerce.ts).
   * That scored two areas green while the fact row beneath said «أضف معلومات
   * التوصيل» — one screen, two scoreboards. Both now read the server flag.
   */
  it('does not treat a store id alone as covering delivery and payment', () => {
    const page = {
      ...pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] }, address: 'جرمانا' }),
      ecommerceStoreId: 'store-1',
    } as Page;
    renderCard(page, 0);
    // products (store-linked) + hours + address = 3 of 5.
    expect(screen.getByText('Jawab is 60% ready')).toBeInTheDocument();
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
  });

  // A city with no street line still answers «وين محلكم؟» — and the fact row
  // DISPLAYS it, so scoring it as a gap would contradict the value on screen.
  it('counts a city-only address as covered', () => {
    renderCard(pageWith({ city: 'دمشق' }));
    expect(screen.getByText('Jawab is 20% ready')).toBeInTheDocument();
  });
});

describe('BusinessReadinessCard chips', () => {
  it('the products chip is tappable when uncovered — it was the one amber chip that ignored the tap', () => {
    const onFixChip = vi.fn();
    render(
      <BusinessReadinessCard
        page={pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] } })}
        productsCount={0}
        factRowsCount={0}
        onTryReply={vi.fn()}
        onFixChip={onFixChip}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /products/i }));
    expect(onFixChip).toHaveBeenCalledWith('products');
  });

  it('covered chips stay inert — nothing to fix, so nothing pretends to be tappable', () => {
    render(
      <BusinessReadinessCard
        page={pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] } })}
        productsCount={3}
        factRowsCount={0}
        onTryReply={vi.fn()}
        onFixChip={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /products/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Working hours/ })).not.toBeInTheDocument();
  });
});

describe('BusinessReadinessCard ring', () => {
  it('carries the number as text, not only as an arc', () => {
    renderCard(pageWith({
      hours: { sat: [{ from: '09:00', to: '19:00' }] },
      address: 'جرمانا',
    }));

    // The ring is aria-hidden; the number must survive without it.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Jawab is 40% ready');
    expect(screen.getByText('Jawab is 40% ready')).toBeInTheDocument();
  });

  it('sweeps the arc in proportion to the percentage', () => {
    const { container } = renderCard(pageWith({
      hours: { sat: [{ from: '09:00', to: '19:00' }] },
      address: 'جرمانا',
      policies: { shipping: 'توصيل داخل دمشق', payment: 'نقداً' },
    }), 3);

    const arc = container.querySelector('circle[stroke-dasharray]');
    // 100% ready → nothing left undrawn.
    expect(arc).toHaveAttribute('stroke-dashoffset', '0');
  });
});

describe('BusinessReadinessCard while the catalog count is still loading', () => {
  it('publishes no number until the count lands — a self-correcting number reads as a wrong one', () => {
    // NOT via renderCard: its `productsCount = 0` default swallows an explicit
    // undefined (JS default params fire on undefined), which would silently test
    // the loaded path instead of the loading one.
    render(
      <BusinessReadinessCard
        page={pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] } })}
        productsCount={undefined}
        factRowsCount={0}
        onTryReply={vi.fn()}
        onFixChip={vi.fn()}
      />,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/% ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Add /)).not.toBeInTheDocument();
  });
});

describe('BusinessReadinessCard on a lists-shaped page (products live in fact lists, catalog empty)', () => {
  it('counts the lists as products and says so — never «no products yet» above 245 rows', () => {
    // The BAMBO contradiction (owner catch, 2026-08-04): 0 catalog items but
    // 245 live list rows greeted the merchant with "0% ready — no products yet".
    renderCard(pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] } }), 0, 245);

    expect(screen.getByText('Your products — in your lists')).toBeInTheDocument();
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
    // hours + products → 2 of 5.
    expect(screen.getByText('2 of 5')).toBeInTheDocument();
  });

  it('withholds the score until the lists count lands, same as the catalog count', () => {
    render(
      <BusinessReadinessCard
        page={pageWith({})}
        productsCount={0}
        factRowsCount={undefined}
        onTryReply={vi.fn()}
        onFixChip={vi.fn()}
      />,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
