import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PartnerManagerModal } from './PartnerManagerModal';
import type { AdminCustomer, AdminPartner } from '@/lib/api';

// Keys pass through, so assertions name the string the operator actually reads.
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

const listPartners = vi.fn();
const listUsers = vi.fn();
const updatePartner = vi.fn();

vi.mock('@/lib/api', () => ({
    adminApi: {
        listPartners: (...a: unknown[]) => listPartners(...a),
        listUsers: (...a: unknown[]) => listUsers(...a),
        updatePartner: (...a: unknown[]) => updatePartner(...a),
        createPartner: vi.fn(),
    },
}));

function partner(overrides: Partial<AdminPartner> = {}): AdminPartner {
    return {
        id: 'p1',
        name: 'Ahmad Tabbaa',
        email: 'ahmad.h.tabbaa@gmail.com',
        // A phone IS on file — and it is exactly the case the old
        // `!linked && !phone` predicate hid the warning from.
        phone: '+963933313187',
        commissionPct: 20,
        isActive: true,
        linked: false,
        merchantCount: 16,
        createdAt: '2026-08-15T00:00:00.000Z',
        ...overrides,
    };
}

function candidate(overrides: Partial<AdminCustomer> = {}): AdminCustomer {
    return {
        id: 'u-fb-signup',
        email: 'ahmad.h.tabbaa@gmail.com',
        name: 'Ahmad Tabbaa',
        phone: null,
        phoneCountry: null,
        facebookId: 'fb-1',
        createdAt: '2026-08-16T06:18:38.000Z',
        partner: null,
        partnerNote: null,
        subscription: null,
        ...overrides,
    };
}

function renderModal() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <PartnerManagerModal isOpen onClose={() => {}} />
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue({ success: true, data: [candidate()], pagination: { page: 1, limit: 8, total: 1, totalPages: 1 } });
    updatePartner.mockResolvedValue({ success: true, data: partner({ linked: true }) });
});

describe('PartnerManagerModal — manual account link', () => {
    it('warns that an unlinked reseller needs linking EVEN WHEN a phone is on file', async () => {
        listPartners.mockResolvedValue({ success: true, data: [partner()] });
        renderModal();

        // The regression: this reseller has a phone, so the old predicate
        // (`!linked && !phone`) suppressed the warning for precisely the rep
        // whose phone can never bind — a Facebook signup, or a country where
        // SMS never lands.
        expect(await screen.findByText('customers.resellerNeedsManualLink')).toBeInTheDocument();
    });

    it('offers the link action on an unlinked reseller and hides it once linked', async () => {
        listPartners.mockResolvedValue({ success: true, data: [partner()] });
        const { unmount } = renderModal();
        expect(await screen.findByRole('button', { name: /customers\.resellerLink$/ })).toBeInTheDocument();
        unmount();

        listPartners.mockResolvedValue({ success: true, data: [partner({ linked: true })] });
        renderModal();
        expect(await screen.findByRole('button', { name: /customers\.resellerUnlink/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /customers\.resellerLink$/ })).not.toBeInTheDocument();
    });

    it('binds the chosen account with updatePartner({ userId })', async () => {
        listPartners.mockResolvedValue({ success: true, data: [partner()] });
        renderModal();

        fireEvent.click(await screen.findByRole('button', { name: /customers\.resellerLink$/ }));

        // Pre-filled with the reseller's own address, so the ordinary case is
        // one click rather than a typed search.
        await waitFor(() => expect(listUsers).toHaveBeenCalledWith({
            search: 'ahmad.h.tabbaa@gmail.com',
            limit: 8,
        }));

        fireEvent.click(await screen.findByRole('button', { name: /Ahmad Tabbaa/ }));

        await waitFor(() => expect(updatePartner).toHaveBeenCalledWith('p1', { userId: 'u-fb-signup' }));
    });

    it('does not search until 2 characters are typed', async () => {
        listPartners.mockResolvedValue({ success: true, data: [partner({ email: null, phone: null, name: 'A' })] });
        renderModal();

        fireEvent.click(await screen.findByRole('button', { name: /customers\.resellerLink$/ }));

        expect(await screen.findByText('customers.resellerLinkMinChars')).toBeInTheDocument();
        await waitFor(() => expect(listUsers).not.toHaveBeenCalled());
    });

    it('reports a link conflict distinctly from an edit-form conflict', async () => {
        listPartners.mockResolvedValue({ success: true, data: [partner()] });
        updatePartner.mockRejectedValue(new Error('409'));
        renderModal();

        fireEvent.click(await screen.findByRole('button', { name: /customers\.resellerLink$/ }));
        fireEvent.click(await screen.findByRole('button', { name: /Ahmad Tabbaa/ }));

        // "That email is already in use" would be a lie here — the address is
        // fine; the ACCOUNT belongs to someone else.
        expect(await screen.findByText('customers.resellerLinkFailed')).toBeInTheDocument();
        expect(screen.queryByText('customers.resellerUpdateFailed')).not.toBeInTheDocument();
    });

    it('reports a failed UNLINK as its own thing, not as a link conflict', async () => {
        // `userId` is three-valued on this endpoint: a string links, null
        // unlinks, undefined leaves the binding alone. Testing it with
        // `!== undefined` lumps the unlink in with the link and tells the
        // operator their own account "belongs to another reseller".
        listPartners.mockResolvedValue({ success: true, data: [partner({ linked: true })] });
        updatePartner.mockRejectedValue(new Error('500'));
        renderModal();

        fireEvent.click(await screen.findByRole('button', { name: /customers\.resellerUnlink/ }));
        fireEvent.click(await screen.findByRole('button', { name: /common\.confirm|confirm/i }));

        expect(await screen.findByText('customers.resellerUnlinkFailed')).toBeInTheDocument();
        expect(screen.queryByText('customers.resellerLinkFailed')).not.toBeInTheDocument();
    });
});
