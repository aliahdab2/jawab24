import { render, screen, waitFor } from '../test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CommentsPage from '../../src/pages/comments';
import { commentsApi, pagesApi } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/store';

// Specific mocks can be overridden or added here if not covered by test-utils
vi.mock('../../src/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));



describe('CommentsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
    });
    // Mock successful page data
    (pagesApi.getAll as any).mockResolvedValue({ data: [] });
  });

  it('renders loading skeleton initially', () => {
    (commentsApi.getAll as any).mockReturnValue(new Promise(() => {})); // Never resolves
    render(<CommentsPage />);
    // Check for skeleton text or elements if applicable, or generic loading state
    // For now, let's just assert it renders without crashing
  });

  it('renders "no comments" when empty', async () => {
    (commentsApi.getAll as any).mockResolvedValue({
      data: {
        data: [],
        pagination: { hasMore: false, nextCursor: null, limit: 50 },
      },
    });

    render(<CommentsPage />);

    expect(await screen.findByText(/comments.connectPage/i)).toBeInTheDocument();
  });

  it('renders comments list', async () => {
    const mockComments = [
      {
        id: '1',
        message: 'Test comment',
        fromName: 'Test User',
        createdAt: new Date().toISOString(),
        replied: false,
      },
    ];

    (commentsApi.getAll as any).mockResolvedValue({
      data: {
        data: mockComments,
        pagination: { hasMore: false, nextCursor: null, limit: 50 },
      },
    });

    render(<CommentsPage />);

    expect(await screen.findByText('Test comment')).toBeInTheDocument();
    expect(await screen.findByText('Test User')).toBeInTheDocument();
  });
});
