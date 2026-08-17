import { describe, it, expect } from 'vitest';
import { isReplyModeVisible } from '@/lib/featureFlags';

/**
 * Pins the D-085 pilot gate's REAL function and its built-in default list:
 * the InMedia pilot workspace + the founder workspace (owner order 2026-08-17,
 * dogfooding). The backend default (config.replyMode.workspaceIds) must carry
 * the same two ids — its own pin lives in backend/test/config/
 * replyModeAllowlist.test.ts; this one keeps the FRONTEND half from drifting
 * (this fn only hides the UI, the backend list is the enforcement).
 */
describe('isReplyModeVisible — pilot allowlist', () => {
    it('shows for the InMedia pilot workspace', () => {
        expect(isReplyModeVisible('d06ed500-74ea-42ee-bff6-37bee2cf412a')).toBe(true);
    });

    it('shows for the founder workspace (dogfooding)', () => {
        expect(isReplyModeVisible('a0005407-92bf-473e-9368-013f14c57a7d')).toBe(true);
    });

    it('hides for any other workspace', () => {
        expect(isReplyModeVisible('some-other-ws')).toBe(false);
    });

    it('hides with no workspace at all', () => {
        expect(isReplyModeVisible(null)).toBe(false);
        expect(isReplyModeVisible(undefined)).toBe(false);
    });
});
