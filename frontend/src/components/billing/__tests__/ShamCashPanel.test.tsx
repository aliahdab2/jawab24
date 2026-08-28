import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import en from '@/i18n/en/payment.json';

/**
 * What a merchant inside Syria sees at checkout.
 *
 * The rule this pins is a product decision, not a detail: where a local rail
 * exists we show a PAYMENT screen, never "payments are not available in your
 * region". The old notice must still appear when the rail is switched off,
 * because a payment panel with no wallet behind it is worse than an honest
 * dead end.
 *
 * `@/lib/api` is mocked only for the three offline-payment calls, through
 * importActual, so the rest of the client — interceptors, types, every other
 * caller — stays real. A blanket module stub here would let the panel "pass"
 * against an API surface that no longer exists.
 */
const getConfig = vi.fn();
const listMine = vi.fn();
const submit = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/api')>()),
    offlinePaymentApi: {
        getConfig: () => getConfig(),
        listMine: () => listMine(),
        submit: (payload: unknown) => submit(payload),
    },
}));

import { ShamCashPanel } from '../ShamCashPanel';

const CONFIG = {
    rail: 'sham_cash' as const,
    walletNumber: '0912345678',
    walletName: 'Jawab24',
    qrImageUrl: null,
    currency: 'usd',
};

function renderPanel() {
    return render(
        <ShamCashPanel
            planId="plan-1"
            planName="Business"
            billingInterval="month"
            amountCents={2900}
            userEmail="merchant@example.com"
        />,
    );
}

/** An axios-shaped rejection, the only error shape the panel branches on. */
function httpError(status: number, code?: string) {
    return { response: { status, data: code ? { error: code } : undefined } };
}

beforeEach(() => {
    vi.clearAllMocks();
    getConfig.mockResolvedValue({ data: CONFIG });
    listMine.mockResolvedValue({ data: { claims: [] } });
});

describe('ShamCashPanel', () => {
    it('shows the wallet number and a copy button, not a blocked-region notice', async () => {
        renderPanel();

        expect(await screen.findByText(CONFIG.walletNumber)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: en.shamCash.copy })).toBeInTheDocument();
        expect(screen.queryByText(en.unavailable.title)).not.toBeInTheDocument();
    });

    it('falls back to the payments-unavailable notice when the rail is off', async () => {
        // 404 = no wallet number configured. The merchant still needs somewhere
        // to go, and that is the WhatsApp notice we shipped before this rail.
        getConfig.mockRejectedValue(httpError(404));
        renderPanel();

        expect(await screen.findByText(en.unavailable.title)).toBeInTheDocument();
    });

    it('refuses to submit without a transfer reference', async () => {
        renderPanel();
        await screen.findByText(CONFIG.walletNumber);

        fireEvent.click(screen.getByRole('button', { name: en.shamCash.submit }));

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorReferenceRequired);
        expect(submit).not.toHaveBeenCalled();
    });

    it('submits the reference and then shows the under-review state', async () => {
        submit.mockResolvedValue({
            data: { claim: { id: 'c1', status: 'pending_review', transferReference: '84719203' } },
        });
        renderPanel();
        await screen.findByText(CONFIG.walletNumber);

        fireEvent.change(screen.getByLabelText(en.shamCash.referenceLabel), { target: { value: '84719203' } });
        fireEvent.click(screen.getByRole('button', { name: en.shamCash.submit }));

        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        expect(submit.mock.calls[0][0]).toMatchObject({
            planId: 'plan-1',
            billingInterval: 'month',
            transferReference: '84719203',
        });
        expect(await screen.findByText(en.shamCash.pendingTitle)).toBeInTheDocument();
    });

    it('tells the merchant a duplicate transfer is ALREADY with us, not that it failed', async () => {
        // The distinction that matters: a generic error invites them to transfer
        // the money a second time.
        submit.mockRejectedValue(httpError(409, 'duplicate_reference'));
        renderPanel();
        await screen.findByText(CONFIG.walletNumber);

        fireEvent.change(screen.getByLabelText(en.shamCash.referenceLabel), { target: { value: '84719203' } });
        fireEvent.click(screen.getByRole('button', { name: en.shamCash.submit }));

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorDuplicate);
    });

    it('shows the under-review state on a revisit instead of asking for payment again', async () => {
        listMine.mockResolvedValue({
            data: { claims: [{ id: 'c1', status: 'pending_review', transferReference: '84719203' }] },
        });
        renderPanel();

        expect(await screen.findByText(en.shamCash.pendingTitle)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: en.shamCash.submit })).not.toBeInTheDocument();
    });
});
