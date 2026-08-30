import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhatsAppNudgeBanner } from '@/components/dashboard/WhatsAppNudgeBanner';
import type { Page } from '@jawab24/shared';

vi.mock('@/components/ui', () => ({
    Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
    WhatsAppIcon: () => <svg data-testid="whatsapp-icon" />,
}));

const connectedPage = { id: 'p1', name: 'Page 1', isConnected: true } as Page;
const whatsappPage = { id: 'p2', name: 'Page 2', isConnected: true, whatsappConnected: true } as Page;
const disconnectedPage = { id: 'p3', name: 'Page 3', isConnected: false } as Page;

describe('WhatsAppNudgeBanner', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', '123');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('renders for an owner with a connected page and no WhatsApp', () => {
        render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} />);
        expect(screen.getByText('Jawab now replies on WhatsApp')).toBeInTheDocument();
        expect(screen.getByText('Connect WhatsApp')).toBeInTheDocument();
    });

    it('hidden when Embedded Signup env config is missing', () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} />);
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
    });

    it('hidden for non-owners', () => {
        render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={false} isAdmin={true} whatsappEntitled={true} />);
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
    });

    it('hidden when a page already has WhatsApp connected', () => {
        render(<WhatsAppNudgeBanner pages={[connectedPage, whatsappPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} />);
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
    });

    it('hidden when the plan does not include WhatsApp (Starter / trial)', () => {
        render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={false} />);
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
    });

    it('hidden for a Zid account that can never connect WhatsApp (D-117)', () => {
        // Mutation: drop `unavailable` from the early-return guard and this shows.
        render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} unavailable={true} />);
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
    });

    it('hidden when there is no connected page', () => {
        render(<WhatsAppNudgeBanner pages={[disconnectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} />);
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
    });

    it('dismiss persists across re-mounts', () => {
        const { unmount } = render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} />);
        fireEvent.click(screen.getByText('Later'));
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
        unmount();

        render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} />);
        expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
    });

    describe('canary (admin-only) mode', () => {
        beforeEach(() => vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY', 'true'));

        it('hidden for a non-admin owner during the canary', () => {
            render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={false} whatsappEntitled={true} />);
            expect(screen.queryByText('Jawab now replies on WhatsApp')).not.toBeInTheDocument();
        });

        it('shown for an admin during the canary', () => {
            render(<WhatsAppNudgeBanner pages={[connectedPage]} isOwner={true} isAdmin={true} whatsappEntitled={true} />);
            expect(screen.getByText('Jawab now replies on WhatsApp')).toBeInTheDocument();
        });
    });
});
