import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CatalogItemInput } from '@/lib/api';
import { CatalogImportSheet } from './CatalogImportSheet';

const { extract, batchCreate } = vi.hoisted(() => ({
  extract: vi.fn(), batchCreate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  catalogApi: { extract, batchCreate },
  kbApi: { extractText: vi.fn() }, // FileUploadButton dependency
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function proposal(overrides: Partial<CatalogItemInput> = {}): CatalogItemInput {
  return {
    type: 'course', name: 'دورة ICDL', price: 3500, currency: 'ل.س',
    description: null, isAvailable: true, ...overrides,
  };
}

function extractResponse(items: CatalogItemInput[], meta: Partial<{ dropped: number; overflow: number; truncated: boolean }> = {}) {
  return { data: { items, dropped: 0, overflow: 0, remainingCapacity: 300, truncated: false, ...meta } };
}

const PASTE = 'دورة ICDL ٣٥٠٠ ل.س\nدورة فوتوشوب ٥٠٠٠ ل.س';

function renderSheet(props: Partial<React.ComponentProps<typeof CatalogImportSheet>> = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <CatalogImportSheet pageId="p1" onDone={onDone} onClose={onClose} {...props} />,
  );
  return { onDone, onClose };
}

/** Paste text and run the extraction so tests start from the review phase. */
async function reachReview(items: CatalogItemInput[], meta?: Partial<{ dropped: number; overflow: number; truncated: boolean }>) {
  extract.mockResolvedValue(extractResponse(items, meta));
  const handles = renderSheet();
  fireEvent.change(screen.getByLabelText('Your list'), { target: { value: PASTE } });
  fireEvent.click(screen.getByRole('button', { name: 'Extract items' }));
  await waitFor(() => expect(extract).toHaveBeenCalledWith('p1', PASTE));
  return handles;
}

beforeEach(() => vi.clearAllMocks());

describe('CatalogImportSheet', () => {
  it('keeps Extract disabled until the paste is long enough', () => {
    renderSheet();
    const button = screen.getByRole('button', { name: 'Extract items' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your list'), { target: { value: 'short' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your list'), { target: { value: PASTE } });
    expect(button).toBeEnabled();
  });

  it('pre-fills the paste box from initialText (warning-banner hand-off)', () => {
    renderSheet({ initialText: PASTE });
    expect(screen.getByLabelText('Your list')).toHaveValue(PASTE);
  });

  it('shows extracted proposals for review with name, price and currency', async () => {
    await reachReview([proposal(), proposal({ name: 'دورة فوتوشوب', price: 5000 })]);
    expect(await screen.findByText('دورة ICDL')).toBeInTheDocument();
    expect(screen.getByText('دورة فوتوشوب')).toBeInTheDocument();
    expect(screen.getByText('3500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 2 items' })).toBeEnabled();
  });

  it('surfaces dropped/truncated honestly in the review meta', async () => {
    await reachReview([proposal()], { dropped: 2, truncated: true });
    expect(await screen.findByText('2 entries couldn’t be read and were skipped.')).toBeInTheDocument();
    expect(screen.getByText(/some items near the end may be missing/)).toBeInTheDocument();
  });

  it('keeps the pasted text when extraction fails', async () => {
    extract.mockRejectedValue(new Error('boom'));
    renderSheet();
    fireEvent.change(screen.getByLabelText('Your list'), { target: { value: PASTE } });
    fireEvent.click(screen.getByRole('button', { name: 'Extract items' }));

    await waitFor(() => expect(extract).toHaveBeenCalled());
    expect(screen.getByLabelText('Your list')).toHaveValue(PASTE); // nothing eaten
    const { toast } = await import('sonner');
    expect(toast.error).toHaveBeenCalled();
  });

  it('shows an honest empty state when nothing was extracted, and Back preserves the text', async () => {
    await reachReview([]);
    expect(await screen.findByText('No items found in this text')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Your list')).toHaveValue(PASTE);
  });

  it('excludes removed rows from the batch and updates the Add count', async () => {
    batchCreate.mockResolvedValue({ data: { data: [{}] } });
    const { onDone } = await reachReview([proposal(), proposal({ name: 'دورة فوتوشوب', price: 5000 })]);

    fireEvent.click((await screen.findAllByLabelText('Don’t add this item'))[1]);
    const addButton = screen.getByRole('button', { name: 'Add 1 item' });
    fireEvent.click(addButton);

    await waitFor(() => expect(batchCreate).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ name: 'دورة ICDL' }),
    ]));
    expect(onDone).toHaveBeenCalledWith(1);
  });

  it('restores a removed row (undoable, not destructive)', async () => {
    await reachReview([proposal()]);
    fireEvent.click((await screen.findAllByLabelText('Don’t add this item'))[0]);
    expect(screen.getByRole('button', { name: 'Add 0 items' })).toBeDisabled(); // nothing left to add
    fireEvent.click(screen.getByLabelText('Restore this item'));
    expect(screen.getByRole('button', { name: 'Add 1 item' })).toBeEnabled();
  });

  it('sends an edited price (row expands to the shared field editor)', async () => {
    batchCreate.mockResolvedValue({ data: { data: [{}] } });
    await reachReview([proposal()]);

    fireEvent.click(await screen.findByText('دورة ICDL')); // expand the row
    const priceInput = screen.getByLabelText('Price (optional)');
    fireEvent.change(priceInput, { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 item' }));

    await waitFor(() => expect(batchCreate).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ name: 'دورة ICDL', price: '4000' }),
    ]));
  });

  it('blocks saving a row edited to a blank name and flags it inline', async () => {
    await reachReview([proposal()]);
    fireEvent.click(await screen.findByText('دورة ICDL'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 item' }));

    expect(batchCreate).not.toHaveBeenCalled();
    expect(await screen.findByText('Please enter a name for this item')).toBeInTheDocument();
  });

  it('keeps the review state when the batch save fails', async () => {
    batchCreate.mockRejectedValue(new Error('boom'));
    const { onDone } = await reachReview([proposal()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Add 1 item' }));

    await waitFor(() => expect(batchCreate).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText('دورة ICDL')).toBeInTheDocument(); // edits survive
    const { toast } = await import('sonner');
    expect(toast.error).toHaveBeenCalled();
  });
});
