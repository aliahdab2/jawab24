/**
 * GET /payment/offline/config — the wallet is handed to any AUTHENTICATED
 * account, and the answer is always 200.
 *
 * Two earlier contracts were wrong and are pinned here in the negative: an IP
 * gate (a Syrian merchant on a VPN — the normal case — resolved to Germany and
 * never saw the panel), and a 404 for "rail off" (byte-for-byte what Fastify
 * answers for a route that does not exist, so a frontend-before-backend deploy
 * read as "rail deliberately off").
 *
 * `config` is mocked through importOriginal so only the `shamCash` block is
 * replaced; every other value the controller reads stays real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const shamCash = vi.hoisted(() => ({
    walletNumber: '0912345678',
    walletName: 'Jawab24',
    qrImageUrl: '',
}));

vi.mock('../db', () => ({ db: {} }));
vi.mock('../config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../config')>();
    return { ...actual, config: { ...actual.config, shamCash } };
});

import { offlinePaymentsController } from '../controllers/offlinePayments';

function fakeReply() {
    const sent: { status: number; body: unknown } = { status: 200, body: undefined };
    const reply = {
        status(code: number) { sent.status = code; return reply; },
        send(body: unknown) { sent.body = body; return reply; },
    };
    return { reply, sent };
}

function request(opts: { authenticated?: boolean; country?: string } = {}) {
    return {
        user: opts.authenticated === false ? undefined : { userId: 'u1' },
        geo: opts.country ? { country: opts.country } : undefined,
    } as never;
}

beforeEach(() => {
    shamCash.walletNumber = '0912345678';
});

describe('GET /payment/offline/config — wallet disclosure', () => {
    it('gives the wallet details to any authenticated request, whatever its IP resolved to', async () => {
        for (const country of ['SY', 'DE', undefined]) {
            const { reply, sent } = fakeReply();
            await offlinePaymentsController.getConfig(request({ country }), reply as never);
            expect(sent.status).toBe(200);
            expect(sent.body).toMatchObject({ enabled: true, rail: 'sham_cash', walletNumber: '0912345678' });
        }
    });

    it('REFUSES an unauthenticated request — the number is for merchants, not the open web', async () => {
        const { reply, sent } = fakeReply();
        await offlinePaymentsController.getConfig(request({ authenticated: false }), reply as never);
        expect(sent.status).toBe(401);
    });

    it('answers 200 { enabled: false } when the rail is off — never a 404', async () => {
        shamCash.walletNumber = '';
        const { reply, sent } = fakeReply();
        await offlinePaymentsController.getConfig(request(), reply as never);
        expect(sent.status).toBe(200);
        expect(sent.body).toEqual({ enabled: false });
    });
});
