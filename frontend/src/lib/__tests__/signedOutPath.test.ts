import { describe, it, expect, afterEach } from 'vitest';
import { authManager } from '@/lib/authManager';
import { setEmbeddedSession, clearEmbeddedSession } from '@/lib/embeddedSession';

/**
 * D-A: the one answer to "where does a signed-out user go?". Three call sites
 * used to hard-code `/login` (Sidebar, the mobile logout confirm, the layout
 * guard) and produced the Jawab24 login page INSIDE the Zid dashboard — the
 * exact shape app 7367 was rejected for on 2026-08-10, observed again 2026-08-30.
 *
 * Mutation-checked: returning '/login' unconditionally fails the second case.
 */
describe('authManager.signedOutPath', () => {
    afterEach(() => clearEmbeddedSession());

    it('is /login for an ordinary web session', () => {
        expect(authManager.signedOutPath()).toBe('/login');
    });

    it('is the embedded entry page inside a platform frame — never a login wall', () => {
        setEmbeddedSession('zid', 'frame-credential', 'frame-token');
        expect(authManager.signedOutPath()).toBe('/zid/embedded?expired=1');
    });
});
