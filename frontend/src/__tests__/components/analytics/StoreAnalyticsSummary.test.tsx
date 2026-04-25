import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { StoreAnalyticsSummary } from '@/components/analytics/StoreAnalyticsSummary';
import { ecommerceAnalyticsApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({
    ecommerceAnalyticsApi: {
        getOverview: vi.fn(),
    },
}));

vi.mock('@/lib/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

vi.mock('next/link', () => ({
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
        <a href={href} className={className}>
            {children}
        </a>
    ),
}));

function renderWithQuery(ui: ReactNode) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const apiMock = vi.mocked(ecommerceAnalyticsApi.getOverview);

const overviewWith = (overrides: {
    cartsRecovered?: number;
    revenueRecovered?: number;
    currency?: string | null;
    aiReplies?: number;
}) => ({
    data: {
        storeId: 'store-1',
        period: { from: '2026-01-01', to: '2026-04-25', range: '30d' as const },
        notifications: {
            funnel: { total: { sent: 0, delivered: 0, failed: 0, pending: 0 }, byChannel: {} },
            byType: {},
        },
        recovery: {
            abandonedCartsNotified: overrides.cartsRecovered ? overrides.cartsRecovered + 5 : 0,
            cartsRecovered: overrides.cartsRecovered ?? 0,
            revenueRecovered: overrides.revenueRecovered ?? 0,
            currency: overrides.currency ?? null,
        },
        replies: {
            totalReplies: overrides.aiReplies ?? 0,
            aiReplies: overrides.aiReplies ?? 0,
            templateReplies: 0,
            manualReplies: 0,
        },
    },
});

describe('StoreAnalyticsSummary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing while the request is loading', () => {
        apiMock.mockImplementation(() => new Promise(() => {}));
        const { container } = renderWithQuery(<StoreAnalyticsSummary storeId="store-1" />);
        expect(container.textContent).toBe('');
    });

    it('renders nothing on an empty store (no recovered carts, no AI replies)', async () => {
        apiMock.mockResolvedValueOnce(overviewWith({}) as never);
        const { container } = renderWithQuery(<StoreAnalyticsSummary storeId="store-1" />);
        await waitFor(() => expect(apiMock).toHaveBeenCalled());
        expect(container.textContent).toBe('');
    });

    it('renders the recovery summary with revenue when present', async () => {
        apiMock.mockResolvedValueOnce(
            overviewWith({ cartsRecovered: 4, revenueRecovered: 480, currency: 'SAR' }) as never,
        );
        renderWithQuery(<StoreAnalyticsSummary storeId="store-1" />);
        await waitFor(() => expect(screen.getByRole('link')).toBeInTheDocument());
        expect(screen.getByText(/4 carts recovered/i)).toBeInTheDocument();
        expect(screen.getByText(/480.*SAR/)).toBeInTheDocument();
    });

    it('renders cart count without revenue when revenue is unknown', async () => {
        apiMock.mockResolvedValueOnce(overviewWith({ cartsRecovered: 2 }) as never);
        renderWithQuery(<StoreAnalyticsSummary storeId="store-1" />);
        await waitFor(() => expect(screen.getByText(/2 carts recovered/i)).toBeInTheDocument());
        expect(screen.queryByText(/SAR|USD/)).not.toBeInTheDocument();
    });

    it('renders the AI reply count alone when there is no recovery data', async () => {
        apiMock.mockResolvedValueOnce(overviewWith({ aiReplies: 142 }) as never);
        renderWithQuery(<StoreAnalyticsSummary storeId="store-1" />);
        await waitFor(() => expect(screen.getByText('142')).toBeInTheDocument());
        expect(screen.queryByText(/recovered/i)).not.toBeInTheDocument();
    });

    it('falls back to a "View details" link on error so the page stays discoverable', async () => {
        apiMock.mockRejectedValueOnce(new Error('boom'));
        renderWithQuery(<StoreAnalyticsSummary storeId="store-1" />);
        await waitFor(() =>
            expect(screen.getByRole('link', { name: /view details/i })).toHaveAttribute(
                'href',
                '/ecommerce-analytics',
            ),
        );
        // No numbers shown when the data didn't load
        expect(screen.queryByText(/recovered/i)).not.toBeInTheDocument();
    });
});
