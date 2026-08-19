import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LanguageSelector } from '@/components/settings/LanguageSelector';
import type { SettingsState } from '@/components/settings/types';
import { settingsApi } from '@/lib/api';
import { makeServerSettings } from '../../testUtils/settingsFactory';
import { toast } from 'sonner';
import { intlState } from '../../testUtils/intlState';

vi.mock('@/lib/api', () => ({
  settingsApi: { update: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));

const mockUpdate = vi.mocked(settingsApi.update);

const makeSettings = makeServerSettings;

function renderSelector(settings: SettingsState) {
  const setSettings = vi.fn();
  const setInitialSettings = vi.fn();
  const setLanguage = vi.fn();
  render(
    <LanguageSelector
      settings={settings}
      initialSettings={settings}
      setSettings={setSettings}
      setInitialSettings={setInitialSettings}
      setLanguage={setLanguage}
    />,
  );
  return { setSettings, setInitialSettings, setLanguage };
}

describe('LanguageSelector — change language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The switch is a one-field quick-action: PUT /settings is a partial update,
  // so it must send ONLY the language — not the whole settings blob.
  it('sends only the dashboardLanguage field', async () => {
    mockUpdate.mockResolvedValue({ data: {} } as never);
    const { setLanguage } = renderSelector(makeSettings({ dashboardLanguage: 'ar' }));

    fireEvent.click(screen.getByText(/English/i));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({ dashboardLanguage: 'en' });
    await waitFor(() => expect(setLanguage).toHaveBeenCalledWith('en'));
  });

  // Regression for JAWAB24-FRONTEND-2J: a stored field that violates the strict
  // settings schema (here a brandVoiceNotes value over the 800-char cap, which
  // can predate the cap) must NOT block a simple language switch. Sending the
  // whole settings object made the switch fail validation on this unrelated
  // field; patching only the language sidesteps it entirely.
  it('changes language even when an unrelated stored field is invalid', async () => {
    mockUpdate.mockResolvedValue({ data: {} } as never);
    const { setLanguage } = renderSelector(
      makeSettings({
        dashboardLanguage: 'ar',
        brandVoiceNotes: 'x'.repeat(2000),
        brandVoiceNotesMulti: { en: 'x'.repeat(2000), ar: 'ع'.repeat(2000) },
      }),
    );

    fireEvent.click(screen.getByText(/English/i));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ dashboardLanguage: 'en' }));
    await waitFor(() => expect(setLanguage).toHaveBeenCalledWith('en'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not commit local state or switch locale when the PUT fails', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));
    const { setSettings, setInitialSettings, setLanguage } = renderSelector(
      makeSettings({ dashboardLanguage: 'ar' }),
    );

    fireEvent.click(screen.getByText(/English/i));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(setLanguage).not.toHaveBeenCalled();
    expect(setSettings).not.toHaveBeenCalled();
    expect(setInitialSettings).not.toHaveBeenCalled();
  });

  it('no-ops when the selected language is already active', () => {
    const { setLanguage } = renderSelector(makeSettings({ dashboardLanguage: 'en' }));

    fireEvent.click(screen.getByText(/English/i));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(setLanguage).not.toHaveBeenCalled();
  });
});

// The control is labelled "system interface language", so its selected state
// must follow the LOCALE THE PAGE IS RENDERED IN — the same rule the other
// settings cards already follow (see languageCoherence.test.tsx). Reported
// 2026-08-19 from the Android app: an English Settings screen with «العربية»
// selected, because the highlight read the stored `dashboardLanguage` column.
// That column only started tracking the header toggle on 2026-08-19 (#831), so
// every merchant who switched language before then still has a stale one.
describe('LanguageSelector — selected state follows the page locale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intlState.locale = 'en';
  });

  it('marks English as selected on an English page even when the stored column says "ar"', () => {
    renderSelector(makeSettings({ dashboardLanguage: 'ar' }));

    expect(screen.getByRole('radio', { name: /English/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /العربية/ })).not.toBeChecked();
  });

  it('marks Arabic as selected on an Arabic page even when the stored column says "en"', () => {
    intlState.locale = 'ar';
    renderSelector(makeSettings({ dashboardLanguage: 'en' }));

    expect(screen.getByRole('radio', { name: /العربية/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /English/i })).not.toBeChecked();
  });

  // The repair path: clicking the already-selected button is a no-op only when
  // the stored column agrees too. Otherwise it is how a merchant fixes the
  // drift by hand — and what makes their pushes arrive in the language they read.
  it('persists the language when the page locale already matches but the stored column does not', async () => {
    mockUpdate.mockResolvedValue({ data: {} } as never);
    renderSelector(makeSettings({ dashboardLanguage: 'ar' }));

    fireEvent.click(screen.getByRole('radio', { name: /English/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ dashboardLanguage: 'en' }));
  });

  // The guard's other half: on an Arabic page whose stored column already says
  // "en", a click on «English» must still switch the UI. Guarding on the stored
  // column alone made that button dead — the merchant saw Arabic selected and
  // could not act on the control at all.
  it('switches the UI when the clicked language matches the stored column but not the page', async () => {
    intlState.locale = 'ar';
    mockUpdate.mockResolvedValue({ data: {} } as never);
    const { setLanguage } = renderSelector(makeSettings({ dashboardLanguage: 'en' }));

    fireEvent.click(screen.getByRole('radio', { name: /English/i }));

    await waitFor(() => expect(setLanguage).toHaveBeenCalledWith('en'));
  });

  it('stays a no-op when the page locale and the stored column already agree', () => {
    renderSelector(makeSettings({ dashboardLanguage: 'en' }));

    fireEvent.click(screen.getByRole('radio', { name: /English/i }));

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
