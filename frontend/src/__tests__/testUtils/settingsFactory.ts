import type { SettingsState } from '@/components/settings/types';

/**
 * Canonical full `SettingsState` for settings-card tests. One definition for
 * every test file — override per test (or wrap per file) instead of copying
 * the 30-field object.
 */
export function makeSettings(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    dashboardLanguage: 'en',
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: false,
    newLeadAlertsEnabled: false,
    pushNotifications: false,
    commentReplyMode: 'dual',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    timezone: 'UTC',
    awayMessageMulti: {},
    greetingMessageMulti: {},
    greetingMessageEnabled: false,
    limitFallbackEnabled: false,
    limitFallbackMessageMulti: {},
    dualReplyNudgeMulti: {},
    awayMessage: '',
    greetingMessage: '',
    replyDelay: 0,
    dualReplyNudge: '',
    brandVoiceNotesMulti: {},
    replyStyle: 'professional',
    replyMode: 'sales',
    brandVoiceNotes: '',
    holdLowConfidence: false,
    likeComments: false,
    commentEscalationMinutes: 30,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: 60,
    ...overrides,
  };
}

/**
 * `SettingsState` as the settings PAGE holds it after a GET: the server-owned
 * `id`/`userId` and the client-only `pushNotifications` merged in — fields the
 * `PUT /settings` payload builder must strip (`UpdateSettingsSchema` is
 * `.strict()`, so any of them in the body makes the backend 400 the whole PUT).
 */
export function makeServerSettings(overrides: Record<string, unknown> = {}): SettingsState {
  return {
    id: 'settings-1',
    userId: 'user-1',
    ...makeSettings({
      dashboardLanguage: 'ar',
      commentReplyMode: 'public',
      notificationsEnabled: true,
      newLeadAlertsEnabled: true,
      greetingMessageEnabled: true,
      pushNotifications: true,
    }),
    ...overrides,
  } as unknown as SettingsState;
}
