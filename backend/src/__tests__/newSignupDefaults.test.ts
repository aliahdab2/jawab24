import { describe, it, expect } from 'vitest';
import { DEFAULTS, NEW_SIGNUP_SETTINGS_SEED } from '../services/workspaceSettings';
import type { WorkspaceSettings } from '@jawab24/shared';

/**
 * Guards the two invariants behind D-025 (safe new-signup defaults):
 *
 *  1. A NEW signup's workspace JSONB is seeded with NEW_SIGNUP_SETTINGS_SEED, so
 *     its effective settings read auto-reply OFF (both surfaces) + dual comment mode.
 *  2. EXISTING merchants are untouched: their JSONB omits these keys, so the
 *     read-time merge ({ ...DEFAULTS, ...jsonb }) still resolves the historical
 *     defaults (comments ON, messages ON, 'public'). This is the no-touch guarantee.
 *
 * The test replicates the exact merge getSettings performs at
 * services/workspaceSettings.ts (`{ ...DEFAULTS, ...raw }`) so a change to either
 * DEFAULTS or the seed that would break a cohort is caught without a DB.
 */
const mergeEffective = (jsonb: Partial<WorkspaceSettings>): WorkspaceSettings => ({
    ...DEFAULTS,
    ...jsonb,
});

describe('new-signup safe defaults (D-025)', () => {
    it('seed is minimal — only the three intended keys, nothing else', () => {
        // A wider seed would silently pin OTHER settings for new signups and drift
        // from DEFAULTS over time. Keep it to exactly the safety-relevant keys.
        expect(Object.keys(NEW_SIGNUP_SETTINGS_SEED).sort()).toEqual(
            ['commentReplyMode', 'commentsAutoReply', 'messagesAutoReply'],
        );
    });

    it('a NEW signup resolves to auto-reply OFF + dual', () => {
        const effective = mergeEffective(NEW_SIGNUP_SETTINGS_SEED);
        expect(effective.commentsAutoReply).toBe(false);
        expect(effective.messagesAutoReply).toBe(false);
        expect(effective.commentReplyMode).toBe('dual');
    });

    it('an EXISTING workspace (empty JSONB) still resolves to the historical defaults — no-touch guarantee', () => {
        const effective = mergeEffective({});
        expect(effective.commentsAutoReply).toBe(true);
        expect(effective.messagesAutoReply).toBe(true);
        expect(effective.commentReplyMode).toBe('public');
    });

    it('an EXISTING workspace that only set unrelated keys keeps the historical auto-reply defaults', () => {
        // e.g. a merchant who customized their greeting but never touched auto-reply.
        const effective = mergeEffective({ greetingMessageEnabled: true, replyDelay: 5 });
        expect(effective.commentsAutoReply).toBe(true);
        expect(effective.messagesAutoReply).toBe(true);
        expect(effective.commentReplyMode).toBe('public');
    });
});
