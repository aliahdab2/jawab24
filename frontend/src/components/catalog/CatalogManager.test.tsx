import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CatalogItem, Page } from '@jawab24/shared';
import { CatalogManager } from './CatalogManager';

const { list, create, update, remove, extract, batchCreate, scanPage, setVertical } = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  extract: vi.fn(), batchCreate: vi.fn(), scanPage: vi.fn(), setVertical: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  catalogApi: { list, create, update, remove, extract, batchCreate, scanPage, setVertical },
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

/** A page as /api/pages returns it — Facebook-connected unless overridden. */
function pageFixture(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1', name: 'Moto', facebookPageId: '1234567890', isConnected: true,
    hasPostReplyTrigger: true, knowledgeBase: '', businessProfile: {},
    ...overrides,
  } as unknown as Page;
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
  it('shows the empty state: ONE primary import action, scan and manual as footnotes', async () => {
    renderManager();
    // Paste-import leads (owner ruling 2026-08-05: the scan proposes name-only
    // items — prices live off-post — while a pasted list comes back complete).
    expect(await screen.findByRole('button', { name: 'Import a list' })).toBeInTheDocument();
    expect(screen.getByText(/Paste your price list/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Extract your products from your page/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument();
    // No mocked-up "example" row — a fake listing with a real price read as
    // live data. The scan flow shows the real row shape during review instead.
    expect(screen.queryByText('Olive oil, 1 litre')).not.toBeInTheDocument();
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
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
    await screen.findByRole('button', { name: /Extract your products from your page/ });
    expect(screen.queryByLabelText('Business type')).not.toBeInTheDocument();
    unmount();

    list.mockResolvedValue(listData([], { effective: 'other', source: 'default' }));
    renderManager();
    expect(await screen.findByLabelText('Business type')).toBeInTheDocument();
  });

  // The page scan reads Facebook posts through the Graph API AND the page's
  // configured Post Replies from our own DB (D-059). So "posts unreadable"
  // (WhatsApp-only / token-less) only kills the scan when the page ALSO has no
  // Post Reply — otherwise it degrades to a replies-only scan. The true dead
  // end used to answer 409 PAGE_DISCONNECTED ("Couldn't read your posts.
  // Please try again." — advice that can never work). Prod 2026-07-27: 8 of
  // one workspace's 10 pages were in that state.
  describe('page-scan availability', () => {
    it('offers the scan on a Facebook-connected page and shows no blocker note', async () => {
      renderManager({ page: pageFixture() });
      expect(await screen.findByRole('button', { name: /Extract your products from your page/ })).toBeInTheDocument();
      expect(screen.queryByText(/Reading posts works on Facebook pages only/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Reconnect this page to Facebook/)).not.toBeInTheDocument();
    });

    it('WhatsApp-only page with no Post Reply: no scan action anywhere, reason given', async () => {
      renderManager({ page: pageFixture({ facebookPageId: null, hasPostReplyTrigger: false }) });
      expect(await screen.findByRole('button', { name: 'Import a list' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Extract your products from your page/ })).not.toBeInTheDocument();
      expect(screen.getByText('“Moto” isn’t a Facebook page — reading posts works on Facebook pages only.')).toBeInTheDocument();
      // The other remaining path must still be reachable.
      expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument();
    });

    it('the body pitches the paste import regardless of scan availability', async () => {
      renderManager({ page: pageFixture({ facebookPageId: null, hasPostReplyTrigger: false }) });
      expect(await screen.findByText(/Paste your price list/)).toBeInTheDocument();
      expect(screen.queryByText(/Your posts already show what you sell/)).not.toBeInTheDocument();
    });

    it('disconnected Facebook page with no Post Reply: no scan action, reason names the reconnect', async () => {
      renderManager({ page: pageFixture({ isConnected: false, hasPostReplyTrigger: false }) });
      expect(await screen.findByRole('button', { name: 'Import a list' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Extract your products from your page/ })).not.toBeInTheDocument();
      expect(screen.getByText('Reconnect “Moto” to Facebook to read its posts.')).toBeInTheDocument();
    });

    // The merged source keeps a blocked page scannable: its configured replies
    // live in our DB (no token needed), so the scan is OFFERED and the blocker
    // line stays as the honest "posts won't be read" heads-up.
    it('a blocked page WITH Post Replies keeps the scan (replies-only), with the posts reason still shown', async () => {
      renderManager({ page: pageFixture({ isConnected: false, hasPostReplyTrigger: true }) });
      expect(await screen.findByRole('button', { name: /Extract your products from your page/ })).toBeEnabled();
      expect(screen.getByText('Reconnect “Moto” to Facebook to read its posts.')).toBeInTheDocument();
    });

    /**
     * Owner report, prod 2026-07-27: «أعد ربط هذه الصفحة بفيسبوك» on an account
     * with 10 pages — 8 of them blocked, for two DIFFERENT reasons — left no way
     * to tell which page to reconnect. /business shows one page at a time behind a
     * selector several rows above this text, so "this page" is not a referent the
     * merchant can resolve. Both blocker reasons must name the page.
     */
    it.each([
      ['a WhatsApp-only page', { facebookPageId: null }],
      ['a token-less Facebook page', { isConnected: false }],
    ])('names the page in the reason — %s', async (_case, overrides) => {
      renderManager({ page: pageFixture({ ...overrides, hasPostReplyTrigger: false, name: 'مفروشات القباني' }) });
      await screen.findByRole('button', { name: 'Import a list' });

      const reason = screen.getByText(/مفروشات القباني/);
      expect(reason).toBeInTheDocument();
      // Never the unresolvable referent it replaced.
      expect(reason.textContent).not.toMatch(/this page/);
    });

    // Removing it silently read as "the feature was deleted" (owner report). On a
    // page that already has items the control stays put, disabled, with the reason
    // shown — a title attribute alone is invisible on touch.
    it('disables the toolbar scan and shows why, instead of removing it', async () => {
      list.mockResolvedValue(listData([item()]));
      renderManager({ page: pageFixture({ facebookPageId: null, hasPostReplyTrigger: false }) });
      expect(await screen.findByText('دبل صدمات NJT')).toBeInTheDocument();

      const scan = screen.getByRole('button', { name: /Extract your products from your page/ });
      expect(scan).toBeDisabled();
      expect(screen.getByText('“Moto” isn’t a Facebook page — reading posts works on Facebook pages only.')).toBeInTheDocument();
      // The paths that DO work on a WhatsApp-only page stay enabled.
      expect(screen.getByRole('button', { name: 'Import a list' })).toBeEnabled();
    });

    it('a host that passes no page keeps the scan offered — impossibility unproven', async () => {
      renderManager();
      expect(await screen.findByRole('button', { name: /Extract your products from your page/ })).toBeInTheDocument();
    });
  });

  // A single example for every trade taught the wrong thing: six of the ten
  // verticals default to type 'product', so nearly every merchant was shown an
  // auto-parts example, and a salon (beauty → service) was shown AC maintenance.
  describe('name example in the add form', () => {
    /** Renders a fresh manager for one vertical and returns the name input plus
     *  its unmount — two mounted forms would make `screen` queries ambiguous. */
    async function openAddForm(vertical: string) {
      list.mockResolvedValue(listData([], { effective: vertical, source: 'merchant' }));
      const { unmount } = renderManager();
      fireEvent.click(await screen.findByText('Add manually'));
      return { name: await screen.findByLabelText('Name'), unmount };
    }

    it('teaches a salon with a salon example, not with AC maintenance', async () => {
      const { name } = await openAddForm('beauty');
      expect(name).toHaveAttribute('placeholder', 'e.g. Haircut & styling');
    });

    it('teaches a restaurant with a dish, not with a generic product', async () => {
      const { name } = await openAddForm('restaurant');
      expect(name).toHaveAttribute('placeholder', 'e.g. Chicken shawarma meal');
    });

    it('keeps the type example for a vertical with no tailored one', async () => {
      const { name } = await openAddForm('services');
      expect(name).toHaveAttribute('placeholder', 'e.g. AC cleaning & maintenance');
    });

    it('falls back to the type example when the merchant switches the type chip', async () => {
      const { name } = await openAddForm('beauty');
      expect(name).toHaveAttribute('placeholder', 'e.g. Haircut & styling');
      // A salon adding a training course must not be taught with a haircut.
      fireEvent.click(screen.getByRole('button', { name: 'Course' }));
      expect(screen.getByLabelText('Name')).toHaveAttribute('placeholder', 'e.g. ICDL course — beginner level');
    });

    it('no longer shows the same example to every trade', async () => {
      const beauty = await openAddForm('beauty');
      const beautyPlaceholder = beauty.name.getAttribute('placeholder');
      beauty.unmount();
      const electronics = await openAddForm('electronics');
      expect(electronics.name.getAttribute('placeholder')).not.toBe(beautyPlaceholder);
    });
  });

  it('opens the scan review from the empty-state footnote', async () => {
    scanPage.mockResolvedValue({ data: { items: [], dropped: 0, overflow: 0, remainingCapacity: 300, truncated: false, postsScanned: 0, repliesScanned: 0, upToDate: true, postsUnavailable: null } });
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: /Extract your products from your page/ }));
    expect(await screen.findByText('You’re up to date')).toBeInTheDocument();
    expect(scanPage).toHaveBeenCalledWith('p1');
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

    const nameInput = await screen.findByLabelText('Name');
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

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'دورة ميكانيك' } });
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

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'عرض' } });
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

  // Phase C: after an import, CatalogManager's onDone decides whether to offer
  // the KB cleanup sheet (product/field line still in the KB). Drive a full
  // import to completion and assert the decision both ways.
  const extractOneItem = (name: string) => extract.mockResolvedValue({
    data: {
      items: [{ type: 'product', name, price: '22', currency: 'ريال', isAvailable: true, startsAt: null, endsAt: null, attributes: null, description: null }],
      dropped: [], overflow: false, truncated: false,
    },
  });
  async function driveImport(text: string) {
    fireEvent.click(await screen.findByRole('button', { name: 'Import a list' }));
    fireEvent.change(await screen.findByLabelText('Your list'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /Extract items/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Add 1 item/i }));
  }

  it('onDone: opens the cleanup sheet when the KB still holds the moved product line', async () => {
    const oil = item({ id: 'oil', name: 'زيت موتول', price: '22.00' });
    // Empty BEFORE the import (a pre-existing identical item would make the
    // reconcile step auto-deselect the proposal); the onDone fetchQuery sees it.
    list.mockResolvedValueOnce(listData([])).mockResolvedValue(listData([oil]));
    extractOneItem('زيت موتول');
    batchCreate.mockResolvedValue({ data: [oil] });
    const page = { id: 'p1', name: 'Moto', knowledgeBase: 'زيت موتول 18 ريال', businessProfile: {} } as unknown as Page;

    renderManager({ page });
    await driveImport('زيت موتول 22 ريال');

    expect(await screen.findByText('Tidy up your Business Info')).toBeInTheDocument();
  });

  it('onDone: does NOT open the sheet when nothing in the KB matches (fall-through)', async () => {
    const candle = item({ id: 'c', name: 'شمعة معطرة', price: '22.00' });
    list.mockResolvedValueOnce(listData([])).mockResolvedValue(listData([candle]));
    extractOneItem('شمعة معطرة');
    batchCreate.mockResolvedValue({ data: [candle] });
    // KB has only hours prose + no confirmed fields → neither matcher fires.
    const page = { id: 'p1', name: 'Shop', knowledgeBase: 'نفتح من ٩ صباحاً', businessProfile: {} } as unknown as Page;

    renderManager({ page });
    await driveImport('شمعة معطرة 22 ريال');

    await waitFor(() => expect(batchCreate).toHaveBeenCalled());
    expect(screen.queryByText('Tidy up your Business Info')).not.toBeInTheDocument();
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
