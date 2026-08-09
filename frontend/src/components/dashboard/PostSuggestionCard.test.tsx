import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Page } from '@jawab24/shared';
import { PostSuggestionCard } from './PostSuggestionCard';

const { mockGetToday, mockIsVisible, mockRole } = vi.hoisted(() => ({
  mockGetToday: vi.fn(),
  mockIsVisible: vi.fn(),
  mockRole: { isAdmin: true },
}));

vi.mock('@/lib/api', () => ({
  postSuggestionsApi: { getToday: mockGetToday, generate: vi.fn(), markEvent: vi.fn() },
}));
vi.mock('@/lib/featureFlags', () => ({ isPostSuggestionsVisible: mockIsVisible }));
vi.mock('@/hooks/useWorkspaceRole', () => ({ useWorkspaceRole: () => mockRole }));
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: (s: { activeWorkspaceId: string }) => unknown) =>
    selector({ activeWorkspaceId: 'ws1' }),
}));

const PAGES = [{ id: 'p1', name: 'My Page', isConnected: true } as Page];

function renderCard(pages: Page[] = PAGES) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PostSuggestionCard pages={pages} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.isAdmin = true;
  mockIsVisible.mockReturnValue(true);
  mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: 3 } });
});

describe('PostSuggestionCard — pilot self-gating', () => {
  it('renders nothing when the workspace is not allowlisted', () => {
    mockIsVisible.mockReturnValue(false);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(mockGetToday).not.toHaveBeenCalled();
  });

  it('renders nothing when the allowlisted page is DISCONNECTED (owner rule: connected only)', () => {
    const { container } = renderCard([{ id: 'p1', name: 'My Page', isConnected: false } as Page]);
    expect(container).toBeEmptyDOMElement();
    expect(mockGetToday).not.toHaveBeenCalled();
  });

  it('shows the page switcher only when MULTIPLE connected pages exist, and switches', async () => {
    renderCard([
      { id: 'p1', name: 'متجر العطور', isConnected: true } as Page,
      { id: 'p2', name: 'مطعم الشام', isConnected: true } as Page,
      { id: 'p3', name: 'صفحة مفصولة', isConnected: false } as Page,
    ]);
    expect(await screen.findByRole('tab', { name: 'متجر العطور' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'مطعم الشام' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'صفحة مفصولة' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'مطعم الشام' }));
    await waitFor(() => expect(mockGetToday).toHaveBeenCalledWith('p2'));
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
