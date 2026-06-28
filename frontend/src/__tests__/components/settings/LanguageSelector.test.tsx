import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LanguageSelector } from '@/components/settings/LanguageSelector';
import type { SettingsState } from '@/components/settings/types';
import { settingsApi } from '@/lib/api';
import { toast } from 'sonner';

vi.mock('@/lib/api', () => ({
  settingsApi: { update: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

vi.mock('@/components/ui', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const mockUpdate = vi.mocked(settingsApi.update);

// `SettingsState` carries fields that are NOT part of the `PUT /settings`
// contract: the server-owned `id`/`userId` (merged in from the GET response at
// runtime) and the client-only `pushNotifications`. `UpdateSettingsSchema` is
// `.strict()`, so any of them in the body makes the backend 400 the whole PUT.
function makeSettings(overrides: Record<string, unknown> = {}): SettingsState {
  return {
    // server-owned / client-only fields that MUST be stripped before PUT
    id: 'settings-1',
    userId: 'user-1',
    pushNotifications: true,
    // schema fields
    dashboardLanguage: 'ar',
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: true,
    newLeadAlertsEnabled: true,
    commentReplyMode: 'public',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    timezone: 'UTC',
    awayMessageMulti: {},
    greetingMessageMulti: {},
    greetingMessageEnabled: true,
    limitFallbackEnabled: false,
    limitFallbackMessageMulti: {},
    dualReplyNudgeMulti: {},
    brandVoiceNotesMulti: {},
    awayMessage: '',
    greetingMessage: '',
    replyDelay: 0,
    dualReplyNudge: '',
    commentEscalationMinutes: 30,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: 60,
    replyStyle: 'professional',
    brandVoiceNotes: '',
    holdLowConfidence: false,
    ...overrides,
  } as unknown as SettingsState;
}

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
