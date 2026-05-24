import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

            // aria-busy marks the skeleton container
            expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
            // No "Add replies" CTA visible while loading
            expect(screen.queryByText('5,000 replies')).not.toBeInTheDocument();
        });
    });

    describe('available state (happy path)', () => {
        it('renders pack picker and WhatsApp link when config has whatsappNumber', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse());

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            // Both packs render with names + prices from backend config
            await waitFor(() => {
                expect(screen.getByText('5,000 replies')).toBeInTheDocument();
            });
            expect(screen.getByText('10,000 replies')).toBeInTheDocument();
            expect(screen.getByText('$49')).toBeInTheDocument();
            expect(screen.getByText('$79')).toBeInTheDocument();
            expect(screen.getByText('Best value')).toBeInTheDocument();

            // WhatsApp link rendered with the configured number
            const whatsappLink = screen.getByRole('link', { name: /pay via bank transfer/i });
            expect(whatsappLink.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/46700224720/);

            // Should NOT have rendered the unavailable-state title
            // (note: "Pay with card (coming soon)" stub is fine — that's the card row)
            expect(screen.queryByText(/Top-ups coming soon/i)).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: /email support/i })).not.toBeInTheDocument();
        });

        it('prefilled message includes the user email when provided', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse());

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            await waitFor(() => {
                expect(screen.getByText('5,000 replies')).toBeInTheDocument();
            });

            const whatsappLink = screen.getByRole('link', { name: /pay via bank transfer/i });
            const href = whatsappLink.getAttribute('href')!;
            const decoded = decodeURIComponent(href);
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
            // Never leak a dangling "My email: " with nothing after the colon
            expect(decoded).not.toMatch(/My email:\s*(\n|$)/);
            expect(decoded).not.toContain('My email:');
        });
    });

    describe('unavailable state — no purchase channel configured', () => {
        it('renders coming-soon card when whatsappNumber is empty (env not set)', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse({ whatsappNumber: '' }));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            // Title swaps to the unavailable-state title
            await waitFor(() => {
                expect(screen.getByText(/Top-ups coming soon/i)).toBeInTheDocument();
            });

            // CRITICAL regression: pack picker MUST NOT appear when there's no
            // way to buy — that was the mixed-messaging bug we shipped to prod.
            expect(screen.queryByText('5,000 replies')).not.toBeInTheDocument();
            expect(screen.queryByText('10,000 replies')).not.toBeInTheDocument();
            expect(screen.queryByText('Best value')).not.toBeInTheDocument();
            expect(screen.queryByText('$49')).not.toBeInTheDocument();
            expect(screen.queryByText('$79')).not.toBeInTheDocument();

            // Mailto fallback is the actionable next step
            const emailLink = screen.getByRole('link', { name: /email support/i });
            expect(emailLink.getAttribute('href')).toMatch(/^mailto:support@jawab24\.com/);
        });

        it('mailto includes user email in body when provided', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse({ whatsappNumber: '' }));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            await waitFor(() => {
                expect(screen.getByText(/Top-ups coming soon/i)).toBeInTheDocument();
            });

            const emailLink = screen.getByRole('link', { name: /email support/i });
            const decoded = decodeURIComponent(emailLink.getAttribute('href')!);
            expect(decoded).toContain('My email: user@example.com');
        });

        it('mailto omits "My email:" line when userEmail is missing', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse({ whatsappNumber: '' }));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} />);

            await waitFor(() => {
                expect(screen.getByText(/Top-ups coming soon/i)).toBeInTheDocument();
            });

            const emailLink = screen.getByRole('link', { name: /email support/i });
            const decoded = decodeURIComponent(emailLink.getAttribute('href')!);
            expect(decoded).not.toContain('My email:');
        });

        it('emits telemetry for the "no channel" cause', async () => {
            mockGetTopupConfig.mockReturnValue(configResponse({ whatsappNumber: '' }));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} />);

            await waitFor(() => {
                expect(mockCaptureError).toHaveBeenCalled();
            });

            const [err, , context] = mockCaptureError.mock.calls[0];
            expect((err as Error).message).toBe('topup_no_whatsapp_configured');
            expect((context as { tags: { cause: string } }).tags.cause).toBe('no_channel');
        });
    });

    describe('unavailable state — config fetch failed', () => {
        it('renders fallback with load-failed copy and emits telemetry', async () => {
            mockGetTopupConfig.mockReturnValue(Promise.reject(new Error('network down')));

            render(<TopUpRequestModal isOpen onClose={vi.fn()} userEmail="user@example.com" />);

            // Falls back to the unavailable state but with the load-failed message
            await waitFor(() => {
                expect(screen.getByText(/Couldn't load top-up options/i)).toBeInTheDocument();
            });

            // No pack picker, mailto fallback still present
            expect(screen.queryByText('5,000 replies')).not.toBeInTheDocument();
            expect(screen.getByRole('link', { name: /email support/i })).toBeInTheDocument();

            // Telemetry: load_failed cause, not no_channel
            await waitFor(() => {
                const failedCall = mockCaptureError.mock.calls.find(
                    (c) => (c[0] as Error).message === 'topup_config_load_failed',
                );
                expect(failedCall).toBeDefined();
                expect((failedCall![2] as { tags: { cause: string } }).tags.cause).toBe('load_failed');
            });
        });
    });
});
