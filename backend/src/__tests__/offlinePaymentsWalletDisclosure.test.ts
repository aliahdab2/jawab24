/**
 * Who may be handed the Sham Cash wallet number.
 *
 * It is the owner's own financial identifier, so the endpoint that discloses it
 * is gated on the SERVER-resolved country of the request — not on the
 * client-side geo cache, which the caller controls, and not merely on being
 * logged in. An authenticated account anywhere in the world could otherwise
 * scrape it from `/payment/offline/config`.
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
    countries: ['SY'] as string[],
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

function request(country?: string) {
    return { user: { userId: 'u1' }, geo: country ? { country } : undefined } as never;
}

beforeEach(() => {
    shamCash.walletNumber = '0912345678';
    shamCash.countries = ['SY'];
});

describe('GET /payment/offline/config — wallet disclosure', () => {
    it('gives the wallet details to a request from inside Syria', async () => {
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('SY'), reply as never);

        expect(sent.status).toBe(200);
        expect(sent.body).toMatchObject({ rail: 'sham_cash', walletNumber: '0912345678' });
    });

    it('accepts a lowercase country code from the geo provider', async () => {
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('sy'), reply as never);

        expect(sent.status).toBe(200);
    });

    it('REFUSES an authenticated request from another country', async () => {
        // The scrape this gate exists to stop: any logged-in account, anywhere.
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('DE'), reply as never);

        expect(sent.status).toBe(404);
        expect(sent.body).toEqual({ error: 'offline_payments_unavailable' });
    });

    it('REFUSES a request whose country could not be resolved (fails closed)', async () => {
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request(undefined), reply as never);

        expect(sent.status).toBe(404);
    });

    it('answers the SAME 404 when the rail is off, so it is not an oracle', async () => {
        // A distinct code would tell a caller whether a wallet is configured.
        shamCash.walletNumber = '';
        const { reply, sent } = fakeReply();

        await offlinePaymentsController.getConfig(request('SY'), reply as never);

        expect(sent.status).toBe(404);
        expect(sent.body).toEqual({ error: 'offline_payments_unavailable' });
    });
});
