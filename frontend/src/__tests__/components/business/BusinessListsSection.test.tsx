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
      saveEntity: vi.fn(),
    },
  };
});

const PAGE = 'page-1';

/** Dates chosen relative to NOW so the expired split can't rot: the section
 *  splits by comparison with today, exactly like the fixture's relative slots. */
const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

/** Two collections shaped like the real pilot page: an un-keyed price list and
 *  a keyed schedule list that both talk about the same courses. */
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

  it('shows ONE card per entity with a labelled SECTION per list — the course name once, the list names as section headers', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    expect(await screen.findAllByText('دورة ICDL')).toHaveLength(1);
    // Each collection label appears once as the completeness strip AND once
    // per card section that has rows. ICDL card has both sections.
    expect(screen.getAllByText('أسعار الدورات').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('مواعيد الدورات المعلنة').length).toBeGreaterThanOrEqual(2);
  });

  it('renders every value WITH its label, price without raw column form, and no bare ISO dates', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    // label: value pairs
    expect(screen.getByText('ملاحظة:')).toBeInTheDocument();
    expect(screen.getByText(/8 جلسات/)).toBeInTheDocument();
    expect(screen.getByText('الأيام:')).toBeInTheDocument();
    expect(screen.getByText('الأحد والثلاثاء')).toBeInTheDocument();
    // price formatted, never "35000.00"
    expect(screen.getAllByText(/35000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/35000\.00/)).toBeNull();
    // the live slot's date renders formatted — the raw ISO string must not appear
    expect(document.body.textContent).not.toContain(future);
  });

  it('drops the key value from row display — the card title already names the entity', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    const slotRow = screen.getByText('الأحد والثلاثاء').closest('button');
    expect(slotRow?.textContent).not.toContain('ICDL');
  });

  it('hides an expired slot behind the card toggle without hiding the entity card', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    expect(await screen.findAllByText('دورة المكياج')).toHaveLength(1);
    expect(screen.queryByText('السبت')).toBeNull();

    fireEvent.click(screen.getByText('1 expired row'));
    expect(screen.getByText('السبت')).toBeInTheDocument();
  });

  it('expiry keys on the START date — a past start with a future end is expired (owner ruling)', async () => {
    const slots = slotCollection();
    slots.rows[1] = { ...slots.rows[1], startsAt: past, endsAt: future };
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [priceCollection(), slots] } } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    // Still behind the expired toggle despite the future endsAt.
    expect(screen.queryByText('السبت')).toBeNull();
    expect(screen.getByText('1 expired row')).toBeInTheDocument();
  });

  it('asks the completeness question per LIST while un-asked, and sends the tri-state answer', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.setCompleteness).mockResolvedValue({} as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    fireEvent.click(screen.getByText('Yes, complete'));
    expect(factCollectionsApi.setCompleteness).toHaveBeenCalledWith(PAGE, 'coll-slots', true);
  });

  it('tapping a row opens the ITEM as one form — price and its sessions together — and saves atomically', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);

    // One screen: the name once, the price, AND the session's fields.
    expect(screen.getByLabelText('Name')).toHaveValue('دورة ICDL');
    expect(screen.getByLabelText('Price')).toHaveValue('35000');
    expect(screen.getByLabelText('الأيام')).toHaveValue('الأحد والثلاثاء');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'دورة ICDL مسائية' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({ collectionId: 'coll-prices', rowId: 'price-icdl', name: 'دورة ICDL مسائية' }),
          expect.objectContaining({ collectionId: 'coll-slots', rowId: 'slot-live', name: 'دورة ICDL مسائية' }),
        ]),
      }),
    ));
  });

  it('the entity save strips the legacy endsAt=startsAt artifact — sessions go out with endsAt null', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    expect(screen.getByLabelText('End date (optional)')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'دورة ICDL م' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({ collectionId: 'coll-slots', startsAt: future, endsAt: null }),
        ]),
      }),
    ));
  });

  it('adding from a card PREFILLS the entity name and key value, and POSTs to the right collection', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.addRow).mockResolvedValue({ data: { data: {} } } as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    fireEvent.click(screen.getAllByText('Add')[0]);
    fireEvent.click(screen.getByRole('button', { name: /مواعيد الدورات المعلنة/ }));

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

  it('a directory-shaped page (no entity aggregates) renders ONE compact section per list, not one card per row', async () => {
    const outlets: FactCollectionWithRows = {
      id: 'coll-outlets',
      label: 'الصيدليات التي تتوفر فيها منتجاتنا',
      keyAttr: 'المنطقة',
      isComplete: true,
      rowCount: 3,
      rows: [
        { id: 'o1', name: 'صيدلية النرجس', attributes: [{ label: 'المنطقة', value: 'حي الرمال' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        { id: 'o2', name: 'صيدلية الياقوتة', attributes: [{ label: 'المنطقة', value: 'حي الرمال' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        { id: 'o3', name: 'صيدلية الفيروز', attributes: [{ label: 'المنطقة', value: 'تلة الريح' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
      ],
    };
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [outlets] } } as any);
    renderSection();

    await screen.findByText('صيدلية النرجس');
    // ONE h3 (the list), not one per pharmacy…
    const headings = document.querySelectorAll('h3');
    expect(headings).toHaveLength(1);
    // …rows show their own names WITH their labelled area…
    const rowBtn = screen.getByText('صيدلية الفيروز').closest('button');
    expect(rowBtn?.textContent).toContain('المنطقة');
    expect(rowBtn?.textContent).toContain('تلة الريح');
    // …and no dates block leaks into an undated business.
    expect(screen.queryByText(/يبدأ|starts/)).toBeNull();
  });

  it('the merchant can author a NEW field, and a label colliding with the list key is refused', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.addRow).mockResolvedValue({ data: { data: {} } } as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    fireEvent.click(screen.getAllByText('Add')[0]);
    fireEvent.click(screen.getByRole('button', { name: /مواعيد الدورات المعلنة/ }));
    fireEvent.click(screen.getByText('Add a field'));

    const labelInput = screen.getByLabelText('Field name');
    // Colliding with the key attribute is refused with a visible error…
    fireEvent.change(labelInput, { target: { value: 'الدورة' } });
    expect(screen.getByText('This field name is already used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // …a fresh label saves through as a new attribute.
    fireEvent.change(labelInput, { target: { value: 'الوصف' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'محاسبة عملية' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(factCollectionsApi.addRow).toHaveBeenCalledWith(
      PAGE, 'coll-slots',
      expect.objectContaining({
        attributes: expect.arrayContaining([{ label: 'الوصف', value: 'محاسبة عملية' }]),
      }),
    ));
  });
});
