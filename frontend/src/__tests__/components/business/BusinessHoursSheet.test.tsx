import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BusinessHoursSheet } from '@/components/business/BusinessHoursSheet';

vi.mock('@/hooks/useMerchantTimezone', () => ({
  useMerchantTimezone: () => 'Asia/Damascus',
}));

vi.mock('@/components/ui', () => ({
  DetailSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Toggle: ({ enabled, onChange, 'aria-label': ariaLabel }: {
    enabled: boolean;
    onChange: (v: boolean) => void;
    'aria-label'?: string;
  }) => (
    <button role="switch" aria-checked={enabled} aria-label={ariaLabel} onClick={() => onChange(!enabled)}>
      toggle
    </button>
  ),
}));

/** Sat–Thu 09:00–17:00, Friday genuinely different. */
const PER_DAY: Record<string, string[]> = {
  sat: ['09:00-17:00'],
  sun: ['09:00-17:00'],
  mon: ['09:00-17:00'],
  tue: ['09:00-17:00'],
  wed: ['09:00-17:00'],
  thu: ['09:00-17:00'],
  fri: ['14:00-20:00'],
};

function renderSheet(initialHours: Record<string, string[]> | undefined, onSave = vi.fn()) {
  render(
    <BusinessHoursSheet
      initialHours={initialHours}
      saving={false}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  return onSave;
}

const save = () => fireEvent.click(screen.getByText('Save'));

describe('BusinessHoursSheet', () => {
  it('renders a control per day, not one schedule for the week', () => {
    renderSheet(PER_DAY);
    expect(screen.getAllByRole('switch')).toHaveLength(7);
  });

  // The regression: the previous editor read only the first range it found and
  // wrote it to every open day, so opening the sheet and saving destroyed a
  // genuinely different Friday.
  it('saves a per-day week back unchanged', () => {
    const onSave = renderSheet(PER_DAY);
    save();
    expect(onSave).toHaveBeenCalledWith(PER_DAY);
  });

  it('keeps a split shift intact through a save', () => {
    const split = { ...PER_DAY, sat: ['09:00-14:00', '17:00-22:00'] };
    const onSave = renderSheet(split);
    save();
    expect(onSave).toHaveBeenCalledWith(split);
  });

  it('lets a merchant add a second period to one day only', () => {
    const onSave = renderSheet(PER_DAY);
    // Every open day offers the affordance; use Saturday's (first in order).
    fireEvent.click(screen.getAllByText('Add another period')[0]);
    save();
    expect(onSave.mock.calls[0][0].sat).toHaveLength(2);
    expect(onSave.mock.calls[0][0].sun).toEqual(['09:00-17:00']);
  });

  it('closing a day writes "closed" for that day alone', () => {
    const onSave = renderSheet(PER_DAY);
    fireEvent.click(screen.getByRole('switch', { name: /^Sun/ }));
    save();
    expect(onSave.mock.calls[0][0].sun).toEqual(['closed']);
    expect(onSave.mock.calls[0][0].sat).toEqual(['09:00-17:00']);
  });

  it('«apply to all» copies the first open day across the week', () => {
    const onSave = renderSheet(PER_DAY);
    fireEvent.click(screen.getByText(/Apply Sat/));
    save();
    const saved = onSave.mock.calls[0][0];
    expect(saved.fri).toEqual(['09:00-17:00']);
    expect(saved.sun).toEqual(['09:00-17:00']);
  });

  it('preserves an "all day" entry instead of overwriting it with times', () => {
    const onSave = renderSheet({ ...PER_DAY, sun: ['all day'] });
    expect(screen.getByText('Open 24 hours')).toBeInTheDocument();
    save();
    expect(onSave.mock.calls[0][0].sun).toEqual(['all day']);
  });

  it('blocks saving when every day is closed', () => {
    renderSheet(PER_DAY);
    screen.getAllByRole('switch').forEach((s) => fireEvent.click(s));
    expect(screen.getByText('Save').closest('button')).toBeDisabled();
  });
});
