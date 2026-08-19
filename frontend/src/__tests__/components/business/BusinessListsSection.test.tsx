import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessListsSection } from '@/components/business/BusinessListsSection';
import { factCollectionsApi, type FactCollectionWithRows } from '@/lib/api';
import { dismissTopModal } from '@/hooks/useModalBackHandler';
import { MAX_LIST_LABEL_LENGTH } from '@jawab24/shared';
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
      createCollection: vi.fn(),
      renameCollection: vi.fn(),
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


function renderSection(props: { readOnly?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BusinessListsSection pageId={PAGE} {...props} />
    </QueryClientProvider>,
  );
}

/** Entity cards start COLLAPSED (owner ruling 2026-08-05) — the header row is
 *  the toggle. Open one by its entity title before asserting card content. */
async function openCard(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(title) }));
}

describe('BusinessListsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  /** Per-list management actions (rename · delete · completeness) live behind
   *  the list's ⋯ menu since the crowding fix (2026-08-11): twelve flat
   *  buttons above the content became one line per list. Tests reach the
   *  doors the way a merchant now does — through the menu. */
  const openListMenu = async (label: string) => {
    fireEvent.click(await screen.findByRole('button', {
      name: en.lists.listOptionsFor.replace('{list}', label),
    }));
  };

  // The old rollout gate (absence = nothing rendered, for everyone) split with
  // the G1b creation UI: an ADMIN now gets the «add list» door instead of a
  // dead end, while a plain member still sees nothing — every affordance in
  // the empty state is a write a member may not perform.
  it('a page without collections offers an admin the «add list» empty state', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [] } } as any);
    renderSection();
    expect(await screen.findByRole('button', { name: en.lists.addList })).toBeInTheDocument();
    expect(screen.getByText(en.lists.emptyHint)).toBeInTheDocument();
  });

  it('renders NOTHING for a member on a page without collections', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [] } } as any);
    const { container } = renderSection({ readOnly: true });
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
    await openCard('دورة ICDL');
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
    await openCard('دورة ICDL');
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
    await openCard('دورة ICDL');
    const slotRow = screen.getByText('الأحد والثلاثاء').closest('li');
    expect(slotRow?.textContent).not.toContain('ICDL');
  });

  it('hides an expired slot behind the card toggle without hiding the entity card', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    renderSection();

    expect(await screen.findAllByText('دورة المكياج')).toHaveLength(1);
    await openCard('دورة المكياج');
    expect(screen.queryByText('السبت')).toBeNull();

    fireEvent.click(screen.getByText('1 expired row'));
    expect(screen.getByText('السبت')).toBeInTheDocument();
  });

  it('expiry keys on the START date — a past start with a future end is expired (owner ruling)', async () => {
    const slots = slotCollection();
    slots.rows[1] = { ...slots.rows[1], startsAt: past, endsAt: future };
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [priceCollection(), slots] } } as any);
    renderSection();
    await openCard('دورة المكياج');
    // Still behind the expired toggle despite the future endsAt.
    expect(screen.queryByText('السبت')).toBeNull();
    expect(screen.getByText('1 expired row')).toBeInTheDocument();
  });

  it('asks the completeness question in the LIST\'s own ⋯ menu, and sends the tri-state answer', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.setCompleteness).mockResolvedValue({} as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    await openListMenu('مواعيد الدورات المعلنة');
    fireEvent.click(screen.getByText('Yes, complete'));
    expect(factCollectionsApi.setCompleteness).toHaveBeenCalledWith(PAGE, 'coll-slots', true);
  });

  it('tapping a row opens the ITEM as one form — price and its sessions together — and saves atomically', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    await openCard('دورة ICDL');
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

    await openCard('دورة ICDL');
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

    await openCard('دورة ICDL');
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

    await openCard('دورة ICDL');
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
    // the stored string regenerates to the merchant's compact form. The card
    // itself is still open — openCard here would toggle it shut.
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
    // …and the neutral badge states the FACT (no date), not «announced date» —
    // a row with no date is not a date, in any vertical.
    expect(screen.getByText('1 row with no date')).toBeInTheDocument();
    expect(screen.queryByText(/upcoming/)).toBeNull();
  });

  it('the entity save strips the legacy endsAt=startsAt artifact — sessions go out with endsAt null', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
    vi.mocked(factCollectionsApi.saveEntity).mockResolvedValue({ data: { data: { upserted: [], deletedIds: [] } } } as any);
    renderSection();

    await openCard('دورة ICDL');
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

    await openCard('دورة ICDL');
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

    await openCard('دورة ICDL');
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

  describe('collapsed entity cards (owner ruling 2026-08-05)', () => {
    it('starts every card collapsed to one line that still answers «بقديش؟», and opens on tap', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await screen.findByText('دورة ICDL');
      // Inner content stays out of the DOM while collapsed…
      expect(screen.queryByText(/8 جلسات/)).toBeNull();
      expect(screen.queryByText('الأحد والثلاثاء')).toBeNull();
      // …but the price does not: the collapsed line carries it, so closing a
      // card never hides the answer customers ask most.
      expect(screen.getByRole('button', { name: /دورة ICDL/ }).textContent).toMatch(/35,000/);
      // Two cards → no search box (it earns its place at 8).
      expect(screen.queryByLabelText(en.lists.searchAllPlaceholder)).toBeNull();

      await openCard('دورة ICDL');
      expect(screen.getByText(/8 جلسات/)).toBeInTheDocument();
      expect(screen.getByText('الأحد والثلاثاء')).toBeInTheDocument();
    });

    /** 8+ cards: the pilot page holds 40 — reaching one specific course must
     *  not be a scroll hunt. A hit renders OPEN: the merchant searched to see
     *  it, not to be handed another closed door. */
    it('offers search from 8 cards up, filters across cards, and opens the hits', async () => {
      const names = ['الريزن', 'الفوتوشوب', 'الإكسل', 'التمريض', 'المكياج', 'الحلاقة', 'الخياطة', 'الطبخ'];
      const prices: FactCollectionWithRows = {
        ...priceCollection(),
        id: 'coll-many',
        rowCount: names.length,
        rows: names.map((n, i) => ({
          id: `p-${i}`, name: `دورة ${n}`, price: `${(i + 1) * 10000}.00`, currency: 'ل.س',
          attributes: null, startsAt: null, endsAt: null, isAvailable: true,
        })),
      };
      // One slot shares an entity with the price list, so the layout aggregates.
      const slots = slotCollection({
        rows: [{
          id: 'slot-resin', name: 'دورة الريزن', price: null, currency: null,
          attributes: [{ label: 'الدورة', value: 'الريزن' }],
          startsAt: future, endsAt: future, isAvailable: true,
        }],
      });
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [prices, slots] } } as any);
      renderSection();

      await screen.findByText('دورة الفوتوشوب');
      const box = screen.getByLabelText(en.lists.searchAllPlaceholder);
      fireEvent.change(box, { target: { value: 'الريزن' } });

      // Only the hit remains — and it is OPEN without a tap (its add-item
      // footer is on screen), with the shown/total count announced.
      expect(screen.queryByText('دورة الفوتوشوب')).toBeNull();
      expect(screen.getAllByText('دورة الريزن').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Add item').length).toBeGreaterThan(0);
      // Counts CARDS, so it must not borrow the directory's row wording.
      expect(screen.getByText(/Showing 1 item of 8/)).toBeInTheDocument();

      // Folding matches the data's own spelling («صيدليه» era rule): a taa
      // marbuta / hamza variant still hits.
      fireEvent.change(box, { target: { value: 'الاكسل' } });
      expect(screen.getByText('دورة الإكسل')).toBeInTheDocument();
    });

    /** A min–max span is only honest inside ONE currency. The demo's ICDL card
     *  held a 10.00-USD online tier beside its 35,000-ل.س course, and a naive
     *  span rendered «10–35,000 ل.س» — laundering the dollar figure into lira,
     *  the same failure family as the bundle-unit price bug. The majority
     *  currency's span, alone. */
    it('spans the MAJORITY currency only — a foreign tier is never laundered into it', async () => {
      const row = (id: string, price: string, currency: string) => ({
        id, name: 'دورة ICDL', price, currency,
        attributes: null, startsAt: null, endsAt: null, isAvailable: true,
      });
      const prices = priceCollection({
        rowCount: 3,
        rows: [
          row('p-hall', '35000.00', 'ل.س قديمة'),
          row('p-eve', '40000.00', 'ل.س قديمة'),
          row('p-online', '10.00', 'USD'),
        ],
      });
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [prices, slotCollection()] } } as any);
      renderSection();

      const header = await screen.findByRole('button', { name: /دورة ICDL/ });
      expect(header.textContent).toContain('35,000–40,000 ل.س قديمة');
      // The dollar tier is neither an endpoint of the lira span nor relabelled.
      expect(header.textContent).not.toContain('10–');
      expect(header.textContent).not.toContain('10 ل.س');
    });
  });

  /**
   * «إضافة عنصر» on the entity-card layout — the door that never existed.
   * The per-card «+» only adds rows to an existing entity, so a brand-new
   * course could not be put into ANY list from this layout (owner, 2026-08-11).
   */
  describe('adding a NEW item on the entity-card layout', () => {
    it('expands to per-list chips, and a chip opens the row sheet for THAT list', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await screen.findByText('دورة ICDL');
      fireEvent.click(screen.getByRole('button', { name: en.lists.addItem }));
      fireEvent.click(screen.getByRole('button', { name: `${en.lists.addItem} — أسعار الدورات` }));

      // The existing row sheet, subtitled with the chosen list — same second
      // step as creation, so the flows cannot drift.
      expect(screen.getByRole('heading', { name: en.lists.addRow })).toBeInTheDocument();
      expect(screen.getByText('أسعار الدورات', { selector: 'p' })).toBeInTheDocument();
    });

    it('tapping a row in a list opens THAT row — not the whole list as one item', async () => {
      // The directory row's group is SYNTHETIC — it carries every row in the
      // collection — so routing the tap to the entity sheet opened all 47
      // sessions as a single «item» titled with the LIST's name (owner, 2026-08-11).
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await screen.findByText('دورة ICDL');
      fireEvent.click(screen.getByRole('button', { name: 'مواعيد الدورات المعلنة 2' }));
      // Both sessions are on screen; tap the live one.
      fireEvent.click(screen.getByText(/الأحد والثلاثاء/));

      // The single-row editor, carrying THIS row's values.
      expect(screen.getByRole('heading', { name: en.lists.editRow })).toBeInTheDocument();
      expect((screen.getByLabelText(en.lists.rowName) as HTMLInputElement).value).toBe('دورة ICDL');
      // …and never the entity sheet, whose save spans every row it was given
      // (its footer is «Save changes», the row sheet's is plain «Save»).
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    });

    it('a dated list shows each row\'s DATE — the field the list exists for', async () => {
      // Opening «مواعيد الدورات المعلنة» showed days and times with no date at
      // all: the directory row was built for an outlet list and had no date
      // column, and it is the date that decides whether the AI still mentions
      // the row (owner, 2026-08-11).
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await screen.findByText('دورة ICDL');
      fireEvent.click(screen.getByRole('button', { name: 'مواعيد الدورات المعلنة 2' }));

      // The live slot's day-of-month leads its row, beside its day-name value.
      const day = new Date(future).getDate().toString();
      const dayChip = screen.getAllByTitle(en.lists.startsLabel);
      expect(dayChip.length).toBeGreaterThan(0);
      expect(dayChip[0]).toHaveTextContent(day);
      // The directory row joins its attributes into one «label: value» line.
      expect(screen.getByText(/الأحد والثلاثاء/)).toBeInTheDocument();
    });

    it('an UNDATED list grows no date column — a directory must not be given one', async () => {
      const outlets: FactCollectionWithRows = {
        id: 'coll-outlets', label: 'الصيدليات', keyAttr: 'المنطقة', isComplete: true, rowCount: 1,
        rows: [
          { id: 'o1', name: 'صيدلية النرجس', attributes: [{ label: 'المنطقة', value: 'حي الرمال' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        ],
      };
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [outlets] } } as any);
      renderSection();

      await screen.findByText('صيدلية النرجس');
      expect(screen.queryAllByTitle(en.lists.startsLabel)).toHaveLength(0);
    });

    it('a tapped strip line opens the LIST as a list — its rows, its own add door, no chooser', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await screen.findByText('دورة ICDL');
      // Tap the list's line in the strip (its accessible name = label + count).
      // Filtering the entity CARDS was the first attempt and measured wrong:
      // prices and schedules cover the same courses, so either tap showed the
      // same cards. Now the tap swaps in the DIRECTORY view of that one list.
      fireEvent.click(screen.getByRole('button', { name: 'مواعيد الدورات المعلنة 2' }));

      // The directory card: the list's own heading, the way back, and the
      // entity cards gone (the price-only course has no card on screen).
      expect(screen.getByRole('heading', { name: 'مواعيد الدورات المعلنة' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: en.lists.showAll })).toBeInTheDocument();

      // Its own add door targets THIS list — no chooser step.
      fireEvent.click(screen.getByRole('button', { name: en.lists.addItem }));
      expect(screen.getByRole('heading', { name: en.lists.addRow })).toBeInTheDocument();
      expect(screen.getByText('مواعيد الدورات المعلنة', { selector: 'p' })).toBeInTheDocument();
    });
  });

  describe('«add list» creation flow (G1b creation UI)', () => {
    it('names the list, collects the FIRST item, and creates both in one atomic POST', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [] } } as any);
      vi.mocked(factCollectionsApi.createCollection).mockResolvedValue({ data: { data: { id: 'new' } } } as any);
      renderSection();

      fireEvent.click(await screen.findByRole('button', { name: en.lists.addList }));
      fireEvent.change(screen.getByLabelText(en.lists.newListNameLabel), { target: { value: ' مناطق التوصيل ' } });
      fireEvent.click(screen.getByRole('button', { name: common.continue }));

      // Step 2 is the EXISTING row sheet, subtitled with the (trimmed) new label.
      expect(await screen.findByText('مناطق التوصيل')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(en.lists.rowName), { target: { value: 'وسط المدينة' } });
      fireEvent.click(screen.getByRole('button', { name: common.save }));

      await waitFor(() => expect(factCollectionsApi.createCollection).toHaveBeenCalledWith(PAGE, {
        label: 'مناطق التوصيل',
        rows: [{
          name: 'وسط المدينة',
          attributes: null, price: null, currency: null, startsAt: null, endsAt: null,
          // A new row is available unless the merchant says otherwise.
          isAvailable: true,
        }],
      }));
    });

    it('refuses a name the page already uses, inline, before any request', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      fireEvent.click(await screen.findByRole('button', { name: en.lists.addList }));
      fireEvent.change(screen.getByLabelText(en.lists.newListNameLabel), { target: { value: 'أسعار الدورات' } });

      expect(screen.getByRole('alert')).toHaveTextContent(en.lists.errDuplicateLabel);
      expect(screen.getByRole('button', { name: common.continue })).toBeDisabled();
      expect(factCollectionsApi.createCollection).not.toHaveBeenCalled();
    });

    it('an empty or whitespace name cannot continue', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [] } } as any);
      renderSection();

      fireEvent.click(await screen.findByRole('button', { name: en.lists.addList }));
      expect(screen.getByRole('button', { name: common.continue })).toBeDisabled();
      fireEvent.change(screen.getByLabelText(en.lists.newListNameLabel), { target: { value: '   ' } });
      expect(screen.getByRole('button', { name: common.continue })).toBeDisabled();
    });

    it('the «add list» door also exists on a page WITH lists — and never for a member', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();
      expect(await screen.findByRole('button', { name: en.lists.addList })).toBeInTheDocument();
    });

    it('a member gets no «add list» door on a populated page', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection({ readOnly: true });
      await screen.findByText('أسعار الدورات');
      expect(screen.queryByRole('button', { name: en.lists.addList })).toBeNull();
    });
  });

  // The section's own explanation used to promise «أسعاره ومواعيده معاً في
  // بطاقة» to EVERY page — institute vocabulary asserted at an outlet
  // directory that has neither, and is not laid out as cards. Nothing in this
  // engine knows a vertical; the copy must not either (owner catch 2026-08-10).
  /**
   * REGRESSION GUARD FOR THE OTHER MERCHANTS.
   *
   * /business is GA for every workspace (2026-08-15), and the external
   * merchants who authored lists first have pages this branch never set out to
   * change. Their shapes are reproduced here from the prod row counts measured
   * 2026-08-11 — a keyed 213-row outlet directory that happens to contain a
   * few duplicate pharmacy names, and small un-keyed lists with none — so that
   * the name-grouping added for the owner's course list can never silently
   * restyle a directory it was not meant to touch.
   *
   * The counts are scaled down; the SHAPE (keyed vs not, duplicate names or
   * not, dated or not) is exactly theirs, and the shape is what the layout
   * decisions read.
   */
  describe('the other merchants on the allowlist are left alone', () => {
    /** Feras — «نقاط البيع»: keyed by المنطقة, 213 rows / 208 distinct names,
     *  i.e. a handful of pharmacies share a name across areas. */
    const ferasDirectory = (): FactCollectionWithRows => ({
      id: 'coll-outlets', label: 'نقاط البيع', keyAttr: 'المنطقة', isComplete: true, rowCount: 4,
      rows: [
        { id: 'f1', name: 'صيدلية الحياة', attributes: [{ label: 'المنطقة', value: 'جنزور' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        { id: 'f2', name: 'صيدلية الريان', attributes: [{ label: 'المنطقة', value: 'جنزور' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        // The duplicate name — same pharmacy brand in a different area.
        { id: 'f3', name: 'صيدلية الحياة', attributes: [{ label: 'المنطقة', value: 'تاجوراء' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        { id: 'f4', name: 'صيدلية الواحة', attributes: [{ label: 'المنطقة', value: 'تاجوراء' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
      ],
    });

    /** Feras — «أسعار حفاضات بامبو»: un-keyed, every name distinct, priced. */
    const ferasPrices = (): FactCollectionWithRows => ({
      id: 'coll-diapers', label: 'أسعار حفاضات بامبو', keyAttr: null, isComplete: true, rowCount: 3,
      rows: [
        { id: 'd1', name: 'حفاضات بامبو رقم 1', attributes: [{ label: 'النوع', value: 'عادي' }, { label: 'الوزن', value: '2-4 كيلو' }], price: '38.00', currency: 'د.ل', startsAt: null, endsAt: null, isAvailable: true },
        { id: 'd2', name: 'حفاضات بامبو جامبو رقم 3', attributes: [{ label: 'النوع', value: 'جامبو' }, { label: 'الوزن', value: '4-8 كيلو' }], price: '70.00', currency: 'د.ل', startsAt: null, endsAt: null, isAvailable: true },
        { id: 'd3', name: 'حفاضات بامبو للسباحة', attributes: [{ label: 'النوع', value: 'سباحة' }], price: '46.00', currency: 'د.ل', startsAt: null, endsAt: null, isAvailable: true },
      ],
    });

    it('Feras: a KEYED directory still groups by المنطقة — duplicate names never take over', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [ferasDirectory()] } } as any);
      renderSection();

      await screen.findByText('صيدلية الواحة');
      // The area headers are the axis, exactly as before this branch.
      expect(screen.getByText('جنزور')).toBeInTheDocument();
      expect(screen.getByText('تاجوراء')).toBeInTheDocument();
      // The duplicated pharmacy name appears under BOTH areas — never hoisted
      // into a single name group that would break the area axis.
      expect(screen.getAllByText('صيدلية الحياة')).toHaveLength(2);
    });

    it('Feras: an UN-KEYED price list with all-distinct names stays flat — no headers appear', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [ferasPrices()] } } as any);
      renderSection();

      await screen.findByText('حفاضات بامبو رقم 1');
      // Every row keeps its own name inline; nothing became a group heading.
      expect(screen.getByText('حفاضات بامبو جامبو رقم 3')).toBeInTheDocument();
      expect(screen.getByText('حفاضات بامبو للسباحة')).toBeInTheDocument();
      // No dates anywhere in his data → no date chips, no expiry copy.
      expect(screen.queryAllByTitle(en.lists.startsLabel)).toHaveLength(0);
      expect(screen.queryByText(new RegExp(en.lists.datesEnded.split('«')[0]))).toBeNull();
    });

    it('MES: small un-keyed lists render exactly as before — one row each, no grouping chrome', async () => {
      const showrooms: FactCollectionWithRows = {
        id: 'coll-showrooms', label: 'صالات الشركة', keyAttr: null, isComplete: null, rowCount: 2,
        rows: [
          { id: 's1', name: 'صالة أبو رمانة', attributes: [{ label: 'الهاتف', value: '0993301080' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
          { id: 's2', name: 'صالة المزة', attributes: [{ label: 'الهاتف', value: '0933222298' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        ],
      };
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [showrooms] } } as any);
      renderSection();

      await screen.findByText('صالة أبو رمانة');
      expect(screen.getByText('صالة المزة')).toBeInTheDocument();
      expect(screen.queryAllByTitle(en.lists.startsLabel)).toHaveLength(0);
    });
  });

  describe('the section hint is derived from the page, not assumed', () => {
    const outletsOnly: FactCollectionWithRows = {
      id: 'coll-outlets', label: 'الصيدليات', keyAttr: 'المنطقة', isComplete: true, rowCount: 2,
      rows: [
        { id: 'o1', name: 'صيدلية النرجس', attributes: [{ label: 'المنطقة', value: 'حي الرمال' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        { id: 'o2', name: 'صيدلية الياقوتة', attributes: [{ label: 'المنطقة', value: 'تلة الريح' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
      ],
    };

    it('a directory is told ONE thing: Jawab quotes these lists verbatim', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [outletsOnly] } } as any);
      renderSection();

      expect(await screen.findByText(en.lists.hintQuoted)).toBeInTheDocument();
    });

    it('says the SAME one thing on a page whose lists join and carry dates', async () => {
      // The layout clause described what the screen shows anyway, and the
      // expiry clause is now said where it acts — at the date field, and in
      // the freshness notice when a list runs out. Explaining the screen on
      // arrival is the copy this page had too much of (owner, 2026-08-11).
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      const hint = await screen.findByText(en.lists.hintQuoted);
      expect(hint).toHaveTextContent(en.lists.hintQuoted);
      expect(hint.textContent?.trim()).toBe(en.lists.hintQuoted);
    });
  });

  // A list's label is the header the prompt renderer puts above its rows, so a
  // typo is quoted to customers. Until this flow existed the only cure was a
  // database write — and `errLastRow` told merchants to delete a list they had
  // no way to delete.
  describe('«تعديل الاسم» rename flow', () => {
    const renameDoor = (label: string) => en.lists.renameActionFor.replace('{list}', label);

    it('renames from the entity-card layout — prefilled, trimmed, one PATCH', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      vi.mocked(factCollectionsApi.renameCollection).mockResolvedValue({ data: { data: { id: 'coll-prices', label: 'أسعار الدورات والشهادات' } } } as any);
      renderSection();

      await openListMenu('أسعار الدورات');
      fireEvent.click(screen.getByRole('button', { name: renameDoor('أسعار الدورات') }));
      const input = screen.getByLabelText(en.lists.newListNameLabel) as HTMLInputElement;
      // Prefilled with the CURRENT name — a rename is an edit, not a re-entry.
      expect(input.value).toBe('أسعار الدورات');

      fireEvent.change(input, { target: { value: '  أسعار الدورات والشهادات  ' } });
      fireEvent.click(screen.getByRole('button', { name: common.save }));

      await waitFor(() => expect(factCollectionsApi.renameCollection).toHaveBeenCalledWith(
        PAGE, 'coll-prices', 'أسعار الدورات والشهادات',
      ));
    });

    it('refuses a SIBLING list\'s name inline, but allows re-saving the list\'s own', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await openListMenu('أسعار الدورات');
      fireEvent.click(screen.getByRole('button', { name: renameDoor('أسعار الدورات') }));
      const input = screen.getByLabelText(en.lists.newListNameLabel);

      fireEvent.change(input, { target: { value: 'مواعيد الدورات المعلنة' } });
      expect(screen.getByRole('alert')).toHaveTextContent(en.lists.errDuplicateLabel);
      expect(screen.getByRole('button', { name: common.save })).toBeDisabled();

      // Its OWN label is not a clash — the server treats that as a no-op.
      fireEvent.change(input, { target: { value: 'أسعار الدورات' } });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('button', { name: common.save })).toBeEnabled();
      expect(factCollectionsApi.renameCollection).not.toHaveBeenCalled();
    });

    it('the door also exists on the directory layout, where the list card is the only per-list surface', async () => {
      const outlets: FactCollectionWithRows = {
        id: 'coll-outlets',
        label: 'الصيدليات',
        keyAttr: 'المنطقة',
        isComplete: true,
        rowCount: 1,
        rows: [
          { id: 'o1', name: 'صيدلية النرجس', attributes: [{ label: 'المنطقة', value: 'حي الرمال' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
        ],
      };
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [outlets] } } as any);
      vi.mocked(factCollectionsApi.renameCollection).mockResolvedValue({ data: { data: { id: 'coll-outlets', label: 'نقاط البيع' } } } as any);
      renderSection();

      await openListMenu('الصيدليات');
      fireEvent.click(screen.getByRole('button', { name: renameDoor('الصيدليات') }));
      fireEvent.change(screen.getByLabelText(en.lists.newListNameLabel), { target: { value: 'نقاط البيع' } });
      fireEvent.click(screen.getByRole('button', { name: common.save }));

      await waitFor(() => expect(factCollectionsApi.renameCollection).toHaveBeenCalledWith(PAGE, 'coll-outlets', 'نقاط البيع'));
    });

    // Found in the UX audit: focus reset to <body> on close, so a keyboard user
    // with three lists on the page restarted from the top each time. The door
    // is a menu ITEM now, which unmounts with the menu — so the return target
    // is the list's ⋯ TRIGGER, which survives the whole journey (the menu
    // hands it focus before the sheet mounts, or the sheet would capture the
    // about-to-unmount item and restore nothing).
    it('returns focus to the list\'s ⋯ trigger after the sheet closes', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      const trigger = await screen.findByRole('button', {
        name: en.lists.listOptionsFor.replace('{list}', 'أسعار الدورات'),
      });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('button', { name: renameDoor('أسعار الدورات') }));
      fireEvent.click(screen.getByRole('button', { name: common.cancel }));

      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    // The cap used to be silent — typing just stopped at 120 characters.
    it('warns as the name approaches the 120-character column cap', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await openListMenu('أسعار الدورات');
      fireEvent.click(screen.getByRole('button', { name: renameDoor('أسعار الدورات') }));
      const input = screen.getByLabelText(en.lists.newListNameLabel);

      fireEvent.change(input, { target: { value: 'ق'.repeat(99) } });
      expect(screen.queryByText(/character(s)? left/)).toBeNull();

      fireEvent.change(input, { target: { value: 'ق'.repeat(MAX_LIST_LABEL_LENGTH - 3) } });
      expect(screen.getByText('3 characters left')).toBeInTheDocument();

      // At the cap the count reaches zero — which is the moment the merchant's
      // typing goes dead, so this is the state that most needs to be visible.
      // (ICU `=0` is NOT honoured by this next-intl setup — verified in a real
      // render, it falls to `other` — so the copy must read well at zero.)
      fireEvent.change(input, { target: { value: 'ق'.repeat(MAX_LIST_LABEL_LENGTH) } });
      expect((input as HTMLInputElement).value).toHaveLength(MAX_LIST_LABEL_LENGTH);
      expect(screen.getByText('0 characters left')).toBeInTheDocument();
    });

    // Android's hardware back must close the sheet, not leave /business (or
    // exit the app) with a half-typed name.
    it('closes on the Android back button instead of letting it reach the router', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection();

      await openListMenu('أسعار الدورات');
      fireEvent.click(screen.getByRole('button', { name: renameDoor('أسعار الدورات') }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // What _app.tsx calls on a hardware back press.
      expect(dismissTopModal()).toBe(true);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('a member gets no rename door — the label is an admin write', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: bothCollections() } } as any);
      renderSection({ readOnly: true });
      await screen.findByText('أسعار الدورات');
      expect(screen.queryByRole('button', { name: renameDoor('أسعار الدورات') })).toBeNull();
    });
  });

  describe('the freshness notice only says what the data supports', () => {
    /** THE PRODUCTION SHAPE, page 39aeab89 on 2026-08-19: the price list held
     *  50 rows of which exactly ONE carried a date, and it had passed — while
     *  the schedule beside it still had seven live dates for those same
     *  courses. The page announced «the announced dates in أسعار الدورات have
     *  ended», which was false by every reading a merchant has. */
    const strayDatedPrices = () => priceCollection({
      rowCount: 3,
      rows: [
        ...priceCollection().rows,
        {
          id: 'price-makeup-advanced', name: 'دورة المكياج او التجميل (الميك أب)',
          price: '50000.00', currency: 'ل.س قديمة', attributes: null,
          startsAt: past, endsAt: null, isAvailable: true,
        },
      ],
    });

    it('never claims a PRICE list ran out of dates because one stray row retired', async () => {
      vi.mocked(factCollectionsApi.list).mockResolvedValue({
        data: { data: [strayDatedPrices(), slotCollection()] },
      } as any);
      renderSection();
      await screen.findByText('أسعار الدورات');

      // Read the notice itself: the row's name also appears on its card, so a
      // page-wide text query would pass on the card alone and prove nothing.
      const notice = await screen.findByRole('status');
      // The whole sentence, so the false one cannot merely be absent while the
      // true one is subtly wrong: the singular ICU branch, filled from the real
      // copy, is the only thing this notice may say.
      expect(notice.textContent?.trim()).toBe(
        en.lists.datesRowsRetired
          .replace(/^.*?one \{/, '')
          .replace(/\} other \{.*$/, '')
          .replace('{names}', 'دورة المكياج او التجميل (الميك أب)')
          .replace('{list}', 'أسعار الدورات'),
      );
    });

    it('bounds a long tail of retired strays without under-reporting the count', async () => {
      // 10 undated + 7 retired dated rows: still a MINORITY, so still a
      // row-level notice — but the sentence must not become a wall of names.
      const many = priceCollection({
        rowCount: 17,
        rows: [
          ...Array.from({ length: 10 }, (_, i) => ({
            id: `p${i}`, name: `دورة ${i}`, price: '35000.00', currency: 'ل.س قديمة',
            attributes: null, startsAt: null, endsAt: null, isAvailable: true,
          })),
          ...Array.from({ length: 7 }, (_, i) => ({
            id: `promo${i}`, name: `عرض ${i}`, price: '20000.00', currency: 'ل.س قديمة',
            attributes: null, startsAt: past, endsAt: null, isAvailable: true,
          })),
        ],
      });
      vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [many] } } as any);
      renderSection();

      const notice = await screen.findByRole('status');
      // Assert the WHOLE rendered sentence, built from the real copy. An
      // earlier version checked `toHaveTextContent('7')`, which the fixture's
      // own «17 rows» satisfies — so the count could have been wired to
      // `collection.rows.length` and the test would not have noticed.
      const names = ['عرض 0', 'عرض 1', 'عرض 2', 'عرض 3', 'عرض 4', en.lists.namesMore]
        .join(en.lists.namesSeparator);
      // textContent compared WHOLE, not toHaveTextContent — that matcher is a
      // substring test, so an expected «7 rows …» passes against a rendered
      // «17 rows …» and the fixture has 17 rows. The count could be wired to
      // `collection.rows.length` and a substring assertion would not notice.
      expect(notice.textContent?.trim()).toBe(
        `7 rows in «أسعار الدورات» are past their dates: ${names} — Jawab no longer mentions them. Update their dates or delete them.`,
      );
    });

    it('still warns when a real SCHEDULE has run out — the majority rule is all that changed', async () => {
      const deadSlots = slotCollection({
        rows: slotCollection().rows.map((r) => ({ ...r, startsAt: past, endsAt: past })),
      });
      vi.mocked(factCollectionsApi.list).mockResolvedValue({
        data: { data: [priceCollection(), deadSlots] },
      } as any);
      renderSection();

      const notice = await screen.findByRole('status');
      expect(notice.textContent?.trim()).toBe(
        en.lists.datesEnded.replace('{list}', 'مواعيد الدورات المعلنة'),
      );
    });
  });
});
