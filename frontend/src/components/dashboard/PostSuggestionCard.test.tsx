import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Page } from '@jawab24/shared';
import { PostSuggestionCard } from './PostSuggestionCard';

const { mockGetToday, mockGetPageId, mockRole } = vi.hoisted(() => ({
  mockGetToday: vi.fn(),
  mockGetPageId: vi.fn(),
  mockRole: { isAdmin: true },
}));

vi.mock('@/lib/api', () => ({
  postSuggestionsApi: { getToday: mockGetToday, generate: vi.fn(), markEvent: vi.fn() },
}));
vi.mock('@/lib/featureFlags', () => ({ getPostSuggestionsPageId: mockGetPageId }));
vi.mock('@/hooks/useWorkspaceRole', () => ({ useWorkspaceRole: () => mockRole }));

const PAGES = [{ id: 'p1', name: 'My Page' } as Page];

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PostSuggestionCard pages={PAGES} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.isAdmin = true;
  mockGetPageId.mockReturnValue('p1');
  mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: 3 } });
});

describe('PostSuggestionCard — pilot self-gating', () => {
  it('renders nothing when no workspace page is allowlisted', () => {
    mockGetPageId.mockReturnValue(null);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(mockGetToday).not.toHaveBeenCalled();
  });

  it('fails closed when the API 404s (backend gate off / stale build)', async () => {
    mockGetToday.mockRejectedValue({ response: { status: 404 } });
    const { container } = renderCard();
    await waitFor(() => expect(mockGetToday).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the generate CTA to an admin when no post exists yet', async () => {
    renderCard();
    expect(await screen.findByText('Suggest a post')).toBeInTheDocument();
  });

  it('hides entirely from non-admins while no post exists (nothing they can do)', async () => {
    mockRole.isAdmin = false;
    const { container } = renderCard();
    await waitFor(() => expect(mockGetToday).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('switches to the view CTA once today\'s post exists', async () => {
    mockGetToday.mockResolvedValue({
      data: {
        suggestion: {
          id: 's1', text: 'بوست', imageUrl: null, postType: 'general',
          source: 'cron', suggestedFor: '2026-08-09', createdAt: '2026-08-09T08:00:00Z',
        },
        remainingToday: 2,
      },
    });
    renderCard();
    expect(await screen.findByText("View today's post")).toBeInTheDocument();
  });
});
