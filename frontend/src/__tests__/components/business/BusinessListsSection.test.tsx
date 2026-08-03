import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessListsSection } from '@/components/business/BusinessListsSection';
import { factCollectionsApi, type FactCollectionWithRows } from '@/lib/api';
// Import the real copy rather than hardcoding it — a reworded key must not
// silently turn this assertion into a no-op (project rule for E2E, same logic).
import en from '@/i18n/en/business.json';
import common from '@/i18n/en/common.json';

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

  // A failed load must never be mistaken for an empty one: rendering null on
  // error told the merchant "you have no lists" when their data was simply
  // unreachable — and reported nothing, so nobody could see it happening.
  it('shows an error state with a retry when the load FAILS — not the empty state', async () => {
    vi.mocked(factCollectionsApi.list).mockRejectedValue(new Error('network down'));
    renderSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.lists.loadFailed);
    expect(screen.getByRole('button', { name: common.tryAgain })).toBeInTheDocument();
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

    // Notion model: fields are collapsed property rows — the price row shows
    // its value inline, and expanding a row reveals its control. The weekday
    // chips seed from the complete parse of «الأحد والثلاثاء».
    expect(screen.getAllByLabelText('Name')[0]).toHaveValue('دورة ICDL');
    fireEvent.click(screen.getAllByRole('button', { name: /Price/ })[0]);
    expect(screen.getAllByLabelText('Price')[0]).toHaveValue('35000');
    fireEvent.click(screen.getAllByRole('button', { name: /الأيام/ })[0]);
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
    fireEvent.click(screen.getAllByRole('button', { name: /الأيام/ })[0]);
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
    fireEvent.click(screen.getAllByRole('button', { name: /الأيام/ })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Type it manually' })[0]);

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

  it('ambiguous times PREFILL the pickers as a flagged guess; save confirms — string byte-identical, shadow disambiguated', async () => {
    const slots = slotCollection();
    slots.rows = slots.rows.map((r) => ({
      ...r,
      attributes: [...(r.attributes ?? []), { label: 'الساعة', value: r.id === 'slot-live' ? '12-1' : '5-6' }],
    }));
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [priceCollection(), slots] } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);

    // Recognition over recall: «12-1» populated the pickers (12:00 → 13:00),
    // the row is flagged «auto», and expanding it shows the full hint.
    expect(screen.getAllByText('auto').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /الساعة/ })[0]);
    const label13 = '13:00';
    expect(screen.getAllByText(/Read automatically from the text/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('To')[0].textContent).toContain(label13);

    // Saving untouched confirms: the stored string is BYTE-IDENTICAL «12-1»,
    // only the shadow is new.
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenCalledWith(
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

    // Reopen and actually EDIT the end time through the consistent picker:
    // the stored string regenerates to the merchant's compact form.
    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: /الساعة/ })[0]);
    fireEvent.click(screen.getAllByLabelText('To')[0]);
    const label14 = '14:00';
    fireEvent.click(screen.getAllByRole('button', { name: label14 })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    await waitFor(() => expect(factCollectionsApi.saveEntity).toHaveBeenLastCalledWith(
      PAGE,
      expect.objectContaining({
        upserts: expect.arrayContaining([
          expect.objectContaining({
            collectionId: 'coll-slots',
            attributes: expect.arrayContaining([{ label: 'الساعة', value: '12-2' }]),
            structured: expect.objectContaining({
              'الساعة': { kind: 'timeRange', start: '12:00', end: '14:00' },
            }),
          }),
        ]),
      }),
    ));
  });

  it('«قادمة» counts only rows with a REAL future start — undated announced sessions get the neutral badge', async () => {
    // The makeup row keeps the collection date-bearing; ICDL's own session is
    // undated («تبدأ عند اكتمال العدد» shape) and must NOT read as «قادمة».
    const slots = slotCollection();
    slots.rows[0] = {
      ...slots.rows[0],
      id: 'slot-undated',
      startsAt: null, endsAt: null,
    };
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [priceCollection(), slots] } } as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    expect(screen.getByText('1 announced date')).toBeInTheDocument();
    expect(screen.queryByText(/upcoming/)).toBeNull();
  });

  it('the entity save strips the legacy endsAt=startsAt artifact — sessions go out with endsAt null', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    fireEvent.click((await screen.findByText(/8 جلسات/)).closest('button') as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: /Start date/ })[0]);
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
    // …rows are GROUPED under the key value (the merchant's search axis —
    // the same axis reply-time gating matches): the area is a group header
    // with a count, said once — NOT repeated inside each row.
    expect(screen.getByText('حي الرمال')).toBeInTheDocument();
    expect(screen.getByText('تلة الريح')).toBeInTheDocument();
    expect(screen.getByText('حي الرمال').nextElementSibling?.textContent).toBe('2');
    const rowBtn = screen.getByText('صيدلية الفيروز').closest('button');
    expect(rowBtn?.textContent).not.toContain('المنطقة');
    expect(rowBtn?.textContent).not.toContain('تلة الريح');
    // Name-only rows compress into chips: no full-row «تعديل» label, the
    // pencil icon alone marks editability.
    expect(rowBtn?.textContent).not.toContain('تعديل');
    // Each group carries its own prefilled add action.
    const groupAdds = screen.getAllByRole('button', { name: /Add item — / });
    expect(groupAdds).toHaveLength(2);
    // …and no dates block leaks into an undated business.
    expect(screen.queryByText(/يبدأ|starts/)).toBeNull();
  });

  it('a grouped directory add action prefills the group key value', async () => {
    const outlets: FactCollectionWithRows = {
      id: 'coll-outlets',
      label: 'الصيدليات التي تتوفر فيها منتجاتنا',
      keyAttr: 'المنطقة',
      isComplete: true,
      rowCount: 2,
      rows: [
        { id: 'o1', name: 'صيدلية النرجس', attributes: [{ label: 'المنطقة', value: 'حي الرمال' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        { id: 'o2', name: 'صيدلية الياقوتة', attributes: [{ label: 'المنطقة', value: 'حي الرمال' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
      ],
    };
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [outlets] } } as any);
    renderSection();

    await screen.findByText('صيدلية النرجس');
    fireEvent.click(screen.getByRole('button', { name: 'Add item — حي الرمال' }));
    // The row sheet opens with the group's area already filled in.
    expect(screen.getByLabelText('المنطقة')).toHaveValue('حي الرمال');
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
