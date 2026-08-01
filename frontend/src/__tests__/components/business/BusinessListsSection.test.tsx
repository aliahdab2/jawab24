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

  it('ONE card per entity, and the dates sit DIRECTLY under their price line — nothing far apart', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    expect(await screen.findAllByText('دورة ICDL')).toHaveLength(1);
    // The session row is NESTED under the price row inside the same card:
    // it lives in the indented (border-inline-start) list, in the same card div.
    const sessionZone = screen.getByText('الأحد والثلاثاء').closest('div.rounded-xl.bg-muted\\/40');
    expect(sessionZone).not.toBeNull();
    const card = screen.getByText('دورة ICDL').closest('div.rounded-xl');
    expect(card?.contains(screen.getByText(/8 جلسات/))).toBe(true);
    expect(card?.contains(screen.getByText('الأحد والثلاثاء'))).toBe(true);
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
    // price formatted with digit grouping, never the raw column form
    expect(screen.getAllByText(/35,000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/35000\.00/)).toBeNull();
    // the live slot's date renders formatted — the raw ISO string must not appear
    expect(document.body.textContent).not.toContain(future);
  });

  it('drops the key value from row display — the card title already names the entity', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    const slotRow = screen.getByText('الأحد والثلاثاء').closest('li');
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

    // One screen: the name once, the price, AND the session's fields. The
    // weekday field renders as CHIPS seeded from the complete parse of
    // «الأحد والثلاثاء» (test UI locale is en, so chips carry English names).
    // (SidePanel renders desktop + mobile layouts, so fields appear twice.)
    expect(screen.getAllByLabelText('Name')[0]).toHaveValue('دورة ICDL');
    expect(screen.getAllByLabelText('Price')[0]).toHaveValue('35000');
    expect(screen.getAllByRole('button', { name: 'Sunday' })[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: 'Tuesday' })[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: 'Monday' })[0]).toHaveAttribute('aria-pressed', 'false');

    fireEvent.change(screen.getAllByLabelText('Name')[0], { target: { value: 'دورة ICDL مسائية' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    // The stored string is regenerated BYTE-IDENTICAL in the data's own
    // language (ar) despite the en UI, and the shadow rides along.
    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({ collectionId: 'coll-prices', rowId: 'price-icdl', name: 'دورة ICDL مسائية' }),
          expect.objectContaining({
            collectionId: 'coll-slots', rowId: 'slot-live', name: 'دورة ICDL مسائية',
            attributes: expect.arrayContaining([{ label: 'الأيام', value: 'الأحد والثلاثاء' }]),
            structured: { 'الأيام': { kind: 'weekdays', days: [0, 2] } },
          }),
        ]),
      }),
    ));
  });

  it('toggling a day chip regenerates the stored Arabic string and updates the shadow', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: 'Wednesday' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({
            collectionId: 'coll-slots',
            attributes: expect.arrayContaining([{ label: 'الأيام', value: 'الأحد والثلاثاء والأربعاء' }]),
            structured: { 'الأيام': { kind: 'weekdays', days: [0, 2, 3] } },
          }),
        ]),
      }),
    ));
  });

  it('the free-text escape hatch shows the generated string and drops the shadow', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: 'Use custom text' })[0]);

    const input = screen.getAllByLabelText('الأيام').find((el) => el.tagName === 'INPUT') as HTMLInputElement;
    expect(input).toHaveValue('الأحد والثلاثاء');
    fireEvent.change(input, { target: { value: 'الأحد والثلاثاء بعد العصر' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({
            collectionId: 'coll-slots',
            attributes: expect.arrayContaining([{ label: 'الأيام', value: 'الأحد والثلاثاء بعد العصر' }]),
            structured: null,
          }),
        ]),
      }),
    ));
  });

  it('a time-shaped field gets from/to pickers; untouched pickers keep the original string, set ones regenerate it', async () => {
    const slots = slotCollection();
    slots.rows = slots.rows.map((r) => ({
      ...r,
      attributes: [...(r.attributes ?? []), { label: 'الساعة', value: r.id === 'slot-live' ? '12-1' : '5-6' }],
    }));
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [priceCollection(), slots] } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);

    // Pickers start EMPTY — «12-1» is ambiguous and is never guessed into
    // clock times; the original string is shown as the current text.
    const from = screen.getAllByLabelText('From')[0] as HTMLInputElement;
    expect(from).toHaveValue('');
    expect(screen.getAllByText(/12-1/).length).toBeGreaterThan(0);

    // First save without touching: the time string survives verbatim and no
    // TIME shadow ships (the weekday field's complete parse still ships its
    // own — that value is byte-identical, so nothing merchant-visible moved).
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({
            collectionId: 'coll-slots',
            attributes: expect.arrayContaining([{ label: 'الساعة', value: '12-1' }]),
            structured: { 'الأيام': { kind: 'weekdays', days: [0, 2] } },
          }),
        ]),
      }),
    ));

    // The successful save closed the sheet — reopen, then set both times: the
    // string regenerates in the merchant's compact form and the disambiguated
    // shadow ships.
    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    fireEvent.change(screen.getAllByLabelText('From')[0], { target: { value: '12:00' } });
    fireEvent.change(screen.getAllByLabelText('To')[0], { target: { value: '13:00' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenLastCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({
            collectionId: 'coll-slots',
            attributes: expect.arrayContaining([{ label: 'الساعة', value: '12-1' }]),
            structured: {
              'الأيام': { kind: 'weekdays', days: [0, 2] },
              'الساعة': { kind: 'timeRange', start: '12:00', end: '13:00' },
            },
          }),
        ]),
      }),
    ));
  });

  it('session groups collapse behind their count line and start EXPANDED (owner ruling over expert default)', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    // Expanded by default — the session values are visible without a click.
    expect(await screen.findByText('الأحد والثلاثاء')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: '1 upcoming date' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByText('الأحد والثلاثاء')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('الأحد والثلاثاء')).toBeInTheDocument();
  });

  it('a lone session in the entity form carries no number — «الموعد 1» only appears with peers', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    // (SidePanel double-renders — assert on presence/absence, not counts.)
    expect(screen.getAllByText('Date').length).toBeGreaterThan(0);
    expect(screen.queryByText('Date 1')).toBeNull();

    fireEvent.click(screen.getAllByText('Add another date')[0]);
    expect(screen.queryByText('Date')).toBeNull();
    expect(screen.getAllByText('Date 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Date 2').length).toBeGreaterThan(0);
  });

  it('multiple sessions in the form render as collapsed summaries; tapping one expands its fields', async () => {
    const slots = slotCollection();
    const secondFuture = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    slots.rows = [
      slots.rows[0],
      { id: 'slot-live-2', name: 'دورة ICDL', price: null, currency: null,
        attributes: [{ label: 'الدورة', value: 'ICDL' }, { label: 'الأيام', value: 'السبت فقط' }],
        startsAt: secondFuture, endsAt: null, isAvailable: true },
    ];
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [priceCollection(), slots] } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);

    // Both sessions collapsed: no editable fields, summaries carry the values.
    // The weekday summary renders in the VIEWER's locale (en in tests) from
    // the structured value — presentation is free; storage stays Arabic.
    expect(screen.queryAllByLabelText('الأيام')).toHaveLength(0);
    const summary = screen.getAllByRole('button', { name: /Sunday and Tuesday/ })[0];
    expect(summary).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(summary);
    expect(screen.getAllByRole('button', { name: 'Sunday' })[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('entity delete lives in a danger zone at the form end, two-step, and deletes all the item rows', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm full deletion' })[0]);

    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: [],
        deletes: expect.arrayContaining([
          expect.objectContaining({ rowId: 'price-icdl' }),
          expect.objectContaining({ rowId: 'slot-live' }),
        ]),
      }),
    ));
  });

  it('a card\'s ONLY unlabelled price row reads «Base price» — never a bare number as a title', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();
    await screen.findByText('دورة المكياج');
    // price-makeup has no attributes and is its card's sole price row.
    expect(screen.getByText('Base price')).toBeInTheDocument();
  });

  it('the empty-sessions hint appears ONCE per card; later empty tiers keep only the add action', async () => {
    const prices: FactCollectionWithRows = {
      id: 'coll-p', label: 'أسعار الدورات', keyAttr: null, isComplete: true, rowCount: 2,
      rows: [
        { id: 'p1', name: 'دورة برمجة', price: '10000', currency: null,
          attributes: [{ label: 'المستوى', value: 'مبتدئ' }], startsAt: null, endsAt: null, isAvailable: true },
        { id: 'p2', name: 'دورة برمجة', price: '20000', currency: null,
          attributes: [{ label: 'المستوى', value: 'متقدم' }], startsAt: null, endsAt: null, isAvailable: true },
      ],
    };
    const slots = slotCollection({
      rows: [{ id: 's1', name: 'دورة برمجة', price: null, currency: null,
        attributes: [{ label: 'الدورة', value: 'برمجة' }], startsAt: past, endsAt: past, isAvailable: true }],
      rowCount: 1,
    });
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [prices, slots] } } as any);
    renderSection();

    await screen.findByText('مبتدئ');
    expect(screen.getAllByText(/No announced dates yet/)).toHaveLength(1);
    expect(screen.getAllByText('Add the first date')).toHaveLength(2);
  });

  it('the entity save strips the legacy endsAt=startsAt artifact — sessions go out with endsAt null', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    expect(screen.getAllByLabelText('End date (optional)')[0]).toHaveValue('');
    fireEvent.change(screen.getAllByLabelText('Name')[0], { target: { value: 'دورة ICDL م' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({ collectionId: 'coll-slots', startsAt: future, endsAt: null }),
        ]),
      }),
    ));
  });

  it('the card\'s named add targets the base list with the entity name prefilled', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.addRow).mockResolvedValue({ data: { data: {} } } as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    fireEvent.click(screen.getAllByText('Add item')[0]);

    expect(screen.getByLabelText('Name')).toHaveValue('دورة ICDL');
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '40000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(factCollectionsApi.addRow).toHaveBeenCalledWith(
      PAGE, 'coll-prices',
      expect.objectContaining({ name: 'دورة ICDL', price: '40000' }),
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
    fireEvent.click(screen.getAllByText('Add item')[0]);
    fireEvent.click(screen.getByText('Add a field'));

    const labelInput = screen.getByLabelText('Field name');
    // Colliding with an existing field is refused with a visible error…
    fireEvent.change(labelInput, { target: { value: 'ملاحظة' } });
    expect(screen.getByText('This field name is already used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // …a fresh label saves through as a new attribute.
    fireEvent.change(labelInput, { target: { value: 'الوصف' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'محاسبة عملية' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(factCollectionsApi.addRow).toHaveBeenCalledWith(
      PAGE, 'coll-prices',
      expect.objectContaining({
        attributes: expect.arrayContaining([{ label: 'الوصف', value: 'محاسبة عملية' }]),
      }),
    ));
  });
});
