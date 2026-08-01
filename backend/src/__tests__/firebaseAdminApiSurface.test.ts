/**
 * Pins the firebase-admin API surface that sendPushNotification consumes.
 *
 * The SDK is loaded with a lazy require() inside the send path, so TypeScript
 * never checks these bindings — a major bump that reshapes the package only
 * fails at runtime, on the first real push. That is exactly how v13 → v14
 * broke production: v14 deleted the namespaced API (admin.apps,
 * admin.credential.cert, admin.messaging()), every push threw "Cannot read
 * properties of undefined (reading 'length')", and nothing went red before
 * deploy (JAWAB24-BACKEND-1R). This suite makes the next reshape fail here,
 * at upgrade time, instead of in production.
 */
import { describe, it, expect } from 'vitest';

describe('firebase-admin modular API surface (JAWAB24-BACKEND-1R)', () => {
    it('firebase-admin/app exposes getApps, initializeApp and cert', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const app = require('firebase-admin/app');
        expect(typeof app.getApps).toBe('function');
        expect(typeof app.initializeApp).toBe('function');
        expect(typeof app.cert).toBe('function');
        // The `!getApps().length` init guard requires an array return.
        expect(Array.isArray(app.getApps())).toBe(true);
    });

    it('firebase-admin/messaging exposes getMessaging with sendEachForMulticast', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const messaging = require('firebase-admin/messaging');
        expect(typeof messaging.getMessaging).toBe('function');
        expect(typeof messaging.Messaging.prototype.sendEachForMulticast).toBe('function');
    });
});
