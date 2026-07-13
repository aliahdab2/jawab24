import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CatalogItem } from '@jawab24/shared';
import { CatalogManager } from './CatalogManager';

const { list, create, update, remove, extract, batchCreate, scanPosts, setVertical } = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  extract: vi.fn(), batchCreate: vi.fn(), scanPosts: vi.fn(), setVertical: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  catalogApi: { list, create, update, remove, extract, batchCreate, scanPosts, setVertical },
  kbApi: { extractText: vi.fn() }, // FileUploadButton (inside the import sheet)
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'i1', pageId: 'p1', type: 'product', name: 'دبل صدمات NJT',
    description: null, price: '350.00', currency: 'ريال', imageUrl: null,
    isAvailable: true, startsAt: null, endsAt: null, attributes: null,
    sortOrder: 0, createdAt: null, updatedAt: null,
    ...overrides,
  };
}

function renderManager(props: Partial<React.ComponentProps<typeof CatalogManager>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CatalogManager pageId="p1" {...props} />
    </QueryClientProvider>,
  );
}

/** Server list response: items + the page's effective vertical. */
function listData(items: CatalogItem[] = [], vertical = { effective: 'other', source: 'default' }) {
  return { data: { data: items, vertical } };
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue(listData());
});

describe('CatalogManager', () => {
  it('shows the teaching empty state: ONE primary scan action, manual paths as footnotes', async () => {
    renderManager();
    expect(await screen.findByRole('button', { name: /Find products in your posts/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import a list' })).toBeInTheDocument();
    // Ghost example row teaches the shape — and is labelled so it can't be
    // mistaken for a real listing.
    expect(screen.getByText('Front shock absorbers')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('renders items with price, currency and an in-stock label', async () => {
    list.mockResolvedValue(listData([item()]));
    renderManager();
    expect(await screen.findByText('دبل صدمات NJT')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByText('ريال')).toBeInTheDocument();
    expect(screen.getByText('In stock')).toBeInTheDocument();
  });

  it('shows an "Add price" affordance for a null price and out-of-stock for unavailable', async () => {
    list.mockResolvedValue(listData([item({ price: null, currency: null, isAvailable: false })]));
    renderManager();
    expect(await screen.findByText('Add price')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });

  it('labels an unavailable VEHICLE as Sold — dealers think sold, not out-of-stock', async () => {
    list.mockResolvedValue(listData([item({ type: 'vehicle', name: 'كيا ريو 2018', isAvailable: false })]));
    renderManager();
    expect(await screen.findByText('Sold')).toBeInTheDocument();
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument();
  });

  it('saves an inline price edit from the row (Enter commits) and inherits the page currency', async () => {
    update.mockResolvedValue({ data: item() });
    list.mockResolvedValue(listData([
      item(),                                                              // provides lastCurrency ريال
      item({ id: 'i2', name: 'كاوتش ميشلان', price: null, currency: null }),
    ]));
    renderManager();

    fireEvent.click(await screen.findByText('Add price'));
    const input = screen.getByLabelText('Price (optional)');
    fireEvent.change(input, { target: { value: '275' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', 'i2', { price: '275', currency: 'ريال' }));
  });

  it('flips availability with the row toggle — one tap, no form', async () => {
    update.mockResolvedValue({ data: item() });
    list.mockResolvedValue(listData([item()]));
    renderManager();

    fireEvent.click(await screen.findByLabelText('Toggle availability of دبل صدمات NJT'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', 'i1', { isAvailable: false }));
  });

  it('hides the business-type picker when Facebook already told us the type, shows it when guessing', async () => {
    list.mockResolvedValue(listData([], { effective: 'vehicles', source: 'facebook' }));
    const { unmount } = renderManager();
    await screen.findByRole('button', { name: /Find products in your posts/ });
    expect(screen.queryByLabelText('Business type')).not.toBeInTheDocument();
    unmount();

    list.mockResolvedValue(listData([], { effective: 'other', source: 'default' }));
    renderManager();
    expect(await screen.findByLabelText('Business type')).toBeInTheDocument();
  });

  it('opens the scan review from the primary action', async () => {
    scanPosts.mockResolvedValue({ data: { items: [], dropped: 0, overflow: 0, remainingCapacity: 300, truncated: false, postsScanned: 0, upToDate: true } });
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: /Find products in your posts/ }));
    expect(await screen.findByText('You’re up to date')).toBeInTheDocument();
    expect(scanPosts).toHaveBeenCalledWith('p1');
  });

  it('shapes a fresh item by the page vertical: dealer gets Vehicle preselected, vehicle chips, no date pickers', async () => {
    list.mockResolvedValue(listData([], { effective: 'vehicles', source: 'facebook' }));
    renderManager();
    fireEvent.click(await screen.findByText('Add manually'));

    expect(await screen.findByRole('button', { name: 'Vehicle' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '+ Year' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Start date (optional)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add dates/ })).toBeInTheDocument();
  });

  it('opens the form and creates an item (name-only is enough)', async () => {
    create.mockResolvedValue({ data: item({ id: 'new' }) });
    renderManager();
    fireEvent.click(await screen.findByText('Add manually'));

    const nameInput = await screen.findByPlaceholderText('e.g. Front shock absorbers');
    fireEvent.change(nameInput, { target: { value: 'خوذة LS2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('p1', expect.objectContaining({
      name: 'خوذة LS2', type: 'product', price: null, isAvailable: true,
    })));
  });

  it('blocks saving an item with a blank name (does not call the API)', async () => {
    renderManager();
    fireEvent.click(await screen.findByText('Add manually'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(create).not.toHaveBeenCalled());
  });

  it('creates an item with a start date and a suggested-detail chip (Duration for course type)', async () => {
    create.mockResolvedValue({ data: item({ id: 'new' }) });
    renderManager();
    fireEvent.click(await screen.findByText('Add manually'));

    fireEvent.change(await screen.findByPlaceholderText('e.g. Front shock absorbers'), { target: { value: 'دورة ميكانيك' } });
    fireEvent.click(screen.getByRole('button', { name: 'Course' })); // type chip
    fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: '2026-08-10' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Duration' })); // suggested chip prefills the label
    fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: '6 weeks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('p1', expect.objectContaining({
      name: 'دورة ميكانيك', type: 'course', startsAt: '2026-08-10', endsAt: null,
      attributes: [{ label: 'Duration', value: '6 weeks' }],
    })));
  });

  it('blocks saving an inverted date window and shows the inline error', async () => {
    renderManager();
    fireEvent.click(await screen.findByText('Add manually'));

    fireEvent.change(await screen.findByPlaceholderText('e.g. Front shock absorbers'), { target: { value: 'عرض' } });
    // Product type hides dates by default — the offer path reveals them explicitly.
    fireEvent.click(screen.getByRole('button', { name: /Add dates/ }));
    fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2026-08-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('End date can’t be before the start date')).toBeInTheDocument();
    await waitFor(() => expect(create).not.toHaveBeenCalled());
  });

  it('shows the Ended badge and the date line for a past-endsAt item', async () => {
    list.mockResolvedValue(listData([item({ startsAt: '2026-01-01', endsAt: '2026-01-31' })]));
    renderManager();
    expect(await screen.findByText('Ended')).toBeInTheDocument();
    expect(screen.getByText(/Starts 2026-01-01/)).toBeInTheDocument();
    expect(screen.getByText(/Ends 2026-01-31/)).toBeInTheDocument();
  });

  it('offers Import beside Add — from the empty state and the list header', async () => {
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Import a list' }));
    expect(await screen.findByText('Import your products & services')).toBeInTheDocument();
  });

  it('auto-opens the import sheet with the prefill when the deep link asks for it', async () => {
    renderManager({ importRequested: true, importInitialText: 'قص شعر ٥٠ ريال' });
    expect(await screen.findByText('Import your products & services')).toBeInTheDocument();
    expect(screen.getByLabelText('Your list')).toHaveValue('قص شعر ٥٠ ريال');
  });

  it('deletes an item after confirmation', async () => {
    list.mockResolvedValue(listData([item()]));
    remove.mockResolvedValue({ data: {} });
    renderManager();

    fireEvent.click(await screen.findByLabelText('Delete'));
    // The confirmation dialog title confirms it opened.
    expect(await screen.findByText('Delete this item?')).toBeInTheDocument();
    // Two buttons are named "Delete" now — the row icon and the modal confirm
    // (portaled, rendered last). Click the confirm (last match).
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(remove).toHaveBeenCalledWith('p1', 'i1'));
  });
});
