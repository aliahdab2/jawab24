import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@jawab24/shared';
import { BusinessReadinessCard } from './BusinessReadinessCard';

/** A page whose confirmed merchant profile holds exactly the given facts. */
function pageWith(merchant: Record<string, unknown>): Page {
  return { id: 'p1', name: 'Shop', businessProfile: { merchant } } as unknown as Page;
}

function renderCard(page: Page, productsCount: number | undefined = 0) {
  return render(
    <BusinessReadinessCard
      page={page}
      productsCount={productsCount}
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

    expect(screen.getByText('Your assistant is 40% ready')).toBeInTheDocument();
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

  it('only reads 100% when nothing is missing, and then drops the gap sentence', () => {
    renderCard(pageWith({
      hours: { sat: [{ from: '09:00', to: '19:00' }] },
      address: 'جرمانا',
      policies: { shipping: 'توصيل داخل دمشق', payment: 'نقداً عند الاستلام' },
    }), 3);

    expect(screen.getByText('Your assistant is 100% ready')).toBeInTheDocument();
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

    expect(screen.getByText('Your assistant is 80% ready')).toBeInTheDocument();
  });

  it('counts a connected store as covering delivery, payment and products', () => {
    const page = { ...pageWith({ hours: { sat: [{ from: '09:00', to: '19:00' }] }, address: 'جرمانا' }), ecommerceStoreId: 'store-1' } as Page;
    renderCard(page, 0);
    expect(screen.getByText('Your assistant is 100% ready')).toBeInTheDocument();
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
        onTryReply={vi.fn()}
        onFixChip={vi.fn()}
      />,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/% ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Add /)).not.toBeInTheDocument();
  });
});
