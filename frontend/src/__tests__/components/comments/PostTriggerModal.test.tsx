import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { POST_REPLY_BUTTON_TEXT_MAX, POST_REPLY_MAX_REPLY_LEN } from '@jawab24/shared';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
    settingsApi: { get: vi.fn() },
    postsApi: { updateTrigger: vi.fn() },
}));

const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({
    toast: { error: (...args: unknown[]) => toastErrorMock(...args), success: vi.fn() },
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
    Input: ({ label: _label, error: _error, helperText: _helperText, ...props }: { label?: string; error?: string; helperText?: string } & React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
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
    WhatsAppIcon: ({ className }: { className?: string }) => <svg data-testid="whatsapp-icon" className={className} />,
    ConfirmationModal: () => null,
    Toggle: ({ enabled, onChange, 'aria-label': ariaLabel }: { enabled: boolean; onChange: (v: boolean) => void; 'aria-label'?: string }) => (
        <button type="button" role="switch" aria-checked={enabled} aria-label={ariaLabel} onClick={() => onChange(!enabled)} />
    ),
}));

import { PostTriggerModal } from '@/components/comments/PostTriggerModal';
import { settingsApi, postsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

const settingsGetMock = vi.mocked(settingsApi.get);
const updateTriggerMock = vi.mocked(postsApi.updateTrigger);

// The delivery-mode hooks read the shared `/settings` query (useSettingsQuery),
// which is gated on `isAuthenticated` — `/settings` 401s without a session. This
// modal only ever opens from the comments page, behind the dashboard auth guard,
// so authenticated is the state production is in. Set at file level: the per-suite
// `vi.clearAllMocks()` below clears mocks, not zustand state.
beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true });
});

/** Expand the «More options» disclosure — advanced fields (exclude, button, like,
 *  image) are collapsed by default for a NEW trigger; tests driving them must open
 *  the section first, exactly like a merchant would. */
async function openAdvanced() {
    fireEvent.click(await screen.findByRole('button', { name: 'More options' }));
}

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

        await openAdvanced();
        await screen.findByText('Exclude keywords');
        const excludeInput = container.querySelector('#trigger-exclude') as HTMLInputElement;
        fireEvent.change(excludeInput, { target: { value: 'expensive, complaint' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updateTriggerMock).toHaveBeenCalledWith(expect.objectContaining({
            triggerExcludeKeyword: 'expensive, complaint',
        })));
    });

    it('hydrates saved exclude keywords into the field', async () => {
        const { container } = renderModal({ source: 'facebook', triggerExcludeKeyword: 'غالي, expensive' });
        await screen.findByText('Exclude keywords');
        const excludeInput = container.querySelector('#trigger-exclude') as HTMLInputElement;
        expect(excludeInput.value).toBe('غالي, expensive');
    });
});

// The CTA button is Facebook + DM-channel only. The settings mock defaults to
// commentReplyMode 'private' (a DM mode), so the button UI is visible for FB posts.
describe('PostTriggerModal — CTA button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
    });

    it('renders the button fields for a facebook post in a DM mode', async () => {
        renderModal({ source: 'facebook' });
        await openAdvanced();
        expect(await screen.findByText('Add a button')).toBeInTheDocument();
    });

    it('does not render the button fields for an instagram post', async () => {
        renderModal({ source: 'instagram' });
        await openAdvanced();
        await waitFor(() => expect(settingsGetMock).toHaveBeenCalled());
        expect(screen.queryByText('Add a button')).toBeNull();
    });

    it('does not render the button fields in public reply mode', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'public' } });
        renderModal({ source: 'facebook' });
        await openAdvanced();
        await waitFor(() => expect(settingsGetMock).toHaveBeenCalled());
        expect(screen.queryByText('Add a button')).toBeNull();
    });

    it('sends the button label + URL on save', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });

        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.change(container.querySelector('#trigger-button-label') as HTMLInputElement, { target: { value: 'Shop now' } });
        fireEvent.change(container.querySelector('#trigger-button-url') as HTMLInputElement, { target: { value: 'https://shop.example/x' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updateTriggerMock).toHaveBeenCalledWith(expect.objectContaining({
            triggerButtonLabel: 'Shop now', triggerButtonUrl: 'https://shop.example/x',
        })));
    });

    it('blocks save on a half-configured button (label only)', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });

        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.change(container.querySelector('#trigger-button-label') as HTMLInputElement, { target: { value: 'Shop now' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
        expect(updateTriggerMock).not.toHaveBeenCalled();
    });

    it('auto-repairs a bare-domain link (no scheme) instead of rejecting it', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });

        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.change(container.querySelector('#trigger-button-label') as HTMLInputElement, { target: { value: 'Shop now' } });
        fireEvent.change(container.querySelector('#trigger-button-url') as HTMLInputElement, { target: { value: 'mystore.com/offer' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updateTriggerMock).toHaveBeenCalledWith(expect.objectContaining({
            triggerButtonUrl: 'https://mystore.com/offer',
        })));
        expect(toastErrorMock).not.toHaveBeenCalled();
    });

    it('blocks save on an invalid button URL', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });

        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.change(container.querySelector('#trigger-button-label') as HTMLInputElement, { target: { value: 'Shop' } });
        fireEvent.change(container.querySelector('#trigger-button-url') as HTMLInputElement, { target: { value: 'not a url' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
        expect(updateTriggerMock).not.toHaveBeenCalled();
    });

    it('hydrates saved button label + URL', async () => {
        const { container } = renderModal({ source: 'facebook', triggerButtonLabel: 'Buy', triggerButtonUrl: 'https://shop.example' });
        await screen.findByText('Add a button');
        expect((container.querySelector('#trigger-button-label') as HTMLInputElement).value).toBe('Buy');
        expect((container.querySelector('#trigger-button-url') as HTMLInputElement).value).toBe('https://shop.example');
    });

    // Regression: attaching a button (without an image) drops the reply ceiling to the
    // button-template limit the backend enforces, but the textarea kept the higher flat
    // cap — so a merchant could type past the real limit with only the counter to warn them.
    it('caps the reply textarea at the button-template limit once a button is attached', async () => {
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });
        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.change(container.querySelector('#trigger-button-label') as HTMLInputElement, { target: { value: 'Shop now' } });
        fireEvent.change(container.querySelector('#trigger-button-url') as HTMLInputElement, { target: { value: 'https://shop.example/x' } });

        const textarea = container.querySelector('#trigger-reply') as HTMLTextAreaElement;
        expect(textarea.maxLength).toBe(POST_REPLY_BUTTON_TEXT_MAX);
        expect(POST_REPLY_BUTTON_TEXT_MAX).toBeLessThan(POST_REPLY_MAX_REPLY_LEN);
    });

    // Regression: disabling Save on replyOverLimit blocked onClick, making the component's
    // own postTriggerReplyTooLong toast unreachable — Save just did nothing, unexplained.
    // Must stay clickable and toast, like every other check in handleSave.
    it('keeps Save clickable and toasts — never silently disables — when a hydrated reply exceeds the button-template limit', async () => {
        const overLimitReply = 'x'.repeat(POST_REPLY_BUTTON_TEXT_MAX + 1);
        renderModal({
            source: 'facebook',
            triggerType: 'all',
            triggerReply: overLimitReply,
            triggerButtonLabel: 'Buy',
            triggerButtonUrl: 'https://shop.example',
        });
        await screen.findByDisplayValue('Buy');

        const saveButton = screen.getByRole('button', { name: 'Save' });
        expect(saveButton).not.toBeDisabled();

        fireEvent.click(saveButton);
        await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
        expect(updateTriggerMock).not.toHaveBeenCalled();
    });
});

// «More options» disclosure: collapsed for a new trigger so the required path stays
// short; auto-expanded when the stored trigger already uses an advanced field —
// collapsing would hide live configuration.
describe('PostTriggerModal — advanced disclosure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
    });

    it('collapses the power fields for a new trigger, but keeps like + image at top level', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private', triggerImagesEnabled: true } });
        renderModal({ source: 'facebook' });
        expect(await screen.findByRole('button', { name: 'More options' })).toHaveAttribute('aria-expanded', 'false');
        // Power features are tucked away…
        expect(screen.queryByText('Exclude keywords')).toBeNull();
        expect(screen.queryByText('Add a button')).toBeNull();
        // …while the compose-adjacent options stay visible without expanding.
        // (findBy — the image affordance waits on the settings fetch that carries the flag.)
        expect(screen.getByText("Like the customer's comment")).toBeInTheDocument();
        expect(await screen.findByText('Add an image')).toBeInTheDocument();
    });

    it('auto-expands when the trigger already uses an advanced field', async () => {
        renderModal({ source: 'facebook', triggerExcludeKeyword: 'spam' });
        expect(await screen.findByRole('button', { name: 'More options' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Exclude keywords')).toBeInTheDocument();
    });

    // The image affordance lives at the TOP LEVEL (composing the message), gated only
    // by the server capability flag — never hidden behind the disclosure.
    it('shows the add-image affordance without expanding when the feature is enabled', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private', triggerImagesEnabled: true } });
        renderModal({ source: 'facebook' });
        expect(await screen.findByText('Add an image')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'More options' })).toHaveAttribute('aria-expanded', 'false');
    });
});

// WhatsApp button kind: the pair is stored in the SAME columns — the URL is a wa.me
// deep link built from the phone number on save, so the backend and delivery path
// never change (Messenger has no native WhatsApp button; a wa.me web_url is the
// industry mechanism).
describe('PostTriggerModal — WhatsApp button kind', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
    });

    it('switching to WhatsApp prefills the default label and swaps URL → phone input', async () => {
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });
        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
        expect((container.querySelector('#trigger-button-label') as HTMLInputElement).value).toBe('Chat on WhatsApp');
        expect(container.querySelector('#trigger-button-whatsapp')).not.toBeNull();
        expect(container.querySelector('#trigger-button-url')).toBeNull();
    });

    it('switching back to link clears the auto-filled WhatsApp label, but keeps a custom one', async () => {
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });
        await openAdvanced();
        await screen.findByText('Add a button');
        const label = () => container.querySelector('#trigger-button-label') as HTMLInputElement;

        // Auto-fill on switch to WhatsApp → unwound on switch back to link.
        fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
        expect(label().value).toBe('Chat on WhatsApp');
        fireEvent.click(screen.getByRole('radio', { name: 'Link' }));
        expect(label().value).toBe('');

        // A merchant-typed label survives the round-trip in both directions.
        fireEvent.change(label(), { target: { value: 'Order here' } });
        fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
        expect(label().value).toBe('Order here');
        fireEvent.click(screen.getByRole('radio', { name: 'Link' }));
        expect(label().value).toBe('Order here');
    });

    it('saving builds the wa.me URL from the phone number', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });
        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
        fireEvent.change(container.querySelector('#trigger-button-whatsapp') as HTMLInputElement, { target: { value: '+963 944 123 456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(updateTriggerMock).toHaveBeenCalledWith(expect.objectContaining({
            triggerButtonLabel: 'Chat on WhatsApp', triggerButtonUrl: 'https://wa.me/963944123456',
        })));
    });

    it('blocks save on a local-format number (no country code)', async () => {
        updateTriggerMock.mockResolvedValue({ data: { success: true } } as never);
        const { container } = renderModal({ source: 'facebook', triggerType: 'all', triggerReply: 'Details!' });
        await openAdvanced();
        await screen.findByText('Add a button');
        fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
        fireEvent.change(container.querySelector('#trigger-button-whatsapp') as HTMLInputElement, { target: { value: '0944123456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
        expect(updateTriggerMock).not.toHaveBeenCalled();
    });

    // The outcome card mirrors the FULL delivery — including the button, in both
    // its positions: under the text bubble (button template) and on the image card.
    it('previews the button on the private outcome row (text + button case)', async () => {
        renderModal({ source: 'facebook', triggerButtonLabel: 'Shop now', triggerButtonUrl: 'https://shop.example' });
        expect(await screen.findByText('What the commenter receives')).toBeInTheDocument();
        // The label renders in the preview (the inputs hold it as value, not text).
        expect(screen.getByText('Shop now')).toBeInTheDocument();
        // Link kind → no WhatsApp glyph.
        expect(screen.queryByTestId('whatsapp-icon')).toBeNull();
    });

    it('previews the WhatsApp button with its glyph on the image card (image + button case)', async () => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private', triggerImagesEnabled: true } });
        renderModal({
            source: 'facebook',
            triggerReply: 'Short caption',
            triggerImageUrl: 'https://cdn/x.jpg',
            triggerButtonLabel: 'Chat on WhatsApp',
            triggerButtonUrl: 'https://wa.me/963944123456',
        });
        // Card renders (image present) with the button label + WhatsApp glyph on it.
        expect(await screen.findByText('The customer can tap the image to open it full-size.')).toBeInTheDocument();
        expect(screen.getByText('Chat on WhatsApp')).toBeInTheDocument();
        expect(screen.getByTestId('whatsapp-icon')).toBeInTheDocument();
    });

    it('reopens a stored wa.me button in WhatsApp mode with the number (auto-expanded)', async () => {
        const { container } = renderModal({ source: 'facebook', triggerButtonLabel: 'Chat on WhatsApp', triggerButtonUrl: 'https://wa.me/963944123456' });
        await screen.findByText('Add a button');
        expect(screen.getByRole('radio', { name: 'WhatsApp' })).toHaveAttribute('aria-checked', 'true');
        expect((container.querySelector('#trigger-button-whatsapp') as HTMLInputElement).value).toBe('+963944123456');
        expect(container.querySelector('#trigger-button-url')).toBeNull();
    });
});

// Arming a Post Reply on a post Facebook hasn't published yet is a supported flow: the
// trigger is saved now and starts working at publish. The modal must SAY that, or "saved"
// reads as "already replying" and the merchant thinks the feature is broken when the
// (unpublished) post gets no comments.
describe('PostTriggerModal — scheduled post notice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: 'private' } });
    });

    it('explains that the reply waits for the post to go live', async () => {
        renderModal({ isScheduled: true, scheduledPublishTime: '2026-08-20T09:00:00.000Z' });
        expect(await screen.findByText(/starts working the moment the post is published/)).toBeInTheDocument();
    });

    it('still explains it when Graph gave no publish time', async () => {
        // Keying the notice off the timestamp would silently drop it here, and the merchant
        // would read "saved" as "already replying" on a post that is not even live.
        renderModal({ isScheduled: true, scheduledPublishTime: null });
        expect(await screen.findByText(/starts working the moment the post is published/)).toBeInTheDocument();
    });

    it('shows no notice for an already-published post', async () => {
        renderModal({ isScheduled: false, scheduledPublishTime: null });
        // Wait for the body to settle so this isn't a vacuous pass on an empty render.
        expect(await screen.findByText('What the commenter receives')).toBeInTheDocument();
        expect(screen.queryByText(/starts working the moment the post is published/)).toBeNull();
    });
});
