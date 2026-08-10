import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListRowSheet } from './ListRowSheet';
import type { FactRowDto } from '@/lib/api';

vi.mock('@/components/ui', () => ({
  DetailSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  InfoPopover: () => null,
}));

const TODAY = '2026-08-10';

const onSave = vi.fn();

function renderSheet(row: FactRowDto | null = null) {
  return render(
    <ListRowSheet
      row={row}
      collectionLabel="الشهادات"
      keyAttr={null}
      attributeLabels={[]}
      canDelete={false}
      today={TODAY}
      intlLocale="en-US"
      saving={false}
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

const nameField = () => screen.getByLabelText('Name');
const priceField = () => screen.getByLabelText('Price');
const startDateField = () => screen.getByLabelText('Start date');
const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => onSave.mockClear());

/**
 * The owner hit both of these live on 2026-08-10.
 *
 * The price: «50 ألف» was posted, the server answered 400, and the only thing
 * shown was «تعذّر الحفظ — حاول مجدداً» — an instruction to repeat a request
 * that can never succeed. Nothing named the field or the reason.
 *
 * The date: the start date OWNS visibility (D-057), so a row dated in the past
 * is invisible to customers — a consequence that lived only behind an info
 * icon, i.e. nowhere at the moment of choosing.
 */
describe('ListRowSheet — a price the server cannot read is refused here', () => {
  it('refuses a spelled-out magnitude at the field instead of posting it', () => {
    renderSheet();
    fireEvent.change(nameField(), { target: { value: 'شهادة حضور' } });
    fireEvent.change(priceField(), { target: { value: '50 ألف' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Write the price in digits only — for example 50000.',
    );
    expect(priceField()).toHaveAttribute('aria-invalid', 'true');
    expect(saveButton()).toBeDisabled();

    // The guard is on the handler too, not only the disabled attribute — a
    // stray click (or a test-id driven tap) must not reach the API either.
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts every digit system and separator the server accepts', () => {
    for (const value of ['50000', '٥٠٠٠٠', '50,000', '35٫50']) {
      const { unmount } = renderSheet();
      fireEvent.change(nameField(), { target: { value: 'شهادة حضور' } });
      fireEvent.change(priceField(), { target: { value } });

      expect(screen.queryByRole('alert'), `rejected "${value}"`).toBeNull();
      expect(saveButton(), `save blocked for "${value}"`).toBeEnabled();
      unmount();
    }
  });

  it('treats an empty price as an ordinary row, not an error', () => {
    renderSheet();
    fireEvent.change(nameField(), { target: { value: 'صيدلية النرجس' } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(saveButton()).toBeEnabled();
  });
});

describe('ListRowSheet — the start date says what it will do', () => {
  it('says nothing about dates on an undated row', () => {
    renderSheet();
    fireEvent.change(nameField(), { target: { value: 'شهادة حضور' } });

    expect(screen.queryByText(/Jawab mentions this row until/)).toBeNull();
    expect(screen.queryByText(/its start date has passed/)).toBeNull();
  });

  it('states when Jawab will stop mentioning a future-dated row', () => {
    renderSheet();
    fireEvent.change(startDateField(), { target: { value: '2026-09-01' } });

    expect(screen.getByText(/Jawab mentions this row until September 1, then stops\./)).toBeTruthy();
  });

  it('explains the invisibility of a row whose start date has passed', () => {
    // Reachable only when EDITING a row already dated in the past — which is
    // exactly the row a merchant reports as "I added it and it never showed".
    renderSheet({
      id: 'row-1',
      name: 'دورة المكياج',
      attributes: null,
      structured: null,
      price: null,
      currency: null,
      startsAt: '2026-07-01',
      endsAt: null,
      isAvailable: true,
    });

    expect(screen.getByRole('status')).toHaveTextContent('its start date has passed');
  });

  it('will not let a NEW row be dated into invisibility', () => {
    renderSheet();
    expect(startDateField()).toHaveAttribute('min', TODAY);
  });

  it('keeps an existing past date reachable so editing the name does not force a date change', () => {
    renderSheet({
      id: 'row-1',
      name: 'دورة المكياج',
      attributes: null,
      structured: null,
      price: null,
      currency: null,
      startsAt: '2026-07-01',
      endsAt: null,
      isAvailable: true,
    });

    expect(startDateField()).toHaveAttribute('min', '2026-07-01');
  });
});
