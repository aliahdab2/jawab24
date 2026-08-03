import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PLACEHOLDER_TIMEZONE, resolveStoredTimezone } from '@jawab24/shared';

// Pretend this device is in Tripoli. Mocking the helper (rather than global Intl)
// keeps the test about the seeding RULE — detectTimezone has its own tests
// in packages/shared.
vi.mock('@jawab24/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@jawab24/shared')>()),
  detectTimezone: () => 'Africa/Tripoli',
}));
import { BusinessHoursCard } from '@/components/settings/BusinessHoursCard';
import type { SettingsState } from '@/components/settings/types';
import { makeSettings as makeSharedSettings } from '../../testUtils/settingsFactory';

vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'en' }));

const makeSettings = (overrides: Partial<SettingsState> = {}): SettingsState =>
  makeSharedSettings({ businessHoursEnd: '18:00', timezone: PLACEHOLDER_TIMEZONE, ...overrides });

/**
 * The defect these pin: `settings.timezone` had no UI at all, so every merchant
 * silently inherited the DB placeholder — a Libyan shop evaluated its schedule
 * on Riyadh time and lost an hour a day.
 *
 * The seeding used to happen when this card's schedule was switched ON. It now
 * happens for EVERY merchant when settings load (`resolveStoredTimezone`), so
 * a merchant who never touches the schedule is covered too — and the card,
 * which no longer owns the timezone at all, must keep its hands off it.
 */
describe('timezone seeding', () => {
  describe('resolveStoredTimezone (the rule)', () => {
    const DEVICE = 'Africa/Tripoli';

    it('replaces the DB placeholder with this device', () => {
      expect(resolveStoredTimezone(PLACEHOLDER_TIMEZONE, DEVICE)).toBe(DEVICE);
    });

    it('fills in an empty stored value from this device', () => {
      expect(resolveStoredTimezone(undefined, DEVICE)).toBe(DEVICE);
      expect(resolveStoredTimezone('', DEVICE)).toBe(DEVICE);
    });

    // A device that reports nothing must not wipe the stored value.
    it('keeps the stored value when the device reports no zone', () => {
      expect(resolveStoredTimezone('Asia/Damascus', undefined)).toBe('Asia/Damascus');
      expect(resolveStoredTimezone(PLACEHOLDER_TIMEZONE, undefined)).toBe(PLACEHOLDER_TIMEZONE);
    });

    // The device is frequently NOT where the business is — an agency, a
    // reseller, or an owner abroad. Tracking it would shift a Damascus shop's
    // hours every time someone travelling opened Settings.
    it('NEVER overwrites a zone the merchant chose', () => {
      expect(resolveStoredTimezone('Asia/Damascus', DEVICE)).toBe('Asia/Damascus');
    });
  });

  describe('BusinessHoursCard no longer touches the timezone', () => {
    function renderCard(settings: SettingsState, setSettings: (s: SettingsState) => void) {
      render(<BusinessHoursCard settings={settings} setSettings={setSettings} currentTime={new Date('2026-07-21T15:26:00Z')} />);
    }

    it('leaves the zone alone when the schedule is switched ON', () => {
      const setSettings = vi.fn();
      renderCard(makeSettings(), setSettings);

      fireEvent.click(screen.getByLabelText('businessHoursLabel'));

      const patch = setSettings.mock.calls[0][0];
      expect(patch.businessHoursOnly).toBe(true);
      expect(patch.timezone).toBe(PLACEHOLDER_TIMEZONE);
    });

    it('leaves the zone alone when the schedule is switched OFF', () => {
      const setSettings = vi.fn();
      renderCard(makeSettings({ businessHoursOnly: true, timezone: 'Asia/Damascus' }), setSettings);

      fireEvent.click(screen.getByLabelText('businessHoursLabel'));

      const patch = setSettings.mock.calls[0][0];
      expect(patch.businessHoursOnly).toBe(false);
      expect(patch.timezone).toBe('Asia/Damascus');
    });
  });
});
