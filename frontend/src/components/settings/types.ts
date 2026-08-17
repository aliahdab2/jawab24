import type { ReplyMode } from '@jawab24/shared';

export interface SettingsState {
  dashboardLanguage: string;
  defaultReplyLanguage: string;
  autoDetectLanguage: boolean;
  aiEnabled: boolean;
  aiModel: string;
  notificationsEnabled: boolean;
  newLeadAlertsEnabled: boolean;
  pushNotifications: boolean;
  commentReplyMode: string;
  /** Smart Reply comments: the page likes the customer's comment after replying (Facebook only). */
  likeComments: boolean;
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
  businessHoursOnly: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  timezone: string;
  awayMessageMulti: Record<string, string>;
  greetingMessageMulti: Record<string, string>;
  /** When false, the configured greeting is never sent on first contact. */
  greetingMessageEnabled: boolean;
  limitFallbackEnabled: boolean;
  limitFallbackMessageMulti: Record<string, string>;
  dualReplyNudgeMulti: Record<string, string>;
  brandVoiceNotesMulti: Record<string, string>;
  awayMessage: string;
  greetingMessage: string;
  replyDelay: number;
  dualReplyNudge: string;
  commentEscalationMinutes: number;
  messageEscalationMinutes: number;
  handoffPauseDurationMinutes: number;
  replyStyle: string;
  /** Workspace default reply mode; pages may override per-page. Typed as the
   *  shared union, not `string`, so a typo can never reach the PUT (the backend
   *  would 400 the whole save) and the UI needs no defensive re-narrowing. */
  replyMode: ReplyMode;
  brandVoiceNotes: string;
  holdLowConfidence: boolean;
}

export interface SettingsCardProps {
  settings: SettingsState;
  setSettings: (settings: SettingsState) => void;
  /**
   * Field-level validation errors from the shared Zod schema, keyed by the
   * top-level field name in `UpdateSettingsSchema` (e.g. `dualReplyNudge`,
   * `awayMessage`). Set by the settings page when pre-submit validation
   * fails. Cards render inline errors for fields they own.
   */
  fieldErrors?: Record<string, string>;
}
