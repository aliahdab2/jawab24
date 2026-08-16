import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RecordPaymentModal, todayLocalISODate, localDateToISO } from './RecordPaymentModal';

/**
 * The shared record-payment form. Two things are worth pinning here, because
 * both are silent when wrong: the LOCAL-day handling (a UTC slip books a
 * payment on the wrong day for anyone east of Greenwich) and the idempotency
 * key (a double-tapped submit must not become two payments in a money ledger).
 */

vi.mock('@/components/ui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/ui')>();
    return {
        ...actual,
        // Modal portals to document.body; render it inline instead.
        Modal: ({ children, isOpen, title, footer }: {
            children: React.ReactNode; isOpen: boolean; title: string; footer?: React.ReactNode;
        }) => (isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null),
    };
});

describe('local-day helpers', () => {
    it('formats the LOCAL day, not the UTC day', () => {
        // 22:00 on the 16th in a UTC+3 zone is already the 16th locally but
        // 19:00 UTC — same day here. The failure mode this guards is the
        // reverse: `toISOString()` on a late-evening local time rolls forward.
        const at = new Date('2026-08-16T21:30:00');
        expect(todayLocalISODate(at)).toBe('2026-08-16');
    });

    it('anchors a date field at local noon so no timezone shifts the day', () => {
        const iso = localDateToISO('2026-08-16');
        // Noon local can never cross a day boundary in any real offset.
        expect(new Date(iso).getDate()).toBe(16);
    });
});

describe('RecordPaymentModal', () => {
    const baseProps = {
        isOpen: true,
        onClose: vi.fn(),
        merchantName: 'حلويات قصر الشام',
        onRecorded: vi.fn(),
        onSubmit: vi.fn().mockResolvedValue({ success: true }),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        baseProps.onSubmit.mockResolvedValue({ success: true });
    });

    /** The submit button, found by its accessible role rather than its text so
     *  the test does not hardcode a translated string (Rule 10.6). */
    const submitButton = () => screen.getAllByRole('button').at(-1)!;

    it('cannot submit with no amount', () => {
        render(<RecordPaymentModal {...baseProps} />);
        expect(submitButton()).toBeDisabled();
    });

    it('sends the amount in CENTS, not dollars', async () => {
        render(<RecordPaymentModal {...baseProps} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '790' } });
        fireEvent.click(submitButton());

        await waitFor(() => expect(baseProps.onSubmit).toHaveBeenCalled());
        expect(baseProps.onSubmit.mock.calls[0][0]).toMatchObject({ amountCents: 79000, method: 'cash' });
    });

    it('rounds a fractional amount to whole cents', async () => {
        render(<RecordPaymentModal {...baseProps} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12.345' } });
        fireEvent.click(submitButton());

        await waitFor(() => expect(baseProps.onSubmit).toHaveBeenCalled());
        // A non-integer cents value would be rejected by the route schema, so
        // the form must not be able to produce one.
        const { amountCents } = baseProps.onSubmit.mock.calls[0][0];
        expect(Number.isInteger(amountCents)).toBe(true);
        expect(amountCents).toBe(1235);
    });

    it('blocks a second submit while the first is still in flight', async () => {
        let resolveSubmit: (value: unknown) => void = () => {};
        baseProps.onSubmit.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));

        render(<RecordPaymentModal {...baseProps} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '790' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(submitButton()).toBeDisabled());
        fireEvent.click(submitButton());

        expect(baseProps.onSubmit).toHaveBeenCalledTimes(1);
        resolveSubmit({ success: true });
    });

    it('RETRIES with the same idempotency key after a failure', async () => {
        // The dangerous case the key exists for: the first attempt may have
        // reached the server and only its RESPONSE was lost. Retrying with a
        // fresh key would book the same cash twice. (A disabled button cannot
        // help here — the form is interactive again by design.)
        baseProps.onSubmit.mockRejectedValueOnce(new Error('network down'));

        render(<RecordPaymentModal {...baseProps} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '790' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

        fireEvent.click(submitButton());
        await waitFor(() => expect(baseProps.onSubmit).toHaveBeenCalledTimes(2));

        const [first, second] = baseProps.onSubmit.mock.calls.map((c) => c[0].idempotencyKey);
        expect(first).toBeTruthy();
        expect(second).toBe(first);
    });

    it('does not send a collector flag unless the admin surface asked for it', async () => {
        render(<RecordPaymentModal {...baseProps} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '790' } });
        fireEvent.click(submitButton());

        await waitFor(() => expect(baseProps.onSubmit).toHaveBeenCalled());
        // On the reseller's own surface the server forces `collectedBy`; sending
        // a flag from here would imply the form can choose it.
        expect(baseProps.onSubmit.mock.calls[0][0]).not.toHaveProperty('collectedByPartner');
    });

    it('reports a failure instead of claiming the payment was saved', async () => {
        baseProps.onSubmit.mockRejectedValue(new Error('network down'));

        render(<RecordPaymentModal {...baseProps} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '790' } });
        fireEvent.click(submitButton());

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(baseProps.onRecorded).not.toHaveBeenCalled();
        expect(baseProps.onClose).not.toHaveBeenCalled();
    });
});
