export interface SettingsState {
  dashboardLanguage: string;
  defaultReplyLanguage: string;
  autoDetectLanguage: boolean;
  aiEnabled: boolean;
  aiModel: string;
  notificationsEnabled: boolean;
  pushNotifications: boolean;
  commentReplyMode: string;
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
  businessHoursOnly: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  timezone: string;
  awayMessageMulti: Record<string, string>;
  greetingMessageMulti: Record<string, string>;
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
  brandVoiceNotes: string;
  holdLowConfidence: boolean;
}

export interface SettingsCardProps {
  settings: SettingsState;
  setSettings: (settings: SettingsState) => void;
}
