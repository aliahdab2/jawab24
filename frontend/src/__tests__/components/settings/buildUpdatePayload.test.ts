import { describe, it, expect } from 'vitest';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import {
  changedSettingsFields,
  buildChangedSettingsPayload,
} from '@/components/settings/buildUpdatePayload';
import type { SettingsState } from '@/components/settings/types';

function makeSettings(overrides: Record<string, unknown> = {}): SettingsState {
  return {
    // non-schema fields that must never appear in the PUT payload
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

describe('changedSettingsFields', () => {
  it('returns only the fields that changed', () => {
    const baseline = makeSettings();
    const current = makeSettings({ aiEnabled: false, replyDelay: 5 });
    expect(changedSettingsFields(current, baseline)).toEqual({ aiEnabled: false, replyDelay: 5 });
  });

  it('deep-compares JSONB *Multi fields', () => {
    const baseline = makeSettings({ awayMessageMulti: { en: 'hi' } });
    const current = makeSettings({ awayMessageMulti: { en: 'hi' } });
    expect(changedSettingsFields(current, baseline)).toEqual({});
  });

  it('never includes non-schema fields even when they differ', () => {
    const baseline = makeSettings({ pushNotifications: true });
    const current = makeSettings({ pushNotifications: false, id: 'other', userId: 'other' });
    expect(changedSettingsFields(current, baseline)).toEqual({});
  });
});

describe('buildChangedSettingsPayload', () => {
  // Regression for JAWAB24-FRONTEND-2J: a stored brandVoiceNotes that exceeds
  // the 800-char cap (and was NOT touched this edit) must not block saving an
  // unrelated field.
  it('does not block an unrelated save when an UNCHANGED field is invalid', () => {
    const overCap = 'x'.repeat(2000);
    const baseline = makeSettings({
      brandVoiceNotes: overCap,
      brandVoiceNotesMulti: { en: overCap },
    });
    const current = makeSettings({
      brandVoiceNotes: overCap, // unchanged, still over cap
      brandVoiceNotesMulti: { en: overCap },
      replyStyle: 'casual', // the actual edit
    });

    const result = buildChangedSettingsPayload(current, baseline);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ replyStyle: 'casual' });
    }
  });

  it('still rejects when the user edits a field to an invalid value', () => {
    const baseline = makeSettings({ brandVoiceNotes: 'short' });
    const current = makeSettings({ brandVoiceNotes: 'x'.repeat(2000) }); // edited to over cap

    const result = buildChangedSettingsPayload(current, baseline);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('brandVoiceNotes');
    }
  });

  it('clamps a stale over-cap brandVoiceNotesMulti language so editing another language still saves', () => {
    // The textarea caps the language being edited, but a previously machine-
    // translated OTHER language can exceed the cap (data predating the backend
    // clamp). Editing one language resends the WHOLE object in the diff, so that
    // stale value would fail schema validation and dead-end the save. The heal
    // clamps it so the save proceeds.
    const overCapEn = 'x'.repeat(MAX_BRAND_VOICE_LENGTH + 200);
    const baseline = makeSettings({
      brandVoiceNotesMulti: { ar: 'قديم', en: overCapEn, sourceLang: 'ar' },
    });
    const current = makeSettings({
      brandVoiceNotesMulti: { ar: 'تعليمات جديدة', en: overCapEn, sourceLang: 'ar' }, // edited AR
    });

    const result = buildChangedSettingsPayload(current, baseline);
    expect(result.success).toBe(true);
    if (result.success) {
      const multi = result.data.brandVoiceNotesMulti as Record<string, string>;
      expect(multi.en.length).toBe(MAX_BRAND_VOICE_LENGTH); // clamped to the cap
      expect(multi.ar).toBe('تعليمات جديدة'); // edited language preserved
    }
  });

  it('yields an empty diff when nothing schema-relevant changed', () => {
    const baseline = makeSettings();
    const current = makeSettings({ pushNotifications: false }); // non-schema only
    const result = buildChangedSettingsPayload(current, baseline);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });
});
