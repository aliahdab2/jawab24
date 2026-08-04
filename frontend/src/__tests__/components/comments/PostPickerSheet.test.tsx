import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PublishedPost } from '@jawab24/shared';

vi.mock('@/lib/api', () => ({
    postsApi: { getPublishedPosts: vi.fn() },
}));

vi.mock('@/components/ui', () => ({
    Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: ReactNode }) =>
        isOpen ? <div><h2>{title}</h2>{children}</div> : null,
    Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
        <button onClick={onClick}>{children}</button>
    ),
    Select: () => null,
    FacebookIcon: () => <svg />,
    InstagramIcon: () => <svg />,
}));

import { PostPickerSheet } from '@/components/comments/PostPickerSheet';
import { postsApi } from '@/lib/api';

const getPublishedPostsMock = vi.mocked(postsApi.getPublishedPosts);

/** A connected, auto-reply-on Facebook page — the minimum the picker needs to query. */
const page = {
    id: 'page-1',
    name: 'Test Page',
    facebookPageId: 'fb1',
    instagramAccountId: null,
    autoReplyEnabled: true,
} as unknown as Parameters<typeof PostPickerSheet>[0]['pages'][number];

function post(overrides: Partial<PublishedPost>): PublishedPost {
    return {
        platformPostId: 'fb_1',
        source: 'facebook',
        message: 'A post',
        imageUrl: null,
        createdTime: null,
        commentsCount: null,
        hasTrigger: false,
        ...overrides,
    };
}

function renderPicker(body: { posts: PublishedPost[]; nextCursor: string | null; partial?: boolean }) {
    getPublishedPostsMock.mockResolvedValue({ data: body } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
    return render(
        <QueryClientProvider client={client}>
            <PostPickerSheet pages={[page]} isOpen onClose={() => {}} onPick={() => {}} />
        </QueryClientProvider>,
    );
}

describe('PostPickerSheet — scheduled posts', () => {
    beforeEach(() => vi.clearAllMocks());

    it('opts into the scheduled edge (older shipped app bundles must not)', async () => {
        renderPicker({ posts: [], nextCursor: null });
        await screen.findByText('No recent posts on this page.');
        expect(getPublishedPostsMock).toHaveBeenCalledWith(
            'page-1',
            expect.objectContaining({ includeScheduled: true }),
        );
    });

    it('shows when a pending post goes live instead of a publish date or comment count', async () => {
        renderPicker({
            posts: [post({
                platformPostId: 'fb_pending',
                message: 'Launch day',
                isScheduled: true,
                scheduledPublishTime: '2026-08-20T09:00:00.000Z',
            })],
            nextCursor: null,
        });

        expect(await screen.findByText(/Scheduled for/)).toBeInTheDocument();
        // A pending post has no comments, so the count must not render as "0 comments".
        expect(screen.queryByText(/^\d+ comments?$/)).toBeNull();
    });

    it('marks a pending post as not-live even when Graph reported no publish time', async () => {
        // Keying off the timestamp instead of the edge would render this as a published
        // post with no date — indistinguishable from a live one.
        renderPicker({
            posts: [post({ platformPostId: 'fb_no_time', isScheduled: true, scheduledPublishTime: null })],
            nextCursor: null,
        });

        expect(await screen.findByText('Not published yet')).toBeInTheDocument();
    });

    it('says the list is incomplete when the server reports it partial', async () => {
        // Otherwise a failed Graph read is indistinguishable from "this page has no posts".
        renderPicker({ posts: [], nextCursor: null, partial: true });

        expect(await screen.findByText(/Some posts couldn't be loaded/)).toBeInTheDocument();
    });

    it('renders a published post with its date and comment count, and no scheduled badge', async () => {
        renderPicker({
            posts: [post({
                platformPostId: 'fb_live',
                createdTime: '2026-07-01T09:00:00.000Z',
                commentsCount: 3,
                isScheduled: false,
            })],
            nextCursor: null,
        });

        expect(await screen.findByText('3 comments')).toBeInTheDocument();
        expect(screen.queryByText(/Scheduled for/)).toBeNull();
        expect(screen.queryByText('Not published yet')).toBeNull();
    });
});
