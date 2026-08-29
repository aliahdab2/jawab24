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
 *
 * Error fixtures carry a `code` and NO status on purpose: the client must
 * branch on the code alone (the limiter's 429 and the queue's 429 are
 * different answers), so a client that fell back to the status would fail
 * these cases.
 *
 * "Captured to Sentry" is asserted on `@sentry/nextjs` itself rather than on
 * `captureError`: the panel reports through `captureUnexpectedError`, which
 * calls `captureError` inside its own module, and a mocked export is invisible
 * to that internal call.
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

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
    captureException: (...args: unknown[]) => captureException(...args),
    addBreadcrumb: vi.fn(),
}));

import { ShamCashPanel } from '../ShamCashPanel';

const CONFIG = {
    enabled: true as const,
    rail: 'sham_cash' as const,
    walletNumber: '0912345678',
    walletName: 'Jawab24',
    qrImageUrl: null,
    currency: 'usd',
};

const PENDING_CLAIM = { id: 'c1', status: 'pending_review', transferReference: '84719203' };

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

/**
 * An axios-shaped rejection. `status` is OPTIONAL and omitted by every
 * code-driven case below — the panel must not need it.
 */
function apiError(body: Record<string, unknown>, status?: number) {
    return { isAxiosError: true, response: { status, data: body } };
}

async function submitReference(reference = '84719203') {
    await screen.findByText(CONFIG.walletNumber);
    fireEvent.change(screen.getByLabelText(en.shamCash.referenceLabel), { target: { value: reference } });
    fireEvent.click(screen.getByRole('button', { name: en.shamCash.submit }));
}

beforeEach(() => {
    vi.clearAllMocks();
    getConfig.mockResolvedValue({ data: CONFIG });
    listMine.mockResolvedValue({ data: { claims: [] } });
    URL.createObjectURL = vi.fn(() => 'blob:receipt');
    URL.revokeObjectURL = vi.fn();
});

describe('ShamCashPanel', () => {
    it('shows the wallet number and a copy button, not a blocked-region notice', async () => {
        renderPanel();

        expect(await screen.findByText(CONFIG.walletNumber)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: en.shamCash.copy })).toBeInTheDocument();
        expect(screen.queryByText(en.unavailable.title)).not.toBeInTheDocument();
    });

    it('falls back to the payments-unavailable notice when the rail is off, without reporting it', async () => {
        // `{ enabled: false }` is a 200 — the rail is deliberately off (no wallet
        // configured). The merchant still needs somewhere to go, and that is the
        // WhatsApp notice we shipped before this rail. Nothing is wrong, so
        // nothing is reported.
        getConfig.mockResolvedValue({ data: { enabled: false } });
        renderPanel();

        expect(await screen.findByText(en.unavailable.title)).toBeInTheDocument();
        expect(captureException).not.toHaveBeenCalled();
    });

    it('lands on the notice AND reports it once when the config call fails server-side', async () => {
        getConfig.mockRejectedValue(apiError({ error: 'boom' }, 500));
        renderPanel();

        expect(await screen.findByText(en.unavailable.title)).toBeInTheDocument();
        expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('does not report a 401 — an expired session is the page\'s problem, not the panel\'s', async () => {
        getConfig.mockRejectedValue(apiError({ error: 'Unauthorized' }, 401));
        renderPanel();

        expect(await screen.findByText(en.unavailable.title)).toBeInTheDocument();
        expect(captureException).not.toHaveBeenCalled();
    });

    it('shows the notice, never a fresh form, when the pending-claim check fails', async () => {
        // A fresh form reads as "we have nothing from you" and invites a second
        // transfer — the outcome the check exists to prevent. Config succeeded,
        // so a swallowed listMine failure would have rendered the form.
        listMine.mockRejectedValue(apiError({ error: 'gateway' }, 502));
        renderPanel();

        expect(await screen.findByText(en.unavailable.title)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: en.shamCash.submit })).not.toBeInTheDocument();
        expect(screen.queryByText(CONFIG.walletNumber)).not.toBeInTheDocument();
    });

    it('refuses to submit without a transfer reference', async () => {
        renderPanel();
        await screen.findByText(CONFIG.walletNumber);

        fireEvent.click(screen.getByRole('button', { name: en.shamCash.submit }));

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorReferenceRequired);
        expect(submit).not.toHaveBeenCalled();
    });

    it('submits the reference (naming the rail) and then shows the under-review state', async () => {
        submit.mockResolvedValue({ data: { claim: PENDING_CLAIM } });
        renderPanel();

        await submitReference();

        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        expect(submit.mock.calls[0][0]).toMatchObject({
            planId: 'plan-1',
            billingInterval: 'month',
            rail: 'sham_cash',
            transferReference: '84719203',
        });
        expect(await screen.findByText(en.shamCash.pendingTitle)).toBeInTheDocument();
    });

    it('treats a 200 replay (same claim resent) exactly like a fresh 201 — under review', async () => {
        // A retry after a lost response returns the EXISTING claim with a 200.
        // The merchant sees "under review", not an error and not the form.
        submit.mockResolvedValue({ status: 200, data: { claim: PENDING_CLAIM } });
        renderPanel();

        await submitReference();

        expect(await screen.findByText(en.shamCash.pendingTitle)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(captureException).not.toHaveBeenCalled();
    });

    it('tells the merchant a duplicate transfer is ALREADY with us, not that it failed', async () => {
        // The distinction that matters: a generic error invites them to transfer
        // the money a second time.
        submit.mockRejectedValue(apiError({ error: 'Already submitted', code: 'duplicate_reference' }));
        renderPanel();

        await submitReference();

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorDuplicate);
        expect(captureException).not.toHaveBeenCalled();
    });

    it('maps too_many_pending to the pending-claims message', async () => {
        submit.mockRejectedValue(apiError({ error: 'Too many', code: 'too_many_pending' }));
        renderPanel();

        await submitReference();

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorTooManyPending);
    });

    it('tells the merchant to wait on the LIMITER\'s 429, not that they have too many claims', async () => {
        // Same status as too_many_pending, a different answer: the shape is the
        // rate limiter's `{ error: true, message, code }`.
        submit.mockRejectedValue(apiError({ error: true, message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }));
        renderPanel();

        await submitReference();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(en.shamCash.errorRateLimited);
        expect(alert).not.toHaveTextContent(en.shamCash.errorTooManyPending);
        expect(captureException).not.toHaveBeenCalled();
    });

    it('shows the generic message for a schema rejection and does NOT report it', async () => {
        submit.mockRejectedValue(apiError({ error: true, message: 'Validation error', code: 'VALIDATION_ERROR' }));
        renderPanel();

        await submitReference();

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorGeneric);
        expect(captureException).not.toHaveBeenCalled();
    });

    it('reports an unknown server-side failure, once', async () => {
        submit.mockRejectedValue(apiError({ error: 'db down' }, 500));
        renderPanel();

        await submitReference();

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorGeneric);
        expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('accepts a picked image whose type the picker left blank, inferring it from the extension', async () => {
        // Some Android in-app pickers and camera captures report `type: ''`.
        // The server's magic-byte check is the verdict; refusing client-side
        // would turn away the JPG the merchant just photographed.
        renderPanel();
        await screen.findByText(CONFIG.walletNumber);
        const file = new File(['\xFF\xD8\xFF'], 'receipt.JPG', { type: '' });

        fireEvent.change(screen.getByLabelText(en.shamCash.receiptChoose), { target: { files: [file] } });

        expect(await screen.findByRole('button', { name: en.shamCash.receiptRemove })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    });

    it('still refuses a file that is not an image we accept', async () => {
        renderPanel();
        await screen.findByText(CONFIG.walletNumber);
        const file = new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' });

        fireEvent.change(screen.getByLabelText(en.shamCash.receiptChoose), { target: { files: [file] } });

        expect(await screen.findByRole('alert')).toHaveTextContent(en.shamCash.errorImageType);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('shows the under-review state on a revisit instead of asking for payment again', async () => {
        listMine.mockResolvedValue({ data: { claims: [PENDING_CLAIM] } });
        renderPanel();

        expect(await screen.findByText(en.shamCash.pendingTitle)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: en.shamCash.submit })).not.toBeInTheDocument();
    });

    it('shows why the newest claim was refused, with the form still there to send again', async () => {
        listMine.mockResolvedValue({
            data: { claims: [{ id: 'c2', status: 'rejected', transferReference: '11112222' }] },
        });
        renderPanel();

        expect(await screen.findByText(en.shamCash.rejectedTitle)).toBeInTheDocument();
        // Not a dead end: the copy says "send it again", so the form must be on the same screen.
        expect(screen.getByRole('button', { name: en.shamCash.submit })).toBeInTheDocument();
    });

    it('does not resurface an old refusal once a newer claim is pending', async () => {
        listMine.mockResolvedValue({
            data: { claims: [
                { id: 'c3', status: 'pending_review', transferReference: '33334444' },
                { id: 'c2', status: 'rejected', transferReference: '11112222' },
            ] },
        });
        renderPanel();

        expect(await screen.findByText(en.shamCash.pendingTitle)).toBeInTheDocument();
        expect(screen.queryByText(en.shamCash.rejectedTitle)).not.toBeInTheDocument();
    });
});
