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
});
