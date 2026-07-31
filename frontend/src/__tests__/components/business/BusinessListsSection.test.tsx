import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessListsSection } from '@/components/business/BusinessListsSection';
import { factCollectionsApi, type FactCollectionWithRows } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    factCollectionsApi: {
      list: vi.fn(),
      addRow: vi.fn(),
      updateRow: vi.fn(),
      deleteRow: vi.fn(),
      setCompleteness: vi.fn(),
    },
  };
});

const PAGE = 'page-1';

/** Dates chosen relative to NOW so the expired split can't rot: the section
 *  groups by comparison with today, exactly like the fixture's relative slots. */
const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

/** Two collections shaped like the real pilot page: an un-keyed price list and
 *  a keyed schedule list that both talk about the same course. */
const priceCollection = (over: Partial<FactCollectionWithRows> = {}): FactCollectionWithRows => ({
  id: 'coll-prices',
  label: 'أسعار الدورات',
  keyAttr: null,
  isComplete: true,
  rowCount: 2,
  rows: [
    {
      id: 'price-icdl', name: 'دورة ICDL', price: '35000.00', currency: 'ل.س قديمة',
      attributes: [{ label: 'ملاحظة', value: '8 جلسات' }],
      startsAt: null, endsAt: null, isAvailable: true,
    },
    {
      id: 'price-makeup', name: 'دورة المكياج', price: '35000.00', currency: 'ل.س قديمة',
      attributes: null,
      startsAt: null, endsAt: null, isAvailable: true,
    },
  ],
  ...over,
});

const slotCollection = (over: Partial<FactCollectionWithRows> = {}): FactCollectionWithRows => ({
  id: 'coll-slots',
  label: 'مواعيد الدورات المعلنة',
  keyAttr: 'الدورة',
  isComplete: null,
  rowCount: 2,
  rows: [
    {
      id: 'slot-live', name: 'دورة ICDL', price: null, currency: null,
      attributes: [{ label: 'الدورة', value: 'ICDL' }, { label: 'الأيام', value: 'الأحد والثلاثاء' }],
      startsAt: future, endsAt: future, isAvailable: true,
    },
    {
      id: 'slot-expired', name: 'دورة المكياج', price: null, currency: null,
      attributes: [{ label: 'الدورة', value: 'مكياج' }, { label: 'الأيام', value: 'السبت' }],
      startsAt: past, endsAt: past, isAvailable: true,
    },
  ],
  ...over,
});

const bothCollections = () => [priceCollection(), slotCollection()];

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BusinessListsSection pageId={PAGE} />
    </QueryClientProvider>,
  );
}

describe('BusinessListsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders NOTHING for a page without collections — absence is the rollout gate', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [] } } as any);
    const { container } = renderSection();
    await waitFor(() => expect(factCollectionsApi.list).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows ONE card per entity — the course name appears once even when it has a price row AND a slot row', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    expect(await screen.findAllByText('دورة ICDL')).toHaveLength(1);
    // Its price and its schedule render INSIDE that one card as row meta.
    expect(screen.getByText(/8 جلسات · 35000 ل\.س قديمة/)).toBeInTheDocument();
    expect(screen.getByText(/الأحد والثلاثاء/)).toBeInTheDocument();
  });

  it('drops the key value from row meta — the card title already names the entity', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    // The slot row's meta must not repeat «ICDL» (its الدورة key value).
    const slotMeta = screen.getByText(/الأحد والثلاثاء/);
    expect(slotMeta.textContent).not.toContain('ICDL');
  });

  it('hides an expired slot behind the card toggle without hiding the entity card', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    // المكياج card is visible (it has a live price row)…
    expect(await screen.findAllByText('دورة المكياج')).toHaveLength(1);
    // …but its expired slot's meta is not, until the toggle is expanded.
    expect(screen.queryByText(/السبت/)).toBeNull();

    fireEvent.click(screen.getByText('1 expired row'));
    expect(screen.getByText(/السبت/)).toBeInTheDocument();
  });

  it('asks the completeness question per LIST (not per card) while un-asked, and sends the tri-state answer', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.setCompleteness).mockResolvedValue({} as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    // Only the slot collection is un-asked → exactly one question row.
    fireEvent.click(screen.getByText('Yes, complete'));
    expect(factCollectionsApi.setCompleteness).toHaveBeenCalledWith(PAGE, 'coll-slots', true);
  });

  it('shows the confirmed state (not the question) once answered', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({
      data: { data: [priceCollection()] },
    } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    expect(screen.queryByText('Yes, complete')).toBeNull();
    expect(screen.getByText(/confident/)).toBeInTheDocument();
  });

  it('opens the row sheet from a card row and PATCHes through the API on save', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.updateRow).mockResolvedValue({ data: { data: {} } } as any);
    renderSection();

    fireEvent.click(await screen.findByText(/8 جلسات · 35000/));
    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'دورة ICDL مسائية' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(factCollectionsApi.updateRow).toHaveBeenCalledWith(
      PAGE, 'coll-prices', 'price-icdl',
      expect.objectContaining({ name: 'دورة ICDL مسائية' }),
    ));
  });

  it('adding from a card PREFILLS the entity name and key value, and POSTs to the right collection', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.addRow).mockResolvedValue({ data: { data: {} } } as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    // Two-step add: the quiet «+» expands to per-list choices (there are two
    // lists on this page), then the schedule list is picked.
    fireEvent.click(screen.getAllByText('Add')[0]);
    fireEvent.click(screen.getByRole('button', { name: /مواعيد الدورات المعلنة/ }));

    // Name and the key attribute arrive prefilled from the card.
    expect(screen.getByLabelText('Name')).toHaveValue('دورة ICDL');
    expect(screen.getByLabelText('الدورة')).toHaveValue('ICDL');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(factCollectionsApi.addRow).toHaveBeenCalledWith(
      PAGE, 'coll-slots',
      expect.objectContaining({
        name: 'دورة ICDL',
        attributes: expect.arrayContaining([{ label: 'الدورة', value: 'ICDL' }]),
      }),
    ));
  });
});
