import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CatalogItem, StoredBusinessProfile } from '@jawab24/shared';
import { KbCleanupSheet } from './KbCleanupSheet';

const { cleanupKb } = vi.hoisted(() => ({ cleanupKb: vi.fn() }));
vi.mock('@/lib/api', () => ({ pagesApi: { cleanupKb } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

const PRODUCT_LINE = '- حامل جوال للمقود متوفر بسعر 35 ريال';
const ADDRESS_LINE = '📍 العنوان: حي العزيزية';

// KB with a product line, a stale address line, AND a duplicate of the product
// line — exercises product-vs-field precedence + duplicate dedup in one go.
const KB = [PRODUCT_LINE, ADDRESS_LINE, PRODUCT_LINE].join('\n');

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'i1', pageId: 'p1', type: 'product', name: 'حامل جوال للمقود',
    description: null, price: '35.00', currency: 'ريال', imageUrl: null,
    isAvailable: true, startsAt: null, endsAt: null, attributes: null,
    sortOrder: 0, createdAt: null, updatedAt: null, ...overrides,
  };
}

// The API serves the {merchant, suggestions} CONTAINER — the shape that broke
// the first cut (read as flat → field matches never fired).
const CONTAINER_PROFILE: StoredBusinessProfile = {
  merchant: { address: 'حي النسيم، الرياض' },
  suggestions: { address: 'حي العزيزية' },
} as StoredBusinessProfile;

function renderSheet(props: Partial<React.ComponentProps<typeof KbCleanupSheet>> = {}) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(
    <KbCleanupSheet
      pageId="p1"
      kbText={KB}
      items={[item()]}
      profile={CONTAINER_PROFILE}
      onClose={onClose}
      onDone={onDone}
      {...props}
    />,
  );
  return { onClose, onDone };
}

describe('KbCleanupSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('proposes a product line (pre-checked) AND the stale field line (unchecked)', () => {
    renderSheet();
    // Container-unwrap works: the address field line is proposed at all.
    expect(screen.getByText(ADDRESS_LINE)).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    // Exactly one pre-checked (the product); field line left for explicit opt-in.
    expect(boxes.filter((b) => b.checked)).toHaveLength(1);
  });

  it('de-dupes identical KB lines into a single row', () => {
    renderSheet();
    // PRODUCT_LINE appears twice in the KB but must render once.
    expect(screen.getAllByText(PRODUCT_LINE)).toHaveLength(1);
  });

  it('a page with NO confirmed fields proposes only the product line', () => {
    renderSheet({ profile: { merchant: {}, suggestions: { address: 'حي العزيزية' } } as StoredBusinessProfile });
    // suggestions-only (unconfirmed) → address line NOT proposed.
    expect(screen.queryByText(ADDRESS_LINE)).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('confirm removes only the CHECKED lines and calls onDone', async () => {
    cleanupKb.mockResolvedValue({ data: { cleanup: { removed: 1 } } });
    const { onDone } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Remove 1 line/i }));
    await waitFor(() => expect(cleanupKb).toHaveBeenCalledWith('p1', [PRODUCT_LINE]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(1));
  });

  it('checking the field line adds it to the removal set', async () => {
    cleanupKb.mockResolvedValue({ data: { cleanup: { removed: 2 } } });
    const { onDone } = renderSheet();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const fieldBox = boxes.find((b) => !b.checked)!;
    fireEvent.click(fieldBox);
    fireEvent.click(screen.getByRole('button', { name: /Remove 2 lines/i }));
    await waitFor(() =>
      expect(cleanupKb).toHaveBeenCalledWith('p1', expect.arrayContaining([PRODUCT_LINE, ADDRESS_LINE])),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2));
  });

  it('disables the primary button when nothing is checked (no duplicate "Keep everything")', () => {
    renderSheet();
    // Uncheck the pre-checked product → selection empty.
    const productBox = (screen.getAllByRole('checkbox') as HTMLInputElement[]).find((b) => b.checked)!;
    fireEvent.click(productBox);
    const buttons = screen.getAllByRole('button');
    const keepButtons = buttons.filter((b) => /Keep everything/i.test(b.textContent || ''));
    expect(keepButtons).toHaveLength(1); // not two identical buttons
    // The remove/confirm button is present but disabled.
    const removeBtn = buttons.find((b) => /Remove/i.test(b.textContent || '')) as HTMLButtonElement;
    expect(removeBtn).toBeDefined();
    expect(removeBtn.disabled).toBe(true);
  });

  it('"Keep everything" closes without calling the API', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Keep everything/i }));
    expect(onClose).toHaveBeenCalled();
    expect(cleanupKb).not.toHaveBeenCalled();
  });

  /**
   * The sheet must honour the matcher's `confidence`, which it ignored until
   * 2026-08-19: every product match was pre-checked, so a low-confidence line
   * was ONE TAP from deleting the merchant's own Business Info text. Reported
   * with a screenshot of exactly this — a page's FAQ prose, pre-checked, above
   * a primary «Remove 2 lines» button.
   *
   * Real shapes, not synthetic: a brand-style item name and the merchant's own
   * sentence about it, which `catalogKbMatch` grades 'tokens'.
   *
   * Mutation check: pre-check on `kind !== 'field'` again and both assertions
   * fail (checked box, and the confirm button enabled).
   */
  it('leaves a low-confidence product match UNCHECKED, and says why', () => {
    const PROSE_LINE =
      'الطريقة بسيطة من خلال تحميل تطبيق جواب٢٤ على اندرويد او من خلال صفحة جواب ٢٤';

    renderSheet({
      kbText: PROSE_LINE,
      items: [item({ id: 'brand', name: 'جواب24' })],
      profile: undefined, // isolate the product path — no field matches
    });

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(1);
    expect(boxes[0].checked).toBe(false);

    // An unchecked box with no reason is a worse UI than no box at all.
    expect(
      screen.getByText(/doesn't look like a price line/i),
    ).toBeInTheDocument();

    // Nothing pre-selected ⇒ the destructive action is unavailable until the
    // merchant deliberately opts in.
    const removeBtn = screen
      .getAllByRole('button')
      .find((b) => /Remove/i.test(b.textContent || '')) as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
  });
});
