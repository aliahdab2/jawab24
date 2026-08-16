import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FactEntitySheet } from './FactEntitySheet';
import type { FactEntityUnit } from '@/utils/factListLayout';
import type { FactCollectionWithRows, FactRowDto, FactEntitySaveBody } from '@/lib/api';

vi.mock('@/i18n/hooks', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), dateLocale: undefined, intlLocale: 'en-US' }),
}));

vi.mock('@/components/ui', () => ({
  SidePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
  InfoPopover: () => null,
}));

/**
 * The entity save replaces rows WHOLESALE server-side — whatever the form
 * omits is gone. These tests pin the reconstruction contract that shipped
 * broken once (2026-08-08): a NO-OP save wiped the base row's key attribute
 * («الدورة» / «المنطقة»), renamed sibling-tier session rows to the tapped
 * tier's name, and reset `isAvailable` — corrupting the entity it claimed to
 * leave untouched.
 */

function row(partial: Partial<FactRowDto> & { id: string; name: string }): FactRowDto {
  return {
    attributes: null,
    structured: null,
    price: null,
    currency: null,
    startsAt: null,
    endsAt: null,
    isAvailable: true,
    ...partial,
  };
}

function collection(
  partial: Partial<FactCollectionWithRows> & { id: string; label: string; rows: FactRowDto[] },
): FactCollectionWithRows {
  return { keyAttr: null, isComplete: null, rowCount: partial.rows.length, ...partial };
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });

describe('FactEntitySheet — save preserves what the form does not display', () => {
  /** The reproduced course case: keyed online-courses base row (unavailable),
   *  plus keyed schedule sessions that carry a DIFFERENT name (they belong to
   *  the sibling in-person tier as well). */
  function courseFixture() {
    const onlineRow = row({
      id: 'row-online',
      name: 'دورة الإكسل المتقدم أونلاين',
      attributes: [{ label: 'الدورة', value: 'الإكسل' }],
      price: '10.00',
      currency: 'دولار',
      isAvailable: false,
    });
    const online = collection({
      id: 'col-online', label: 'الدورات الأونلاين المتوفرة', keyAttr: 'الدورة', rows: [onlineRow],
    });
    const sessionRows = ['2-3', '6-7'].map((hours, i) => row({
      id: `row-sess-${i}`,
      name: 'دورة الإكسل المتقدم',
      attributes: [
        { label: 'الدورة', value: 'الإكسل' },
        { label: 'الأيام', value: 'الأحد والثلاثاء' },
        { label: 'الساعة', value: hours },
      ],
    }));
    const schedules = collection({
      id: 'col-sched', label: 'مواعيد الدورات المعلنة', keyAttr: 'الدورة', rows: sessionRows,
    });
    const unit: FactEntityUnit = {
      title: 'دورة الإكسل المتقدم',
      faceLabel: null,
      faceValue: null,
      base: { row: onlineRow, collection: online },
      sessions: sessionRows.map((r) => ({ row: r, collection: schedules })),
      sessionCollection: schedules,
    };
    return { unit, online, sessionRows };
  }

  it('a no-op save round-trips the entity byte-for-byte (key attr, names, availability)', () => {
    const { unit, online } = courseFixture();
    const onSave = vi.fn();
    render(
      <FactEntitySheet unit={unit} baseCollection={online} saving={false} onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    const body = onSave.mock.calls[0][0] as FactEntitySaveBody;
    const base = body.upserts.find((u) => u.collectionId === 'col-online');
    expect(base).toBeDefined();
    // The collection's key attribute is not a form field — it must survive.
    expect(base?.attributes).toEqual([{ label: 'الدورة', value: 'الإكسل' }]);
    expect(base?.name).toBe('دورة الإكسل المتقدم أونلاين');
    // Server default is true; an omitted flag silently re-lists the row.
    expect(base?.isAvailable).toBe(false);

    const sessions = body.upserts.filter((u) => u.collectionId === 'col-sched');
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      // Sessions shared with the sibling tier keep THEIR name — not the
      // tapped tier's.
      expect(s.name).toBe('دورة الإكسل المتقدم');
      expect(s.isAvailable).toBe(true);
      expect(s.attributes).toEqual(expect.arrayContaining([{ label: 'الدورة', value: 'الإكسل' }]));
    }
  });

  it('editing an unrelated field keeps the key attribute (the outlet-directory wipe)', () => {
    const outletRow = row({
      id: 'row-outlet',
      name: 'صيدلية يحيى',
      attributes: [{ label: 'المنطقة', value: 'أبو سليم' }],
    });
    const outlets = collection({
      id: 'col-outlets', label: 'نقاط بيع البلازمون', keyAttr: 'المنطقة', rows: [outletRow],
    });
    const unit: FactEntityUnit = {
      title: 'صيدلية يحيى',
      faceLabel: null,
      faceValue: null,
      base: { row: outletRow, collection: outlets },
      sessions: [],
      sessionCollection: null,
    };
    const onSave = vi.fn();
    render(
      <FactEntitySheet unit={unit} baseCollection={outlets} saving={false} onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByDisplayValue('صيدلية يحيى'), { target: { value: 'صيدلية يحيى الجديدة' } });
    fireEvent.click(saveButton());

    const body = onSave.mock.calls[0][0] as FactEntitySaveBody;
    expect(body.upserts).toHaveLength(1);
    expect(body.upserts[0].name).toBe('صيدلية يحيى الجديدة');
    // Renaming must not detach the row from its district group.
    expect(body.upserts[0].attributes).toEqual([{ label: 'المنطقة', value: 'أبو سليم' }]);
  });

  it('round-trips base structured and session price/currency on a no-op save', () => {
    const baseRow = row({
      id: 'row-base',
      name: 'دورة X',
      price: '50000.00',
      currency: 'ل.س',
      structured: { 'الساعة': { kind: 'timeRange', start: '14:00', end: '15:00' } },
    });
    const prices = collection({ id: 'col-prices', label: 'أسعار الدورات', rows: [baseRow] });
    const pricedSession = row({
      id: 'row-sess',
      name: 'دورة X',
      attributes: [{ label: 'الدورة', value: 'X' }],
      price: '5000.00',
      currency: 'ل.س',
      startsAt: '2026-09-01',
    });
    const schedules = collection({
      id: 'col-sched', label: 'مواعيد الدورات المعلنة', keyAttr: 'الدورة', rows: [pricedSession],
    });
    const unit: FactEntityUnit = {
      title: 'دورة X',
      faceLabel: null,
      faceValue: null,
      base: { row: baseRow, collection: prices },
      sessions: [{ row: pricedSession, collection: schedules }],
      sessionCollection: schedules,
    };
    const onSave = vi.fn();
    render(
      <FactEntitySheet unit={unit} baseCollection={prices} saving={false} onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.click(saveButton());

    const body = onSave.mock.calls[0][0] as FactEntitySaveBody;
    const base = body.upserts.find((u) => u.rowId === 'row-base');
    expect(base?.structured).toEqual({ 'الساعة': { kind: 'timeRange', start: '14:00', end: '15:00' } });
    const session = body.upserts.find((u) => u.rowId === 'row-sess');
    expect(session?.price).toBe('5000.00');
    expect(session?.currency).toBe('ل.س');
  });

  it('a NEW base row in a keyed collection is seeded with the sessions’ key value', () => {
    const otherCourseRow = row({
      id: 'row-other',
      name: 'دورة أخرى',
      attributes: [{ label: 'الدورة', value: 'أخرى' }],
      price: '20.00',
    });
    const online = collection({
      id: 'col-online', label: 'الدورات الأونلاين المتوفرة', keyAttr: 'الدورة', rows: [otherCourseRow],
    });
    const session = row({
      id: 'row-sess',
      name: 'دورة الإكسل المتقدم',
      attributes: [{ label: 'الدورة', value: 'الإكسل' }],
    });
    const schedules = collection({
      id: 'col-sched', label: 'مواعيد الدورات المعلنة', keyAttr: 'الدورة', rows: [session],
    });
    const unit: FactEntityUnit = {
      title: 'دورة الإكسل المتقدم',
      faceLabel: null,
      faceValue: null,
      base: null,
      sessions: [{ row: session, collection: schedules }],
      sessionCollection: schedules,
    };
    const onSave = vi.fn();
    const { container } = render(
      <FactEntitySheet unit={unit} baseCollection={online} saving={false} onSave={onSave} onClose={vi.fn()} />,
    );
    // Give the new base content (a price) so it is created at all.
    fireEvent.click(screen.getByRole('button', { name: /^Price/ }));
    fireEvent.change(container.querySelector('#entity-price') as HTMLInputElement, { target: { value: '10' } });
    fireEvent.click(saveButton());

    const body = onSave.mock.calls[0][0] as FactEntitySaveBody;
    const base = body.upserts.find((u) => u.collectionId === 'col-online');
    expect(base).toBeDefined();
    expect(base?.rowId).toBeUndefined();
    // The key that joins the new tier to its entity — without it the row is
    // orphaned into «بدون الدورة» the moment it is born.
    expect(base?.attributes).toEqual(expect.arrayContaining([{ label: 'الدورة', value: 'الإكسل' }]));
  });

  it('a rename follows a session whose name differs only by normalization', () => {
    const baseRow = row({ id: 'row-base', name: 'دورة الحلاقة', price: '50000.00' });
    const prices = collection({ id: 'col-prices', label: 'أسعار الدورات', rows: [baseRow] });
    // Taa-marbuta variant of the same entity name — grouped into the same
    // card by normalizeForGrouping, so it must follow the rename too.
    const variantSession = row({
      id: 'row-variant',
      name: 'دوره الحلاقه',
      attributes: [{ label: 'الدورة', value: 'حلاقة' }],
    });
    const schedules = collection({
      id: 'col-sched', label: 'مواعيد الدورات المعلنة', keyAttr: 'الدورة', rows: [variantSession],
    });
    const unit: FactEntityUnit = {
      title: 'دورة الحلاقة',
      faceLabel: null,
      faceValue: null,
      base: { row: baseRow, collection: prices },
      sessions: [{ row: variantSession, collection: schedules }],
      sessionCollection: schedules,
    };
    const onSave = vi.fn();
    render(
      <FactEntitySheet unit={unit} baseCollection={prices} saving={false} onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByDisplayValue('دورة الحلاقة'), { target: { value: 'دورة الحلاقة النسائية' } });
    fireEvent.click(saveButton());

    const body = onSave.mock.calls[0][0] as FactEntitySaveBody;
    expect(body.upserts.find((u) => u.rowId === 'row-variant')?.name).toBe('دورة الحلاقة النسائية');
  });

  it('a rename follows only sessions that carried the original name', () => {
    const baseRow = row({ id: 'row-base', name: 'دورة X', price: '50000.00', currency: 'ل.س' });
    const prices = collection({ id: 'col-prices', label: 'أسعار الدورات', rows: [baseRow] });
    const ownSession = row({
      id: 'row-own',
      name: 'دورة X',
      attributes: [{ label: 'الدورة', value: 'X' }],
    });
    const siblingSession = row({
      id: 'row-sibling',
      name: 'دورة X أونلاين',
      attributes: [{ label: 'الدورة', value: 'X' }],
    });
    const schedules = collection({
      id: 'col-sched', label: 'مواعيد الدورات المعلنة', keyAttr: 'الدورة', rows: [ownSession, siblingSession],
    });
    const unit: FactEntityUnit = {
      title: 'دورة X',
      faceLabel: null,
      faceValue: null,
      base: { row: baseRow, collection: prices },
      sessions: [
        { row: ownSession, collection: schedules },
        { row: siblingSession, collection: schedules },
      ],
      sessionCollection: schedules,
    };
    const onSave = vi.fn();
    render(
      <FactEntitySheet unit={unit} baseCollection={prices} saving={false} onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByDisplayValue('دورة X'), { target: { value: 'دورة Y' } });
    fireEvent.click(saveButton());

    const body = onSave.mock.calls[0][0] as FactEntitySaveBody;
    const byId = (id: string) => body.upserts.find((u) => u.rowId === id);
    expect(byId('row-base')?.name).toBe('دورة Y');
    expect(byId('row-own')?.name).toBe('دورة Y');
    expect(byId('row-sibling')?.name).toBe('دورة X أونلاين');
  });

  /**
   * The dated half of an item is headed by the MERCHANT'S list name, never a
   * noun we picked. A fixed «المواعيد» reads as an appointment book — right
   * for a course cohort, wrong for the seasonal-offers list below, and this
   * page must fit any business (owner ruling 2026-08-10).
   */
  it('heads the dated section with the merchant\'s own list name, whatever that list is', () => {
    const baseRow = row({ id: 'row-base', name: 'عطر الياسمين', price: '120.00', currency: 'ر.س' });
    const prices = collection({ id: 'col-prices', label: 'أسعار العطور', rows: [baseRow] });
    const offerRow = row({ id: 'row-offer', name: 'عطر الياسمين', startsAt: '2026-12-01' });
    const offers = collection({ id: 'col-offers', label: 'عروض موسمية', rows: [offerRow] });
    const unit: FactEntityUnit = {
      title: 'عطر الياسمين',
      faceLabel: null,
      faceValue: null,
      base: { row: baseRow, collection: prices },
      sessions: [{ row: offerRow, collection: offers }],
      sessionCollection: offers,
    };

    render(
      <FactEntitySheet unit={unit} baseCollection={prices} saving={false} onSave={vi.fn()} onClose={vi.fn()} />,
    );

    // The perfume shop sees ITS list name…
    expect(screen.getAllByRole('region', { name: 'عروض موسمية' }).length).toBeGreaterThan(0);
    // …and never our word for someone else's business.
    expect(screen.queryByRole('region', { name: 'Dates' })).toBeNull();
  });

  /** The Damascene note regression (2026-08-16): a 152-char «ملاحظة» died on
   *  the server's old 100-char cap behind a misleading toast. The cap is now
   *  600, and crossing it must say so AND hold the save — never a silent 400. */
  it('an over-limit note blocks Save with a visible alert; the 152-char note saves', () => {
    const NOTE_152 =
      'محاور الدورة: مفهوم الجودة وإدارة الجودة، رواد الجودة، مفاهيم أساسية ضبط وتأكيد الجودة وإدارة الجودة الشاملة، ادوات الجودة، مقاييس الجودة، تكاليف الجودة';
    const courseRow = row({
      id: 'row-course',
      name: 'دورة إدارة الجودة',
      attributes: [{ label: 'ملاحظة', value: 'توقيت مسائي' }],
    });
    const prices = collection({ id: 'col-prices', label: 'أسعار الدورات', rows: [courseRow] });
    const unit: FactEntityUnit = {
      title: 'دورة إدارة الجودة',
      faceLabel: null,
      faceValue: null,
      base: { row: courseRow, collection: prices },
      sessions: [],
      sessionCollection: null,
    };
    const onSave = vi.fn();
    render(
      <FactEntitySheet unit={unit} baseCollection={prices} saving={false} onSave={onSave} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /ملاحظة/ }));
    const note = screen.getByLabelText('ملاحظة');

    fireEvent.change(note, { target: { value: 'م'.repeat(601) } });
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(note, { target: { value: NOTE_152 } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    const body = onSave.mock.calls[0][0] as FactEntitySaveBody;
    expect(body.upserts[0].attributes).toEqual([{ label: 'ملاحظة', value: NOTE_152 }]);
  });
});
