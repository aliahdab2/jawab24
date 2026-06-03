import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TopUpRequestModal } from '@/components/billing/TopUpRequestModal';

const mockGetTopupConfig = vi.fn();
vi.mock('@/lib/api', () => ({
    subscriptionApi: {
        getTopupConfig: () => mockGetTopupConfig(),
    },
}));

// Capture telemetry calls so we can assert on the unavailable-state Sentry event
// without coupling to the real Sentry SDK.
const mockCaptureError = vi.fn();
vi.mock('@/lib/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

// next/link → plain anchor (the modal isn't wrapped in a Next router in tests).
vi.mock('next/link', () => ({
    default: ({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) => (
        <a href={href} onClick={onClick}>{children}</a>
    ),
}));

// Modal mounts inside a portal — these hooks are noisy in jsdom; stub them.
vi.mock('@/hooks/useEscapeKey', () => ({ useEscapeKey: vi.fn() }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: vi.fn() }));
vi.mock('@/hooks/useModalBackHandler', () => ({ useModalBackHandler: vi.fn() }));
vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }));

const VALID_CONFIG = {
    packs: {
        '5k': { repliesAdded: 5000, priceCents: 4900 },
        '10k': { repliesAdded: 10000, priceCents: 7900 },
    },
    currency: 'usd',
    whatsappNumber: '46700224720',
};

function configResponse(overrides: Partial<typeof VALID_CONFIG> = {}) {
    return Promise.resolve({
        data: { success: true, data: { ...VALID_CONFIG, ...overrides } },
    });
}

describe('TopUpRequestModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('loading state', () => {
        it('renders a skeleton while config is in flight', () => {
            // Never resolve so the loading state stays visible.
            mockGetTopupConfig.mockReturnValue(new Promise(() => { /* pending forever */ }));

            const { container } = render(
                <TopUpRequestModal isOpen onClose={vi.fn()} />,
            );

            expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
            expect(screen.queryByText('5,000 replies')).not.toBeInTheDocument();
        });
    });

    describe('available state (happy path)', () => {
        it('renders pack picker, a card link to /checkout, and the WhatsApp link', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse());

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            await waitFor(() => {
                expect(screen.getByText('5,000 replies')).toBeInTheDocument();
            });
            expect(screen.getByText('10,000 replies')).toBeInTheDocument();
            expect(screen.getByText('$49')).toBeInTheDocument();
            expect(screen.getByText('$79')).toBeInTheDocument();
            expect(screen.getByText('Best value')).toBeInTheDocument();

            // Card payment is a link to the shared checkout flow, defaulting to 5k.
            const cardLink = screen.getByRole('link', { name: /pay with card/i });
            expect(cardLink.getAttribute('href')).toBe('/checkout?topup=5k');

            // WhatsApp manual path with the configured number.
            const whatsappLink = screen.getByRole('link', { name: /pay via bank transfer/i });
            expect(whatsappLink.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/46700224720/);

            expect(screen.queryByText(/Top-up options unavailable/i)).not.toBeInTheDocument();
        });

        it('card link reflects the selected pack', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse());

            render(<TopUpRequestModal isOpen onClose={vi.fn()} />);

            await waitFor(() => {
                expect(screen.getByText('10,000 replies')).toBeInTheDocument();
            });

            // Select the 10k pack, then the card link target updates.
            fireEvent.click(screen.getByText('10,000 replies'));
            await waitFor(() => {
                expect(screen.getByRole('link', { name: /pay with card/i }).getAttribute('href')).toBe('/checkout?topup=10k');
            });
        });

        it('prefilled WhatsApp message includes the user email when provided', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse());

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            await waitFor(() => {
                expect(screen.getByText('5,000 replies')).toBeInTheDocument();
            });

            const whatsappLink = screen.getByRole('link', { name: /pay via bank transfer/i });
            const decoded = decodeURIComponent(whatsappLink.getAttribute('href')!);
            expect(decoded).toContain('My email: user@example.com');
        });

        it('omits the email line when userEmail is missing (phone-only user)', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse());

            render(<TopUpRequestModal isOpen onClose={vi.fn()} />);

            await waitFor(() => {
                expect(screen.getByText('5,000 replies')).toBeInTheDocument();
            });

            const whatsappLink = screen.getByRole('link', { name: /pay via bank transfer/i });
            const decoded = decodeURIComponent(whatsappLink.getAttribute('href')!);
            expect(decoded).not.toContain('My email:');
        });
    });

    describe('no WhatsApp number configured', () => {
        it('still shows the pack picker + card link (card is independent of WhatsApp)', async () => {
            // Regression for the previous behavior where an empty whatsappNumber
            // hid the pack picker entirely behind a "coming soon" state — even
            // though card payment is always possible via /checkout.
            mockGetTopupConfig.mockReturnValue(configResponse({ whatsappNumber: '' }));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} />);

            await waitFor(() => {
                expect(screen.getByText('5,000 replies')).toBeInTheDocument();
            });
            expect(screen.getByRole('link', { name: /pay with card/i }).getAttribute('href')).toBe('/checkout?topup=5k');

            // No WhatsApp number → no manual path, but the modal is still usable.
            expect(screen.queryByRole('link', { name: /pay via bank transfer/i })).not.toBeInTheDocument();
            expect(screen.queryByText(/Top-up options unavailable/i)).not.toBeInTheDocument();
        });
    });

    describe('unavailable state — config fetch failed', () => {
        it('renders the load-failed fallback with a WhatsApp contact and emits telemetry', async () => {
            mockGetTopupConfig.mockReturnValue(Promise.reject(new Error('network down')));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            await waitFor(() => {
                expect(screen.getByText(/Couldn't load top-up options/i)).toBeInTheDocument();
            });

            // No pack picker; WhatsApp fallback present.
            expect(screen.queryByText('5,000 replies')).not.toBeInTheDocument();
            expect(screen.getByRole('link', { name: /contact us on whatsapp/i })).toBeInTheDocument();

            await waitFor(() => {
                const failedCall = mockCaptureError.mock.calls.find(
                    (c) => (c[0] as Error).message === 'topup_config_load_failed',
                );
                expect(failedCall).toBeDefined();
                expect((failedCall![2] as { tags: { cause: string } }).tags.cause).toBe('load_failed');
            });
        });

        it('WhatsApp fallback includes the user email when provided', async () => {
            mockGetTopupConfig.mockReturnValue(Promise.reject(new Error('network down')));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            await waitFor(() => {
                expect(screen.getByText(/Couldn't load top-up options/i)).toBeInTheDocument();
            });

            const whatsappLink = screen.getByRole('link', { name: /contact us on whatsapp/i });
            const decoded = decodeURIComponent(whatsappLink.getAttribute('href')!);
            expect(decoded).toContain('My email: user@example.com');
        });
    });
});
