import { describe, it, expect } from 'vitest';
import { UpdateSettingsSchema } from '../settings';
import { MAX_BRAND_VOICE_LENGTH } from '../../constants';

describe('UpdateSettingsSchema', () => {
    describe('escalation minutes', () => {
        it('accepts valid values', () => {
            const result = UpdateSettingsSchema.safeParse({
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 30,
            });
            expect(result.success).toBe(true);
        });

        it('rejects values below 5', () => {
            const result = UpdateSettingsSchema.safeParse({ commentEscalationMinutes: 2 });
            expect(result.success).toBe(false);
        });

        it('rejects values above 1440', () => {
            const result = UpdateSettingsSchema.safeParse({ messageEscalationMinutes: 2000 });
            expect(result.success).toBe(false);
        });

        it('rejects non-integer values', () => {
            const result = UpdateSettingsSchema.safeParse({ commentEscalationMinutes: 30.5 });
            expect(result.success).toBe(false);
        });

        it('accepts boundary values (5 and 1440)', () => {
            const minResult = UpdateSettingsSchema.safeParse({ commentEscalationMinutes: 5 });
            const maxResult = UpdateSettingsSchema.safeParse({ messageEscalationMinutes: 1440 });
            expect(minResult.success).toBe(true);
            expect(maxResult.success).toBe(true);
        });
    });

    describe('booleans', () => {
        it('accepts true/false for notificationsEnabled', () => {
            expect(UpdateSettingsSchema.safeParse({ notificationsEnabled: true }).success).toBe(true);
            expect(UpdateSettingsSchema.safeParse({ notificationsEnabled: false }).success).toBe(true);
        });

        it('rejects non-boolean for notificationsEnabled', () => {
            expect(UpdateSettingsSchema.safeParse({ notificationsEnabled: 'true' }).success).toBe(false);
            expect(UpdateSettingsSchema.safeParse({ notificationsEnabled: 1 }).success).toBe(false);
        });

        it('accepts true/false for likeComments and rejects non-boolean', () => {
            expect(UpdateSettingsSchema.safeParse({ likeComments: true }).success).toBe(true);
            expect(UpdateSettingsSchema.safeParse({ likeComments: false }).success).toBe(true);
            expect(UpdateSettingsSchema.safeParse({ likeComments: 'true' }).success).toBe(false);
        });
    });

    describe('timezone', () => {
        it.each(['Asia/Riyadh', 'America/New_York', 'Europe/London', 'UTC', 'Pacific/Auckland'])(
            'accepts %s',
            (tz) => {
                expect(UpdateSettingsSchema.safeParse({ timezone: tz }).success).toBe(true);
            },
        );

        it('rejects invalid IANA name', () => {
            expect(UpdateSettingsSchema.safeParse({ timezone: 'Invalid/Timezone' }).success).toBe(false);
        });

        it('rejects empty string', () => {
            expect(UpdateSettingsSchema.safeParse({ timezone: '' }).success).toBe(false);
        });

        it('rejects strings longer than 100 chars', () => {
            expect(UpdateSettingsSchema.safeParse({ timezone: 'A'.repeat(101) }).success).toBe(false);
        });
    });

    describe('strict mode (additionalProperties: false)', () => {
        it('rejects unknown keys and names them in the error', () => {
            const result = UpdateSettingsSchema.safeParse({ bogusField: 'oops' });
            expect(result.success).toBe(false);
            if (!result.success) {
                const err = result.error.errors[0];
                expect(err.code).toBe('unrecognized_keys');
                expect(JSON.stringify(err)).toContain('bogusField');
            }
        });

        it('accepts an empty body', () => {
            expect(UpdateSettingsSchema.safeParse({}).success).toBe(true);
        });
    });

    describe('length-bounded strings', () => {
        it('rejects dualReplyNudge longer than 80 chars and names the field', () => {
            const result = UpdateSettingsSchema.safeParse({ dualReplyNudge: 'a'.repeat(81) });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.errors[0].path).toEqual(['dualReplyNudge']);
            }
        });

        it('accepts dualReplyNudge of exactly 80 chars', () => {
            expect(UpdateSettingsSchema.safeParse({ dualReplyNudge: 'a'.repeat(80) }).success).toBe(true);
        });

        it.each([
            ['awayMessage', 1001],
            ['greetingMessage', 1001],
        ])('rejects %s longer than 1000 chars', (field, len) => {
            const result = UpdateSettingsSchema.safeParse({ [field]: 'a'.repeat(len) });
            expect(result.success).toBe(false);
        });

        it('rejects brandVoiceNotes longer than MAX_BRAND_VOICE_LENGTH', () => {
            const result = UpdateSettingsSchema.safeParse({
                brandVoiceNotes: 'a'.repeat(MAX_BRAND_VOICE_LENGTH + 1),
            });
            expect(result.success).toBe(false);
        });

        it('accepts brandVoiceNotes of exactly MAX_BRAND_VOICE_LENGTH', () => {
            const result = UpdateSettingsSchema.safeParse({
                brandVoiceNotes: 'a'.repeat(MAX_BRAND_VOICE_LENGTH),
            });
            expect(result.success).toBe(true);
        });
    });

    describe('time format', () => {
        it.each(['09:00', '23:59', '00:00', '9:30'])('accepts %s', (time) => {
            expect(UpdateSettingsSchema.safeParse({ businessHoursStart: time }).success).toBe(true);
        });

        it.each(['24:00', '9-30', '0900', 'morning', ''])('rejects %s', (time) => {
            expect(UpdateSettingsSchema.safeParse({ businessHoursStart: time }).success).toBe(false);
        });
    });

    describe('enums', () => {
        it.each(['professional', 'casual', 'enthusiastic'])('accepts replyStyle=%s', (s) => {
            expect(UpdateSettingsSchema.safeParse({ replyStyle: s }).success).toBe(true);
        });

        it('rejects unknown replyStyle', () => {
            expect(UpdateSettingsSchema.safeParse({ replyStyle: 'snarky' }).success).toBe(false);
        });

        it.each(['sales', 'info'])('accepts replyMode=%s', (m) => {
            expect(UpdateSettingsSchema.safeParse({ replyMode: m }).success).toBe(true);
        });

        it('rejects unknown replyMode', () => {
            expect(UpdateSettingsSchema.safeParse({ replyMode: 'support' }).success).toBe(false);
        });

        it.each(['public', 'private', 'dual'])('accepts commentReplyMode=%s', (m) => {
            expect(UpdateSettingsSchema.safeParse({ commentReplyMode: m }).success).toBe(true);
        });

        it('rejects unknown commentReplyMode', () => {
            expect(UpdateSettingsSchema.safeParse({ commentReplyMode: 'mixed' }).success).toBe(false);
        });
    });

    describe('happy path', () => {
        it('accepts a realistic full payload', () => {
            const result = UpdateSettingsSchema.safeParse({
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentsAutoReply: true,
                messagesAutoReply: true,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                timezone: 'Asia/Riyadh',
                awayMessageMulti: { ar: 'مرحباً', en: 'Hello' },
                greetingMessageMulti: { ar: 'أهلاً', en: 'Welcome' },
                limitFallbackEnabled: false,
                limitFallbackMessageMulti: {},
                dualReplyNudgeMulti: { ar: 'راجع رسائلك', en: 'Check your DMs' },
                brandVoiceNotesMulti: {},
                replyDelay: 0,
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 30,
                handoffPauseDurationMinutes: 15,
                notificationsEnabled: true,
                replyStyle: 'professional',
                holdLowConfidence: false,
            });
            expect(result.success).toBe(true);
        });
    });
});
