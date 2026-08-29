/**
 * Who may be handed the Sham Cash wallet number.
 *
 * Any AUTHENTICATED account, wherever its request resolves — and that is the
 * point under test, because the first cut got it wrong the other way: it gated
 * disclosure on the request's IP country, and a Syrian merchant on a VPN (the
 * normal case inside Syria) resolved to Germany, never saw the panel, and was
 * sent to a card form that declines. The wallet number is a pay-TO address
 * printed on the wallet's own QR card, not a secret; "logged in" is the bar.
 *
 * `config` is mocked through importOriginal so only the `shamCash` block is
 * replaced; every other value the controller reads stays real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.hoisted` because vi.mock is lifted above ordinary consts — a plain
// `const` here is still in its temporal dead zone when the factory runs.
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

/** Minimal Fastify reply double — status/send is all this handler touches. */
function fakeReply() {
    const sent: { status: number; body: unknown } = { status: 200, body: undefined };
    const reply = {
        status(code: number) { sent.status = code; return reply; },
        send(body: unknown) { sent.body = body; return reply; },
    };
    return { reply, sent };
}

function request(country?: string, authenticated = true) {
    return {
        user: authenticated ? { userId: 'u1' } : undefined,
        geo: country ? { country } : undefined,
    } as never;
}

beforeEach(() => {
    shamCash.walletNumber = '0912345678';
});

describe('GET /payment/offline/config — wallet disclosure', () => {
    it('gives the wallet details to a request from inside Syria', async () => {
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('SY'), reply as never);

        expect(sent.status).toBe(200);
        expect(sent.body).toMatchObject({ rail: 'sham_cash', walletNumber: '0912345678' });
    });

    it('gives them to a request that resolves ELSEWHERE — the Syrian merchant on a VPN', async () => {
        // The regression this file exists for: gating on IP country locked out
        // exactly the merchants the rail is for.
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('DE'), reply as never);

        expect(sent.status).toBe(200);
        expect(sent.body).toMatchObject({ walletNumber: '0912345678' });
    });

    it('gives them when the country could not be resolved at all', async () => {
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request(undefined), reply as never);

        expect(sent.status).toBe(200);
    });

    it('REFUSES an unauthenticated request — the number is for merchants, not the open web', async () => {
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('SY', false), reply as never);

        expect(sent.status).toBe(401);
    });

    it('answers 404 when the rail is off (no wallet number configured)', async () => {
        shamCash.walletNumber = '';
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('SY'), reply as never);

        expect(sent.status).toBe(404);
        expect(sent.body).toEqual({ error: 'offline_payments_unavailable' });
    });
});
