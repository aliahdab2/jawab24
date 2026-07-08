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
    ConfirmationModal: () => null,
}));

import { PostTriggerModal } from '@/components/comments/PostTriggerModal';
import { settingsApi } from '@/lib/api';

const settingsGetMock = vi.mocked(settingsApi.get);

const DELIVERY_TEXT = {
    public: 'Based on your settings, this reply will be posted as a public comment on the post.',
    private: 'Based on your settings, this reply will be sent to the commenter in a private message.',
    dual: 'Based on your settings, this reply will be sent in a private message, with a short public comment posted on the post.',
};

function renderModal() {
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
            />
        </QueryClientProvider>,
    );
}

// The delivery note tells the merchant where the Post Reply will actually land —
// it follows the workspace-level commentReplyMode, which this modal cannot override.
describe('PostTriggerModal — delivery mode note', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['public', DELIVERY_TEXT.public],
        ['private', DELIVERY_TEXT.private],
        ['dual', DELIVERY_TEXT.dual],
    ])('shows the %s-mode note when settings resolve', async (mode, expected) => {
        settingsGetMock.mockResolvedValue({ data: { commentReplyMode: mode } });
        renderModal();
        expect(await screen.findByText(expected)).toBeInTheDocument();
    });

    it('shows no note while settings are loading', () => {
        settingsGetMock.mockImplementation(() => new Promise(() => {}));
        renderModal();
        expect(screen.queryByText(/Based on your settings/)).toBeNull();
    });

    it('shows no note when the settings fetch fails (never guesses delivery)', async () => {
        settingsGetMock.mockRejectedValue(new Error('network down'));
        renderModal();
        await waitFor(() => expect(settingsGetMock).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/Based on your settings/)).toBeNull();
    });
});
