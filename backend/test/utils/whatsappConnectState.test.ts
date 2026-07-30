import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: { jwt: { secret: 'test-state-secret' } },
}));

import {
    mintWhatsAppConnectState,
    verifyWhatsAppConnectState,
    WHATSAPP_STATE_TTL_MS,
} from '../../src/utils/whatsappConnectState';

const INPUT = {
    userId: 'user-1',
    workspaceId: 'ws-1',
    pageId: 'page-1' as string | null,
    coexistence: true,
    locale: 'en' as const,
};

describe('whatsappConnectState', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('round-trips: mint → verify returns the payload and a fresh nonce', () => {
        const { state, nonce } = mintWhatsAppConnectState(INPUT);
        const verified = verifyWhatsAppConnectState(state);
        expect(verified).not.toBeNull();
        expect(verified).toMatchObject({ ...INPUT, nonce });
        expect(verified!.exp).toBeGreaterThan(Date.now());
    });

    it('pageId null (new WhatsApp-only card) survives the round trip', () => {
        const { state } = mintWhatsAppConnectState({ ...INPUT, pageId: null });
        expect(verifyWhatsAppConnectState(state)!.pageId).toBeNull();
    });

    it('rejects a tampered payload — flipping coexistence invalidates the signature', () => {
        const { state } = mintWhatsAppConnectState(INPUT);
        const [payload, sig] = state.split('.');
        const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        json.coexistence = false; // the field an attacker would most want to flip
        const forged = `${Buffer.from(JSON.stringify(json)).toString('base64url')}.${sig}`;
        expect(verifyWhatsAppConnectState(forged)).toBeNull();
    });

    it('rejects a tampered signature', () => {
        const { state } = mintWhatsAppConnectState(INPUT);
        const flipped = state.slice(0, -2) + (state.endsWith('AA') ? 'BB' : 'AA');
        expect(verifyWhatsAppConnectState(flipped)).toBeNull();
    });

    it('rejects an expired state', () => {
        vi.useFakeTimers();
        const { state } = mintWhatsAppConnectState(INPUT);
        vi.advanceTimersByTime(WHATSAPP_STATE_TTL_MS + 1000);
        expect(verifyWhatsAppConnectState(state)).toBeNull();
    });

    it('rejects garbage inputs without throwing', () => {
        expect(verifyWhatsAppConnectState('')).toBeNull();
        expect(verifyWhatsAppConnectState('no-dot-here')).toBeNull();
        expect(verifyWhatsAppConnectState('..')).toBeNull();
        expect(verifyWhatsAppConnectState(`${Buffer.from('"just a string"').toString('base64url')}.AAAA`)).toBeNull();
    });

    it('rejects a validly-signed payload with an unknown locale (redirect-target constraint)', () => {
        // Locale becomes part of a 302 target; only known locales may pass. Craft
        // via the real minter then verify the validator's shape check by signing a
        // bad payload with the real key — simulated by minting with a cast.
        const { state } = mintWhatsAppConnectState({ ...INPUT, locale: 'fr' as unknown as 'en' });
        expect(verifyWhatsAppConnectState(state)).toBeNull();
    });
});
