/**
 * Access-token scope — generateToken/verifyToken round-trip.
 *
 * A scoped token is what keeps a platform embedded session (authenticated by a
 * UUID the platform hands out) from reaching past the store's workspace. The
 * two invariants that make the middleware enforcement meaningful are here:
 * a scope PINS a workspace and force-clears admin at mint time, and both claims
 * SURVIVE verification (a claim that verifyToken drops is not enforceable).
 */

import { describe, it, expect } from 'vitest';
import { AuthService } from '../services/auth';
import type { User } from '../types';

const authService = new AuthService();

const ADMIN_USER = { id: 'user-1', isAdmin: true } as unknown as User;

describe('generateToken scope', () => {
    it('mints an UNSCOPED token by default — ordinary logins are unaffected', () => {
        const payload = authService.verifyToken(authService.generateToken(ADMIN_USER));
        expect(payload?.userId).toBe('user-1');
        expect(payload?.isAdmin).toBe(true);
        expect(payload?.embeddedPlatform).toBeUndefined();
        expect(payload?.workspaceId).toBeUndefined();
    });

    it('force-clears admin on a scoped token even for an admin user', () => {
        const token = authService.generateToken(ADMIN_USER, undefined, { embeddedPlatform: 'zid', workspaceId: 'ws-9' });
        const payload = authService.verifyToken(token);
        expect(payload?.isAdmin).toBe(false);
    });

    it('carries the scope claims THROUGH verification so the middleware can enforce them', () => {
        const token = authService.generateToken(ADMIN_USER, undefined, { embeddedPlatform: 'zid', workspaceId: 'ws-9' });
        const payload = authService.verifyToken(token);
        expect(payload?.embeddedPlatform).toBe('zid');
        expect(payload?.workspaceId).toBe('ws-9');
    });

    it('still rejects a tampered scoped token — the signature covers the scope claims', () => {
        const token = authService.generateToken(ADMIN_USER, undefined, { embeddedPlatform: 'zid', workspaceId: 'ws-9' });
        const [payloadB64] = token.split('.');
        const tampered = Buffer.from(
            JSON.stringify({ ...JSON.parse(Buffer.from(payloadB64, 'base64url').toString()), workspaceId: 'ws-EVIL' }),
        ).toString('base64url');
        expect(authService.verifyToken(`${tampered}.${token.split('.')[1]}`)).toBeNull();
    });
});
