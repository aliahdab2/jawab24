import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plan } from '@jawab24/shared';
// Assert on the JSON value, never a hardcoded string — the copy is product
// terminology and has been reworded once already ("Auto-Reply" → "Smart
// Replies"), which silently broke these assertions.
import enPricing from '@/i18n/en/pricing.json';

// --- Router ---------------------------------------------------------------
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/router', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, asPath: '/pricing/scale', locale: 'en' }),
}));

// next/head renders nothing in the test DOM.
vi.mock('next/head', () => ({ __esModule: true, default: () => null }));

// --- API ------------------------------------------------------------------
const mockChangePlan = vi.fn().mockResolvedValue({ data: {} });
const mockGetUsage = vi.fn();
vi.mock('@/lib/api', () => ({
    subscriptionApi: {
        getUsage: (...a: unknown[]) => mockGetUsage(...a),
        changePlan: (...a: unknown[]) => mockChangePlan(...a),
    },
}));
vi.mock('@/lib/api-utils', () => ({ extractObjectData: (d: unknown) => d }));

// --- Auth / ownership -----------------------------------------------------
const authState = { isAuthenticated: true };
vi.mock('@/lib/store', () => ({ useAuthStore: () => ({ isAuthenticated: authState.isAuthenticated }) }));
vi.mock('@/hooks', () => ({ useOwnerGate: () => false }));

// --- Sanctions / platform -------------------------------------------------
const geo = { sanctioned: false };
// Spread the real module: only the two network-backed checks are stubbed. The
// pure helpers (getCachedGeoCountry / hasLocalPaymentAlternative) stay real, so
// adding an export to geoCheck can't silently blow up a component that uses it.
vi.mock('@/utils/geoCheck', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/geoCheck')>()),
    isUserSanctioned: () => Promise.resolve(geo.sanctioned),
    isUserSanctionedNonBlocking: () => Promise.resolve({ sanctioned: geo.sanctioned, cached: false, timedOut: false }),
}));
// `isIOSNative` is mutable so the Guideline 3.1.1 gate can be exercised. The
// gate itself (useIOSPaymentRedirect) is deliberately NOT mocked — the test
// drives the real production hook through this flag.
const platform = { ios: false };
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false, isIOSNative: () => platform.ios }));
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/webUrl', () => ({ buildWebUrl: (p: string) => p }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

// Render the page body directly (getLayout is applied at the _app level).
vi.mock('@/components/layout/DashboardLayout', () => ({
    DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ScalePage from '@/pages/pricing/scale';

function makeScalePlan(overrides: Partial<Plan> = {}): Plan {
    return {
        id: 'plan-scale-30k',
        name: 'Scale 30K',
        slug: 'scale-30k',
        description: 'High volume',
        price: 19900,
        yearlyPrice: null,
        yearlyAvailable: false,
        currency: 'USD',
        interval: 'month',
        maxPages: 5,
        maxAiRepliesPerMonth: 30000,
        maxProducts: null,
        facebookEnabled: true,
        instagramEnabled: true,
        ecommerceEnabled: true,
        whatsappEnabled: true,
        prioritySupport: true,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isPublic: false,
        isDefault: false,
        sortOrder: 5,
        ...overrides,
    };
}

const proUsage = {
    subscription: { plan: { slug: 'pro', price: 7900 }, hasStripeCustomer: true, status: 'active' },
};

describe('ScalePage (/pricing/scale)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authState.isAuthenticated = true;
        geo.sanctioned = false;
        platform.ios = false;
        mockChangePlan.mockResolvedValue({ data: {} });
        mockGetUsage.mockResolvedValue({ data: proUsage });
    });

    // App Store Guideline 3.1.1 — the rejection that stalled the iOS launch for
    // three months. /pricing has self-gated since May; this page shipped inside
    // the iOS bundle as a reachable static route with no gate at all.
    describe('iOS reader-app gate (Guideline 3.1.1)', () => {
        it('renders no payment surface on iOS and redirects to the dashboard', async () => {
            platform.ios = true;
            render(<ScalePage plans={[makeScalePlan()]} />);

            await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
            expect(screen.queryByRole('button', { name: /upgrade|subscribe|downgrade/i })).not.toBeInTheDocument();
            // No price may render either — the guideline forbids the surface, not just the button.
            expect(screen.queryByText('30,000')).not.toBeInTheDocument();
        });

        it('still renders the plan grid on every non-iOS platform', async () => {
            render(<ScalePage plans={[makeScalePlan()]} />);

            expect(await screen.findByText('30,000')).toBeInTheDocument();
            expect(mockReplace).not.toHaveBeenCalledWith('/dashboard');
        });
    });

    it('upgrades an existing Pro subscriber in place via changePlan (never a second checkout)', async () => {
        render(<ScalePage plans={[makeScalePlan()]} />);

        // Wait for usage to load — the CTA flips from "Subscribe" to "Upgrade".
        const btn = await screen.findByRole('button', { name: /upgrade/i });
        fireEvent.click(btn);

        await waitFor(() => expect(mockChangePlan).toHaveBeenCalledWith('plan-scale-30k', 'month'));
        // In-place upgrade refreshes via replace(), and must NOT route to checkout.
        expect(mockReplace).toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('routes an unauthenticated visitor to login→checkout, not changePlan', async () => {
        authState.isAuthenticated = false;
        render(<ScalePage plans={[makeScalePlan()]} />);

        const btn = await screen.findByRole('button', { name: /subscribe/i });
        fireEvent.click(btn);

        await waitFor(() => expect(mockPush).toHaveBeenCalled());
        const target = mockPush.mock.calls[0][0] as string;
        expect(target).toContain('/login');
        expect(target).toContain('checkout');
        expect(mockChangePlan).not.toHaveBeenCalled();
    });

    it('hides the payment CTA and shows a WhatsApp fallback for sanctioned regions', async () => {
        geo.sanctioned = true;
        render(<ScalePage plans={[makeScalePlan()]} />);

        // Once the geo check resolves, no purchase button is rendered…
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /upgrade|subscribe|downgrade/i })).not.toBeInTheDocument();
        });
        // …and a WhatsApp support link is offered instead.
        const links = screen.getAllByRole('link');
        expect(links.some((l) => l.getAttribute('href')?.includes('wa.me'))).toBe(true);
        expect(mockChangePlan).not.toHaveBeenCalled();
        // The one-time top-up CTA is also withheld from sanctioned regions.
        expect(screen.queryByRole('button', { name: /add replies/i })).not.toBeInTheDocument();
    });

    it('offers a secondary one-time top-up CTA to a signed-in subscriber', async () => {
        render(<ScalePage plans={[makeScalePlan()]} />);
        // Surfaces once usage confirms an active (non-free) subscription.
        expect(await screen.findByRole('button', { name: /add replies/i })).toBeInTheDocument();
    });

    // --- WhatsApp feature line (marketable = env set AND canary off) -----------
    describe('WhatsApp feature line', () => {
        afterEach(() => vi.unstubAllEnvs());

        it('listed once WhatsApp is publicly launched', async () => {
            vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
            vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
            render(<ScalePage plans={[makeScalePlan()]} />);

            await screen.findByText('30,000');
            expect(screen.getByText(enPricing.featureWhatsApp)).toBeInTheDocument();
        });

        it('absent while WhatsApp is dark (no env config)', async () => {
            render(<ScalePage plans={[makeScalePlan()]} />);

            await screen.findByText('30,000');
            expect(screen.queryByText(enPricing.featureWhatsApp)).not.toBeInTheDocument();
        });

        it('absent during the admin-only canary window', async () => {
            vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
            vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
            vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true');
            render(<ScalePage plans={[makeScalePlan()]} />);

            await screen.findByText('30,000');
            expect(screen.queryByText(enPricing.featureWhatsApp)).not.toBeInTheDocument();
        });

        it('absent for a Zid-connected account even after public launch (D-117)', async () => {
            // Regression (2026-09-02): this page gated on the bare global flag,
            // so a Zid merchant — whose account can never use WhatsApp — was
            // shown "WhatsApp Smart Replies" on both Scale cards.
            vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
            vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
            mockGetUsage.mockResolvedValue({
                data: {
                    subscription: {
                        ...proUsage.subscription,
                        whatsappUnavailable: { reason: 'zid_marketplace' },
                    },
                },
            });
            render(<ScalePage plans={[makeScalePlan()]} />);

            // Wait until the usage summary has landed (the CTA flips to
            // "Upgrade") — the row is hidden by the usage read, not the env.
            await screen.findByRole('button', { name: /upgrade/i });
            expect(screen.queryByText(enPricing.featureWhatsApp)).not.toBeInTheDocument();
        });
    });

    // --- Mobile tab selector (shared PlanTabSelector, only with ≥2 plans) -------
    describe('mobile tab selector', () => {
        const twoPlans = [
            makeScalePlan({ id: 'plan-scale-20k', slug: 'scale-20k', name: 'Scale 20K', price: 9900, maxAiRepliesPerMonth: 20000 }),
            makeScalePlan({ id: 'plan-scale-30k', slug: 'scale-30k', name: 'Scale 30K', price: 19900, maxAiRepliesPerMonth: 30000 }),
        ];

        it('renders one tab per plan, defaulting to the first', async () => {
            render(<ScalePage plans={twoPlans} />);

            const tabs = await screen.findAllByRole('tab');
            expect(tabs).toHaveLength(2);
            expect(screen.getByRole('tab', { name: 'Scale 20K' })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: 'Scale 30K' })).toBeInTheDocument();
            expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
            expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
        });

        it('completes the WAI-ARIA tabs pattern (tab id ↔ panel aria-labelledby)', async () => {
            render(<ScalePage plans={twoPlans} />);

            const panels = await screen.findAllByRole('tabpanel');
            expect(panels).toHaveLength(2);
            const firstTab = screen.getByRole('tab', { name: 'Scale 20K' });
            expect(firstTab).toHaveAttribute('id', 'plan-tab-scale-20k');
            expect(firstTab).toHaveAttribute('aria-controls', 'plan-panel-scale-20k');
            expect(panels[0]).toHaveAttribute('id', 'plan-panel-scale-20k');
            expect(panels[0]).toHaveAttribute('aria-labelledby', 'plan-tab-scale-20k');
        });

        it('switches the active tab on click', async () => {
            render(<ScalePage plans={twoPlans} />);

            const secondTab = await screen.findByRole('tab', { name: 'Scale 30K' });
            fireEvent.click(secondTab);

            await waitFor(() => expect(secondTab).toHaveAttribute('aria-selected', 'true'));
            expect(screen.getByRole('tab', { name: 'Scale 20K' })).toHaveAttribute('aria-selected', 'false');
        });

        it('omits the tab bar when only one plan loaded (degraded state)', async () => {
            render(<ScalePage plans={[makeScalePlan()]} />);
            await screen.findByText('30,000');
            expect(screen.queryByRole('tab')).not.toBeInTheDocument();
        });
    });
});
