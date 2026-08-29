/**
 * The Sham Cash review queue.
 *
 * Approving is a GRANT (the server activates the plan in the same
 * transaction), so the card must show the server's answer in place — and a
 * 409 `already_reviewed` is an answer too, carrying the claim's current
 * state, not an error to report. Receipts are fetched as blobs through the
 * API client and shown from object URLs that must be released on unmount.
 *
 * "Captured to Sentry" is asserted on `@sentry/nextjs` itself: the page reports
 * through `captureUnexpectedError`, which calls `captureError` inside its own
 * module, where a mocked export would be invisible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import adminEn from '@/i18n/en/admin.json';

const listOfflinePayments = vi.fn();
const reviewOfflinePayment = vi.fn();
const getOfflinePaymentReceipt = vi.fn();
vi.mock('@/lib/api', () => ({
    adminApi: {
        listOfflinePayments: (...a: unknown[]) => listOfflinePayments(...a),
        reviewOfflinePayment: (...a: unknown[]) => reviewOfflinePayment(...a),
        getOfflinePaymentReceipt: (...a: unknown[]) => getOfflinePaymentReceipt(...a),
    },
}));

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
    captureException: (...args: unknown[]) => captureException(...args),
    addBreadcrumb: vi.fn(),
}));

const toastInfo = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
    toast: {
        info: (...a: unknown[]) => toastInfo(...a),
        error: (...a: unknown[]) => toastError(...a),
        success: (...a: unknown[]) => toastSuccess(...a),
    },
}));

vi.mock('@/components/layout/AdminLayout', () => ({
    AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui', () => ({
    Card: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
    Button: ({ children, onClick, loading, disabled }: any) => (
        <button onClick={onClick} disabled={disabled || loading}>{children}</button>
    ),
}));
vi.mock('@/i18n/getMessages', () => ({ makeGetStaticProps: () => async () => ({ props: {} }) }));

import AdminOfflinePaymentsPage from '@/pages/admin/offline-payments';

const T = adminEn.offlinePayments;

function claim(over: Record<string, unknown> = {}) {
    return {
        id: 'claim-1',
        rail: 'sham_cash',
        planId: 'plan-1',
        planName: 'Business',
        planSlug: 'business',
        billingInterval: 'month',
        amountCents: 3900,
        currency: 'usd',
        transferReference: '84719203',
        senderName: 'Merchant',
        note: null,
        status: 'pending_review',
        hasReceipt: false,
        createdAt: '2026-08-29T10:00:00.000Z',
        reviewedAt: null,
        userId: 'user-1',
        userEmail: 'merchant@example.com',
        userName: 'Merchant One',
        reviewNote: null,
        grantedAt: null,
        grantedSubscriptionId: null,
        ...over,
    };
}

function listResponse(claims: unknown[], nextCursor: string | null = null, total = claims.length) {
    return { data: { claims, nextCursor, total } };
}

function apiError(body: Record<string, unknown>, status?: number) {
    return { isAxiosError: true, response: { status, data: body } };
}

beforeEach(() => {
    vi.clearAllMocks();
    listOfflinePayments.mockResolvedValue(listResponse([claim()]));
    URL.createObjectURL = vi.fn(() => 'blob:receipt-1');
    URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
    cleanup();
    await act(async () => {});
});

describe('AdminOfflinePaymentsPage', () => {
    it('lists pending claims first, shows the count, and calls approve-and-activate what it is', async () => {
        render(<AdminOfflinePaymentsPage />);

        expect(await screen.findByText('Merchant One')).toBeInTheDocument();
        expect(listOfflinePayments).toHaveBeenCalledWith({ status: 'pending_review', cursor: null, limit: 25 });
        expect(screen.getByText(T.showing.replace('{shown}', '1').replace('{total}', '1'))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: T.approveAndActivate })).toBeInTheDocument();
        expect(screen.getByText(T.grantNotice)).toBeInTheDocument();
    });

    it('shows a reference typed in Arabic-Indic digits folded to Latin as well', async () => {
        listOfflinePayments.mockResolvedValue(listResponse([claim({ transferReference: '٨٤٧١٩٢٠٣' })]));
        render(<AdminOfflinePaymentsPage />);

        expect(await screen.findByText('٨٤٧١٩٢٠٣')).toBeInTheDocument();
        expect(screen.getByText('84719203')).toBeInTheDocument();
    });

    it('approving replaces the card in place with the server\'s claim — activated, no more buttons', async () => {
        reviewOfflinePayment.mockResolvedValue({
            data: { success: true, data: claim({ status: 'approved', grantedAt: '2026-08-29T11:00:00.000Z', grantedSubscriptionId: 'sub-1' }) },
        });
        render(<AdminOfflinePaymentsPage />);

        fireEvent.click(await screen.findByRole('button', { name: T.approveAndActivate }));

        await waitFor(() => expect(reviewOfflinePayment).toHaveBeenCalledWith('claim-1', 'approved'));
        // The badge is a <span>; the filter button carries the same word.
        expect(await screen.findByText(T.statusApproved, { selector: 'span' })).toBeInTheDocument();
        expect(screen.getByText(T.activatedOn.replace('{date}', new Date('2026-08-29T11:00:00.000Z').toLocaleDateString('en')))).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: T.approveAndActivate })).not.toBeInTheDocument();
        // No reload: the answer came back with the review.
        expect(listOfflinePayments).toHaveBeenCalledTimes(1);
        expect(toastSuccess).toHaveBeenCalledWith(T.approvedToast);
    });

    it('a 409 already_reviewed replaces the card with the current state and is NOT reported', async () => {
        reviewOfflinePayment.mockRejectedValue(
            apiError({ error: 'Already reviewed', code: 'already_reviewed', data: claim({ status: 'rejected' }) }, 409),
        );
        render(<AdminOfflinePaymentsPage />);

        fireEvent.click(await screen.findByRole('button', { name: T.approveAndActivate }));

        expect(await screen.findByText(T.statusRejected, { selector: 'span' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: T.approveAndActivate })).not.toBeInTheDocument();
        expect(toastInfo).toHaveBeenCalledWith(T.alreadyReviewed);
        expect(captureException).not.toHaveBeenCalled();
    });

    it('a 404 not_found drops the card and is NOT reported', async () => {
        reviewOfflinePayment.mockRejectedValue(apiError({ error: 'Not found', code: 'not_found' }, 404));
        render(<AdminOfflinePaymentsPage />);

        fireEvent.click(await screen.findByRole('button', { name: T.approveAndActivate }));

        await waitFor(() => expect(screen.queryByText('Merchant One')).not.toBeInTheDocument());
        expect(toastError).toHaveBeenCalledWith(T.notFound);
        expect(captureException).not.toHaveBeenCalled();
    });

    it('a failed list load shows an inline error and is reported', async () => {
        listOfflinePayments.mockRejectedValue(apiError({ error: 'db down' }, 500));
        render(<AdminOfflinePaymentsPage />);

        expect(await screen.findByRole('alert')).toHaveTextContent(T.loadError);
        expect(captureException).toHaveBeenCalledTimes(1);
        // One request: the failure must not re-fire the load.
        expect(listOfflinePayments).toHaveBeenCalledTimes(1);
    });

    it('a server-side failure on review IS reported, and the card stays actionable', async () => {
        reviewOfflinePayment.mockRejectedValue(apiError({ error: 'db down' }, 500));
        render(<AdminOfflinePaymentsPage />);

        fireEvent.click(await screen.findByRole('button', { name: T.approveAndActivate }));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith(T.reviewError));
        expect(captureException).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: T.approveAndActivate })).toBeInTheDocument();
    });

    it('fetches a receipt once per click burst, shows it from an object URL, and revokes it on unmount', async () => {
        listOfflinePayments.mockResolvedValue(listResponse([claim({ hasReceipt: true })]));
        let resolveBlob: (v: unknown) => void = () => {};
        getOfflinePaymentReceipt.mockReturnValue(new Promise((r) => { resolveBlob = r; }));
        const { unmount } = render(<AdminOfflinePaymentsPage />);

        const view = await screen.findByRole('button', { name: T.viewReceipt });
        fireEvent.click(view);
        fireEvent.click(view); // double click before the blob arrives

        expect(getOfflinePaymentReceipt).toHaveBeenCalledTimes(1);
        const blob = new Blob(['img'], { type: 'image/png' });
        await act(async () => { resolveBlob({ data: blob }); });

        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
        expect(await screen.findByRole('img', { name: T.receiptAlt })).toHaveAttribute('src', 'blob:receipt-1');

        unmount();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt-1');
    });

    it('loads the next page with the cursor, appends it, and updates the count', async () => {
        listOfflinePayments
            .mockResolvedValueOnce(listResponse([claim()], 'cursor-1', 2))
            .mockResolvedValueOnce(listResponse([claim({ id: 'claim-2', userName: 'Merchant Two' })], null, 2));
        render(<AdminOfflinePaymentsPage />);

        expect(await screen.findByText('Merchant One')).toBeInTheDocument();
        expect(screen.getByText(T.showing.replace('{shown}', '1').replace('{total}', '2'))).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: T.loadMore }));

        expect(await screen.findByText('Merchant Two')).toBeInTheDocument();
        expect(listOfflinePayments).toHaveBeenLastCalledWith({ status: 'pending_review', cursor: 'cursor-1', limit: 25 });
        expect(screen.getByText('Merchant One')).toBeInTheDocument();
        expect(screen.getByText(T.showing.replace('{shown}', '2').replace('{total}', '2'))).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: T.loadMore })).not.toBeInTheDocument();
    });

    it('drops a slow response from a previous filter so it cannot overwrite the current one', async () => {
        let resolvePending: (v: unknown) => void = () => {};
        listOfflinePayments
            .mockReturnValueOnce(new Promise((r) => { resolvePending = r; }))
            .mockResolvedValueOnce(listResponse([claim({ id: 'claim-9', userName: 'Approved Merchant', status: 'approved' })]));
        render(<AdminOfflinePaymentsPage />);

        fireEvent.click(screen.getByRole('button', { name: T.filterApproved }));
        expect(await screen.findByText('Approved Merchant')).toBeInTheDocument();

        // The pending request lands late.
        await act(async () => { resolvePending(listResponse([claim({ userName: 'Stale Pending' })])); });

        expect(screen.getByText('Approved Merchant')).toBeInTheDocument();
        expect(screen.queryByText('Stale Pending')).not.toBeInTheDocument();
    });
});
