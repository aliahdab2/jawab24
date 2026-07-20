import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    // Minimal controllable stand-in: comma-splits the typed value into chips on change,
    // so a test can drive value → onChange without the real chip UI.
    KeywordChipInput: ({ id, value, onChange }: { id?: string; value?: string[]; onChange?: (v: string[]) => void }) => (
        <input
            id={id}
            value={(value ?? []).join(', ')}
            onChange={(e) => onChange?.(e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : [])}
        />
    ),
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
    Toggle: ({ enabled, onChange, 'aria-label': ariaLabel }: { enabled: boolean; onChange: (v: boolean) => void; 'aria-label'?: string }) => (
        <button type="button" role="switch" aria-checked={enabled} aria-label={ariaLabel} onClick={() => onChange(!enabled)} />
    ),
}));

import { PostTriggerModal } from '@/components/comments/PostTriggerModal';
import { settingsApi, postsApi } from '@/lib/api';

const settingsGetMock = vi.mocked(settingsApi.get);
const updateTriggerMock = vi.mocked(postsApi.updateTrigger);

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

    // The image ALWAYS rides an inline card (never hidden). A SHORT caption fits the card in
    // full, so the preview shows the caption itself + the image + a tap-to-full-size hint.
    it('with a short caption + image (DM mode): card shows the full caption, the image, and the tap hint', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private', triggerImagesEnabled: true } });
        renderModal({ triggerReply: 'Here is the schedule', triggerImageUrl: 'https://cdn/x.jpg' });
        // Await a card-specific element so the async outcome card is rendered before asserting.
        // (The caption itself renders in the card, but the text also matches the reply textarea,
        // so the tap hint + image + absence of «Read more» are what uniquely mark the short case.)
        expect(await screen.findByText('The customer can tap the image to open it full-size.')).toBeInTheDocument();
        expect(document.querySelector('img[src="https://cdn/x.jpg"]')).not.toBeNull();
        // No «Read more» button for a short caption.
        expect(screen.queryByText('Read more')).toBeNull();
    });

    // A LONG caption can't fit the card title, so the preview shows a teaser + «Read more»
    // (the postback path) + the in-chat note instead of the tap hint. (That the image reaches the
    // customer only once — never re-sent on tap — is a backend guarantee, tested in webhook.test.ts.)
    it('with a long caption + image (DM mode): card shows a teaser + «Read more» + the in-chat note', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private', triggerImagesEnabled: true } });
        renderModal({ triggerReply: 'A'.repeat(120), triggerImageUrl: 'https://cdn/x.jpg' });
        // «Read more» button appears (card-specific — await it first)...
        expect(await screen.findByText('Read more')).toBeInTheDocument();
        // ...with the in-chat delivery note and the image in the card...
        expect(screen.getByText('After the customer taps «Read more», your full reply arrives in the chat.')).toBeInTheDocument();
        expect(document.querySelector('img[src="https://cdn/x.jpg"]')).not.toBeNull();
        // ...and the short-caption tap hint is NOT shown in this case.
        expect(screen.queryByText('The customer can tap the image to open it full-size.')).toBeNull();
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

// The like-the-comment option is Facebook-only (the Instagram API has no
// like-comment endpoint) — the row is hidden entirely for IG posts.
describe('PostTriggerModal — like the comment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
    });

    it('renders the toggle (off by default) for a facebook post', async () => {
        renderModal({ source: 'facebook' });
        expect(await screen.findByText("Like the customer's comment")).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: "Like the customer's comment" })).toHaveAttribute('aria-checked', 'false');
    });

    it('does not render the toggle for an instagram post', async () => {
        renderModal({ source: 'instagram' });
        await waitFor(() => expect(settingsGetMock).toHaveBeenCalled());
        expect(screen.queryByText("Like the customer's comment")).toBeNull();
    });

    it('hydrates from the saved value', async () => {
        renderModal({ source: 'facebook', likeComment: true });
        expect(await screen.findByRole('switch', { name: "Like the customer's comment" })).toHaveAttribute('aria-checked', 'true');
    });

    it('saving sends the toggled value to the API', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details sent!' });

        fireEvent.click(await screen.findByRole('switch', { name: "Like the customer's comment" }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updateTriggerMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 'post-1', source: 'facebook', triggerKeyword: null, triggerReply: 'Details sent!',
            triggerType: 'all', likeComment: true,
        })));
    });

    it('sends exclude keywords entered by the merchant', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details sent!' });

        await screen.findByText('Exclude keywords (optional)');
        const excludeInput = container.querySelector('#trigger-exclude') as HTMLInputElement;
        fireEvent.change(excludeInput, { target: { value: 'expensive, complaint' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updateTriggerMock).toHaveBeenCalledWith(expect.objectContaining({
            triggerExcludeKeyword: 'expensive, complaint',
        })));
    });

    it('hydrates saved exclude keywords into the field', async () => {
        const { container } = renderModal({ source: 'facebook', triggerExcludeKeyword: 'غالي, expensive' });
        await screen.findByText('Exclude keywords (optional)');
        const excludeInput = container.querySelector('#trigger-exclude') as HTMLInputElement;
        expect(excludeInput.value).toBe('غالي, expensive');
    });
});
