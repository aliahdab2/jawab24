import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  // TimeSelect renders through the shared Select; a native <select> keeps the
  // option list and the change events testable.
  Select: ({ value, onChange, options, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    'aria-label'?: string;
    'aria-labelledby'?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
  ConfirmationModal: ({ isOpen, onConfirm, onClose, confirmText, cancelText }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    confirmText?: string;
    cancelText?: string;
  }) => (isOpen ? (
    <div data-testid="discard-confirm">
      <button onClick={onConfirm}>{confirmText}</button>
      <button onClick={onClose}>{cancelText}</button>
    </div>
  ) : null),
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

function renderSheet(
  initialHours: Record<string, string[]> | undefined,
  onSave = vi.fn(),
  onClose = vi.fn(),
) {
  render(
    <BusinessHoursSheet
      initialHours={initialHours}
      saving={false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return onSave;
}

const save = () => fireEvent.click(screen.getByText('Save'));
const saveButton = () => screen.getByText('Save').closest('button') as HTMLButtonElement;

describe('BusinessHoursSheet', () => {
  it('renders a control per day, not one schedule for the week', () => {
    renderSheet(PER_DAY);
    expect(screen.getAllByRole('switch')).toHaveLength(7);
  });

  // The regression: the previous editor read only the first range it found and
  // wrote it to every open day, so opening the sheet and saving destroyed a
  // genuinely different Friday. Editing one day must leave the rest untouched.
  it('a time edit touches only its own day', () => {
    const onSave = renderSheet(PER_DAY);
    fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
    const [from] = screen.getAllByRole('combobox');
    fireEvent.change(from, { target: { value: '10:00' } });
    save();
    const saved = onSave.mock.calls[0][0];
    expect(saved.sat).toEqual(['10:00-17:00']);
    expect(saved.fri).toEqual(['14:00-20:00']);
    expect(saved.sun).toEqual(['09:00-17:00']);
  });

  it('keeps a split shift intact through an unrelated edit', () => {
    const split = { ...PER_DAY, sat: ['09:00-14:00', '17:00-22:00'] };
    const onSave = renderSheet(split);
    fireEvent.click(screen.getByRole('switch', { name: /^Fri/ }));
    save();
    expect(onSave.mock.calls[0][0].sat).toEqual(['09:00-14:00', '17:00-22:00']);
  });

  it('lets a merchant add a second period to one day only', () => {
    const onSave = renderSheet(PER_DAY);
    fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
    fireEvent.click(screen.getByText('Add another period'));
    save();
    expect(onSave.mock.calls[0][0].sat).toHaveLength(2);
    expect(onSave.mock.calls[0][0].sun).toEqual(['09:00-17:00']);
  });

  // Mobile-first: with hours already saved the week is an overview — the whole
  // week readable without scrolling, editing costs one tap on the day you change.
  it('starts collapsed when hours already exist, and expands on tap', () => {
    renderSheet(PER_DAY);
    expect(screen.queryByText('Add another period')).not.toBeInTheDocument();
    // The collapsed row shows the schedule, so the week is readable as a list.
    expect(screen.getByRole('button', { name: /^Sat/ })).toHaveTextContent('09:00-17:00');
    fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
    expect(screen.getByText('Add another period')).toBeInTheDocument();
  });

  it('opens the first day for a merchant who has never set hours', () => {
    renderSheet(undefined);
    expect(screen.getByText('Add another period')).toBeInTheDocument();
  });

  it('reveals the times immediately when a closed day is switched on', () => {
    renderSheet({ ...PER_DAY, fri: ['closed'] });
    expect(screen.queryByText('Add another period')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /^Fri/ }));
    expect(screen.getByText('Add another period')).toBeInTheDocument();
  });

  // The link text promises the timezone control; landing at the top of
  // Settings breaks that promise. The anchor must stay in settings.tsx's
  // KNOWN_ANCHORS and on BusinessHoursCard's timezone label.
  it('deep-links the timezone hint to the settings timezone control', () => {
    renderSheet(PER_DAY);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings#business-hours-timezone-label');
  });

  it('does not make a closed day look tappable', () => {
    renderSheet({ ...PER_DAY, fri: ['closed'] });
    expect(screen.getByRole('button', { name: /^Fri/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Sat/ })).toBeEnabled();
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
    fireEvent.click(screen.getByRole('switch', { name: /^Fri/ }));
    save();
    expect(onSave.mock.calls[0][0].sun).toEqual(['all day']);
  });

  // Overlapping periods would reach the AI as "09:00-17:00 / 11:00-18:00" and
  // it would quote a customer something incoherent.
  it('blocks saving overlapping periods and names the offending day', () => {
    renderSheet({ ...PER_DAY, sun: ['09:00-17:00', '11:00-18:00'] });
    expect(saveButton()).toBeDisabled();
    // Visible on the collapsed row too, so a hidden day is never a dead end.
    expect(screen.getByRole('button', { name: /^Sun/ }))
      .toHaveTextContent('These periods overlap');
  });

  it('a newly added period does not overlap the existing one', () => {
    const onSave = renderSheet({ ...PER_DAY, sat: ['09:00-14:00'] });
    fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
    fireEvent.click(screen.getByText('Add another period'));
    expect(saveButton()).toBeEnabled();
    save();
    expect(onSave.mock.calls[0][0].sat).toEqual(['09:00-14:00', '15:00-18:00']);
  });

  it('blocks saving when every day is closed', () => {
    renderSheet(PER_DAY);
    screen.getAllByRole('switch').forEach((s) => fireEvent.click(s));
    expect(saveButton()).toBeDisabled();
  });
});

describe('BusinessHoursSheet — Save is gated on a change', () => {
  // The sheet used to open with a live Save on any page with valid existing
  // hours — the only editor in the section not gated on a change.
  it('opens with Save disabled while stored hours are unchanged', () => {
    renderSheet(PER_DAY);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: /^Sun/ }));
    expect(saveButton()).toBeEnabled();
  });

  it('reverting an edit disarms Save again', () => {
    renderSheet(PER_DAY);
    const sun = screen.getByRole('switch', { name: /^Sun/ });
    fireEvent.click(sun);
    expect(saveButton()).toBeEnabled();
    // Sunday's stored hours equal the default range, so re-opening the day
    // restores exactly what was stored.
    fireEvent.click(screen.getByRole('switch', { name: /^Sun/ }));
    expect(saveButton()).toBeDisabled();
  });

  // First-fill Save waits for a TOUCH (owner ruling 2026-08-05, reversing the
  // earlier one-tap convenience): a live Save over the seeded default week let
  // one blind tap earn a green «مكتمل» for hours nobody reviewed. Any edit —
  // even one that returns to the seed — counts: touching IS the review.
  it('first-time setup opens with Save disarmed until the merchant touches the week', () => {
    renderSheet(undefined);
    expect(saveButton()).toBeDisabled();
    // Toggle Friday on… and off again: back to the seeded week, but reviewed.
    fireEvent.click(screen.getByRole('switch', { name: /^Fri/ }));
    fireEvent.click(screen.getByRole('switch', { name: /^Fri/ }));
    expect(saveButton()).toBeEnabled();
  });

  // …but the CLOSE guard must not treat the seeded default as "changes":
  // open → X with zero edits made must not warn about unsaved changes.
  it('first-time open still closes silently', () => {
    const onClose = vi.fn();
    renderSheet(undefined, vi.fn(), onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('discard-confirm')).not.toBeInTheDocument();
  });
});

describe('BusinessHoursSheet — time selects', () => {
  it('renders canonical HH:MM options — same spelling as the summaries', () => {
    renderSheet(PER_DAY);
    fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
    const [from, to] = screen.getAllByRole('combobox');
    expect(from).toHaveValue('09:00');
    expect(to).toHaveValue('17:00');
    within(from as HTMLElement).getAllByRole('option').forEach((o) => {
      expect(o.textContent).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  it('keeps an off-step stored time selectable instead of snapping it', () => {
    renderSheet({ ...PER_DAY, sat: ['09:15-17:00'] });
    fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
    const [from] = screen.getAllByRole('combobox');
    expect(from).toHaveValue('09:15');
    expect(within(from as HTMLElement).getByRole('option', { name: '09:15' })).toBeInTheDocument();
  });
});

describe('BusinessHoursSheet — unsaved-changes guard', () => {
  it('closes silently when nothing changed', () => {
    const onClose = vi.fn();
    renderSheet(PER_DAY, vi.fn(), onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('discard-confirm')).not.toBeInTheDocument();
  });

  it('asks before discarding an edited week', () => {
    const onClose = vi.fn();
    renderSheet(PER_DAY, vi.fn(), onClose);
    fireEvent.click(screen.getByRole('switch', { name: /^Sun/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Discard changes'));
    expect(onClose).toHaveBeenCalled();
  });
});
