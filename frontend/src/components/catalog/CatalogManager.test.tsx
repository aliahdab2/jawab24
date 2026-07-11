import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CatalogItem } from '@jawab24/shared';
import { CatalogManager } from './CatalogManager';

const { list, create, update, remove, extract, batchCreate } = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  extract: vi.fn(), batchCreate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  catalogApi: { list, create, update, remove, extract, batchCreate },
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

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ data: { data: [] } });
});

describe('CatalogManager', () => {
  it('shows the teaching empty state with a first-item CTA when there are no items', async () => {
    renderManager();
    expect(await screen.findByText('Add your first item')).toBeInTheDocument();
    // Ghost example row teaches the shape
    expect(screen.getByText('Front shock absorbers')).toBeInTheDocument();
  });

  it('renders items with price, currency and an in-stock pill', async () => {
    list.mockResolvedValue({ data: { data: [item()] } });
    renderManager();
    expect(await screen.findByText('دبل صدمات NJT')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByText('ريال')).toBeInTheDocument();
    expect(screen.getByText('In stock')).toBeInTheDocument();
  });

  it('shows "price on request" for a null price and out-of-stock for unavailable', async () => {
    list.mockResolvedValue({ data: { data: [item({ price: null, currency: null, isAvailable: false })] } });
    renderManager();
    expect(await screen.findByText('Price on request')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });

  it('opens the form and creates an item (name-only is enough)', async () => {
    create.mockResolvedValue({ data: item({ id: 'new' }) });
    renderManager();
    fireEvent.click(await screen.findByText('Add your first item'));

    const nameInput = await screen.findByPlaceholderText('e.g. Front shock absorbers');
    fireEvent.change(nameInput, { target: { value: 'خوذة LS2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('p1', expect.objectContaining({
      name: 'خوذة LS2', type: 'product', price: null, isAvailable: true,
    })));
  });

  it('blocks saving an item with a blank name (does not call the API)', async () => {
    renderManager();
    fireEvent.click(await screen.findByText('Add your first item'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(create).not.toHaveBeenCalled());
  });

  it('creates an item with a start date and a suggested-detail chip (Duration for course type)', async () => {
    create.mockResolvedValue({ data: item({ id: 'new' }) });
    renderManager();
    fireEvent.click(await screen.findByText('Add your first item'));

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
    fireEvent.click(await screen.findByText('Add your first item'));

    fireEvent.change(await screen.findByPlaceholderText('e.g. Front shock absorbers'), { target: { value: 'عرض' } });
    fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2026-08-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('End date can’t be before the start date')).toBeInTheDocument();
    await waitFor(() => expect(create).not.toHaveBeenCalled());
  });

  it('shows the Ended badge and the date line for a past-endsAt item', async () => {
    list.mockResolvedValue({ data: { data: [item({ startsAt: '2026-01-01', endsAt: '2026-01-31' })] } });
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
    list.mockResolvedValue({ data: { data: [item()] } });
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
