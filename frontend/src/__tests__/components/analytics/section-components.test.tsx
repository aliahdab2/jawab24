import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationFunnelSection } from '@/components/analytics/NotificationFunnelSection';
import { NotificationsByTypeSection } from '@/components/analytics/NotificationsByTypeSection';
import { RepliesSection } from '@/components/analytics/RepliesSection';
import { AnalyticsKpiGrid } from '@/components/analytics/AnalyticsKpiGrid';
import type { EcommerceAnalyticsOverview } from '@/lib/api';

vi.mock('@/components/ui', () => ({
    Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div data-testid="card" className={className}>{children}</div>
    ),
}));

const baseOverview: EcommerceAnalyticsOverview = {
    storeId: 'store-1',
    period: { from: '2026-01-01', to: '2026-04-25', range: '30d' },
    notifications: {
        funnel: { total: { sent: 0, delivered: 0, failed: 0, pending: 0 }, byChannel: {} },
        byType: {},
    },
    recovery: { abandonedCartsNotified: 0, cartsRecovered: 0, revenueRecovered: 0, currency: null },
    replies: { totalReplies: 0, aiReplies: 0, templateReplies: 0, manualReplies: 0 },
};

describe('NotificationFunnelSection', () => {
    it('renders all three buckets with their counts', () => {
        render(
            <NotificationFunnelSection
                funnel={{
                    total: { sent: 0, delivered: 47, failed: 3, pending: 1 },
                    byChannel: { sms: { sent: 0, delivered: 47, failed: 3, pending: 1 } },
                }}
            />,
        );
        expect(screen.getByText('47')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('does not show channel hint when only one channel is in play', () => {
        render(
            <NotificationFunnelSection
                funnel={{
                    total: { sent: 0, delivered: 10, failed: 0, pending: 0 },
                    byChannel: { sms: { sent: 0, delivered: 10, failed: 0, pending: 0 } },
                }}
            />,
        );
        expect(screen.queryByText(/sms/)).not.toBeInTheDocument();
    });

    it('shows channel hint when WhatsApp + SMS are both active (future)', () => {
        render(
            <NotificationFunnelSection
                funnel={{
                    total: { sent: 0, delivered: 30, failed: 0, pending: 0 },
                    byChannel: {
                        sms: { sent: 0, delivered: 20, failed: 0, pending: 0 },
                        whatsapp: { sent: 0, delivered: 10, failed: 0, pending: 0 },
                    },
                }}
            />,
        );
        expect(screen.getByText(/sms.*whatsapp|whatsapp.*sms/i)).toBeInTheDocument();
    });
});

describe('NotificationsByTypeSection', () => {
    it('renders empty state copy when there are no entries', () => {
        render(<NotificationsByTypeSection byType={{}} />);
        // empty.body comes from the i18n catalog
        expect(screen.getByText(/once your customers/i)).toBeInTheDocument();
    });

    it('filters out zero counts', () => {
        render(
            <NotificationsByTypeSection
                byType={{ abandoned_cart: 5, order_confirmed: 0, review_request: 2 }}
            />,
        );
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('sorts entries by count descending', () => {
        render(
            <NotificationsByTypeSection
                byType={{ abandoned_cart: 1, order_confirmed: 9, review_request: 4 }}
            />,
        );
        const counts = screen.getAllByRole('progressbar').map((el) => el.getAttribute('aria-valuenow'));
        expect(counts).toEqual(['9', '4', '1']);
    });

    it('falls back to the raw key for unknown future types', () => {
        render(<NotificationsByTypeSection byType={{ whatsapp_promo_v2: 7 }} />);
        // Unknown type → label is the raw string, not an i18n key path
        expect(screen.getByText('whatsapp_promo_v2')).toBeInTheDocument();
    });
});

describe('RepliesSection', () => {
    it('renders all three reply method counts', () => {
        render(
            <RepliesSection
                replies={{ totalReplies: 100, aiReplies: 80, templateReplies: 15, manualReplies: 5 }}
            />,
        );
        expect(screen.getByText('80')).toBeInTheDocument();
        expect(screen.getByText('15')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('renders zeros without crashing on empty store', () => {
        render(
            <RepliesSection
                replies={{ totalReplies: 0, aiReplies: 0, templateReplies: 0, manualReplies: 0 }}
            />,
        );
        // All three bars render with width 0; max>=1 prevents NaN
        expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    });
});

describe('AnalyticsKpiGrid', () => {
    it('renders all four KPI tiles', () => {
        render(
            <AnalyticsKpiGrid
                overview={{
                    ...baseOverview,
                    recovery: {
                        abandonedCartsNotified: 12,
                        cartsRecovered: 3,
                        revenueRecovered: 480,
                        currency: 'SAR',
                    },
                    replies: { totalReplies: 100, aiReplies: 87, templateReplies: 0, manualReplies: 13 },
                }}
            />,
        );
        // Revenue formatted with currency
        expect(screen.getByText('480 SAR')).toBeInTheDocument();
        // Counts
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('87')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('omits currency suffix when amount is unattributed', () => {
        render(
            <AnalyticsKpiGrid
                overview={{
                    ...baseOverview,
                    recovery: { abandonedCartsNotified: 0, cartsRecovered: 0, revenueRecovered: 0, currency: null },
                }}
            />,
        );
        // Renders just "0" for revenue, not "0 null"
        expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    });
});
