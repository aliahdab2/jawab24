import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PLACEHOLDER_TIMEZONE } from '@jawab24/shared';

// Pretend this device is in Tripoli. Mocking the helper (rather than global Intl)
// keeps the test about the CARD's seeding rule — detectTimezone has its own tests
// in packages/shared.
vi.mock('@jawab24/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@jawab24/shared')>()),
  detectTimezone: () => 'Africa/Tripoli',
}));
import { BusinessHoursCard } from '@/components/settings/BusinessHoursCard';
import type { SettingsState } from '@/components/settings/types';

vi.mock('@/components/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Toggle: ({ enabled, onChange, 'aria-label': label }: { enabled: boolean; onChange: (v: boolean) => void; 'aria-label'?: string }) => (
    <button aria-label={label} onClick={() => onChange(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
  ),
  Select: ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
  InfoPopover: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  InputFieldWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CharCounter: () => null,
}));

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

function makeSettings(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    dashboardLanguage: 'en',
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    timezone: PLACEHOLDER_TIMEZONE,
    awayMessageMulti: {},
    ...overrides,
  } as unknown as SettingsState;
}

/**
 * The defect these pin: `settings.timezone` had no UI at all, so every merchant
 * silently inherited the DB placeholder — a Libyan shop evaluated its schedule on
 * Riyadh time and lost an hour a day. Seeding must happen when the schedule is
 * switched ON (the moment the value starts to matter) and must NEVER overwrite a
 * zone the merchant already chose.
 */
describe('BusinessHoursCard — timezone seeding', () => {
  function renderCard(settings: SettingsState, setSettings: (s: SettingsState) => void) {
    render(<BusinessHoursCard settings={settings} setSettings={setSettings} currentTime={new Date('2026-07-21T15:26:00Z')} />);
  }

  it('seeds the detected zone when the schedule is switched ON', () => {
    const setSettings = vi.fn();
    renderCard(makeSettings(), setSettings);

    fireEvent.click(screen.getByLabelText('businessHoursLabel'));

    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ businessHoursOnly: true, timezone: 'Africa/Tripoli' }),
    );
  });

  it('NEVER overwrites a zone the merchant already chose', () => {
    const setSettings = vi.fn();
    renderCard(makeSettings({ timezone: 'Asia/Damascus' }), setSettings);

    fireEvent.click(screen.getByLabelText('businessHoursLabel'));

    const patch = setSettings.mock.calls[0][0];
    expect(patch.businessHoursOnly).toBe(true);
    expect(patch.timezone).toBe('Asia/Damascus');
  });

  it('does not touch the timezone when switching the schedule OFF', () => {
    const setSettings = vi.fn();
    renderCard(makeSettings({ businessHoursOnly: true }), setSettings);

    fireEvent.click(screen.getByLabelText('businessHoursLabel'));

    const patch = setSettings.mock.calls[0][0];
    expect(patch.businessHoursOnly).toBe(false);
    expect(patch.timezone).toBe(PLACEHOLDER_TIMEZONE);
  });
});
