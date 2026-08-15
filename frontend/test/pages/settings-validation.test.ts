import { describe, it, expect } from 'vitest';
import { UpdateSettingsSchema } from '@jawab24/shared';

/**
 * The settings save handler in `src/pages/settings.tsx` calls
 * `UpdateSettingsSchema.safeParse(editableSettings)` and walks each
 * `issue.path[0]` into a `fieldErrors` map keyed by top-level field name. This
 * test pins down the contract that handler depends on — if Zod or the schema
 * shape ever change, the failures here will land before users hit a stale
 * `fieldErrors` mapping in production.
 */
describe('settings.tsx pre-submit validation contract', () => {
    function fieldErrorsFromSchema(input: unknown): Record<string, string> {
        const result = UpdateSettingsSchema.safeParse(input);
        if (result.success) return {};
        const errors: Record<string, string> = {};
        for (const issue of result.error.errors) {
            const field = issue.path[0]?.toString();
            if (field && !errors[field]) errors[field] = issue.message;
        }
        return errors;
    }

    it('returns an empty error map for a valid payload', () => {
        expect(fieldErrorsFromSchema({ replyStyle: 'professional' })).toEqual({});
    });

    it('flags dualReplyNudge > 80 chars by field name', () => {
        const errors = fieldErrorsFromSchema({ dualReplyNudge: 'a'.repeat(81) });
        expect(errors).toHaveProperty('dualReplyNudge');
        expect(errors.dualReplyNudge).toMatch(/80/);
    });

    it('flags awayMessage > 1000 chars by field name', () => {
        const errors = fieldErrorsFromSchema({ awayMessage: 'a'.repeat(1001) });
        expect(errors).toHaveProperty('awayMessage');
    });

    it('flags out-of-range replyDelay', () => {
        const errors = fieldErrorsFromSchema({ replyDelay: 9999 });
        expect(errors).toHaveProperty('replyDelay');
    });

    it('flags unrecognized keys at the top level (strict mode)', () => {
        // .strict() emits an `unrecognized_keys` issue with an empty path,
        // so it won't appear under a field — but we should still detect it.
        const result = UpdateSettingsSchema.safeParse({ bogusField: 'oops' });
        expect(result.success).toBe(false);
    });

    it('flags invalid enum (replyStyle) by field name', () => {
        const errors = fieldErrorsFromSchema({ replyStyle: 'snarky' });
        expect(errors).toHaveProperty('replyStyle');
    });

    it('flags invalid enum (replyMode) by field name', () => {
        const errors = fieldErrorsFromSchema({ replyMode: 'support' });
        expect(errors).toHaveProperty('replyMode');
    });

    it('flags bad businessHoursStart format', () => {
        const errors = fieldErrorsFromSchema({ businessHoursStart: '25:00' });
        expect(errors).toHaveProperty('businessHoursStart');
    });
});
