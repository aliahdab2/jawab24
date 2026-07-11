import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
    settingsApi: { get: vi.fn() },
    postsApi: { updateTrigger: vi.fn() },
}));

vi.mock('@/hooks/useSaveHandler', () => ({
    useSaveHandler: () => ({ handle: vi.fn(), saving: false }),
}));

vi.mock('next/link', () => ({
    default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock('@/components/ui', () => ({
    Modal: ({ isOpen, title, children, footer }: { isOpen: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
        isOpen ? (
            <div>
                <h2>{title}</h2>
                {children}
                {footer}
            </div>
        ) : null,
    Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
    Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
    KeywordChipInput: ({ id }: { id?: string }) => <input id={id} />,
    FormField: ({ label, children }: { label: string; children: ReactNode }) => (
        <div>
            <span>{label}</span>
            {children}
        </div>
    ),
    // Closed popover: renders only the trigger, never its content (matches the real
    // click-to-open behaviour). So the on-demand explanations stay out of the DOM.
    InfoPopover: ({ label }: { label: string }) => <button type="button" aria-label={label} />,
    Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    ConfirmationModal: () => null,
}));

import { PostTriggerModal } from '@/components/comments/PostTriggerModal';
import { settingsApi } from '@/lib/api';

const settingsGetMock = vi.mocked(settingsApi.get);

function renderModal(props: Partial<React.ComponentProps<typeof PostTriggerModal>> = {}) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    return render(
        <QueryClientProvider client={client}>
            <PostTriggerModal
                postId="post-1"
                source="facebook"
                isOpen
                onClose={() => {}}
                onSaved={() => {}}
                {...props}
            />
        </QueryClientProvider>,
    );
}

// The outcome card shows exactly what the commenter receives, per the workspace
// commentReplyMode (which this modal cannot override). It is hidden until the mode
// resolves so a wrong delivery claim is never shown.
describe('PostTriggerModal — outcome card', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('private mode: one private-message row, no public row', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
        renderModal();
        expect(await screen.findByText('What the commenter receives')).toBeInTheDocument();
        expect(screen.getByText('Private message')).toBeInTheDocument();
        expect(screen.queryByText('Public comment')).toBeNull();
    });

    // The verbatim channels (private-only, public-only, and the DM half of dual) must
    // NOT echo the reply text — the reply field above is already the preview. They show
    // a caption instead, so the same text never appears twice on screen.
    it('verbatim row captions the channel instead of echoing the reply text', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
        renderModal({ triggerReply: 'Unique reply body 12345', triggerType: 'all' });
        expect(await screen.findByText('The exact text you wrote above')).toBeInTheDocument();
        // The reply body appears exactly once — in the textarea above — never echoed a
        // second time in the outcome card. A reintroduced echo would make this 2.
        expect(screen.getAllByText('Unique reply body 12345')).toHaveLength(1);
    });

    it('public mode: one public-comment row, no private row', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'public' } });
        renderModal();
        expect(await screen.findByText('What the commenter receives')).toBeInTheDocument();
        expect(screen.getByText('Public comment')).toBeInTheDocument();
        expect(screen.queryByText('Private message')).toBeNull();
    });

    it('dual mode: reply as DM + a separate static public comment linking to Settings', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'dual', dualReplyNudge: '' } });
        renderModal();
        expect(await screen.findByText('What the commenter receives')).toBeInTheDocument();
        // Both channels appear...
        expect(screen.getByText('Private message')).toBeInTheDocument();
        expect(screen.getByText('Public comment')).toBeInTheDocument();
        // ...the private (verbatim) row is captioned, not echoed...
        expect(screen.getByText('The exact text you wrote above')).toBeInTheDocument();
        // ...the public one is the static default (merchant hasn't customised it)...
        expect(screen.getByText('Details sent via private message 📩')).toBeInTheDocument();
        // ...and it deep-links to the exact comment-reply field in Settings.
        const link = screen.getByRole('link', { name: /Change in Settings/i });
        expect(link).toHaveAttribute('href', '/settings#comment-reply-mode-label');
    });

    it('dual mode: shows the merchant\'s custom static comment for the viewer\'s UI locale', async () => {
        // Test locale is 'en' (test/setup mocks useLocale), so the preview reads the
        // 'en' entry — never a different-language variant leaking into this UI.
        settingsGetMock.mockResolvedValue({
            data: {
                commentReplyMode: 'dual',
                dualReplyNudgeMulti: { en: 'We messaged you the details', ar: 'راسلناك بالتفاصيل', sourceLang: 'ar' },
            },
        });
        renderModal();
        expect(await screen.findByText('We messaged you the details')).toBeInTheDocument();
        expect(screen.queryByText('راسلناك بالتفاصيل')).toBeNull();
        expect(screen.queryByText('Details sent via private message 📩')).toBeNull();
    });

    it('shows no outcome card while settings are loading', () => {
        settingsGetMock.mockImplementation(() => new Promise(() => {}));
        renderModal();
        expect(screen.queryByText('What the commenter receives')).toBeNull();
    });

    it('shows no outcome card when the settings fetch fails (never guesses delivery)', async () => {
        settingsGetMock.mockRejectedValue(new Error('network down'));
        renderModal();
        await waitFor(() => expect(settingsGetMock).toHaveBeenCalled());
        expect(screen.queryByText('What the commenter receives')).toBeNull();
    });
});
