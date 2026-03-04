import { render, screen, waitFor } from '../test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MessagesPage from '../../src/pages/messages';
import { messagesApi, pagesApi } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/store';

// Specific mocks can be overridden or added here if not covered by test-utils
vi.mock('../../src/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));



describe('MessagesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
    });
  });

  it('default filter (needs_action) uses actionRequired param', async () => {
    (messagesApi.getStats as any).mockResolvedValue({ data: { total: 5, replied: 2, pending: 2, actionRequired: 3 } });
    (messagesApi.getAll as any).mockResolvedValue({
      data: {
        data: [],
        pagination: { hasMore: false, nextCursor: null, limit: 50 },
      },
    });
    (pagesApi.getAll as any).mockResolvedValue({ data: [] });

    render(<MessagesPage />);

    await vi.waitFor(() => {
      expect(messagesApi.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ actionRequired: true }),
      );
    });
  });

  it('renders "no messages" when empty', async () => {
    // Mock fetchStats
    (messagesApi.getStats as any).mockResolvedValue({ data: { total: 0, replied: 0, pending: 0 } });
    
    // Mock getAll (Infinite Query)
    (messagesApi.getAll as any).mockResolvedValue({ 
       data: {
         data: [],
         pagination: { hasMore: false, nextCursor: null, limit: 50 }
       }
    });
    (pagesApi.getAll as any).mockResolvedValue({ data: [] });

    render(<MessagesPage />);

    await waitFor(() => {
      expect(screen.getByText('messages.emptyNeedsAction')).toBeInTheDocument();
    });
  });

  it('renders messages list', async () => {

    const mockMessages = [
      {
        id: '1',
        message: 'Hello world',
        senderId: 'user1',
        senderName: 'User One',
        direction: 'incoming',
        createdAt: new Date().toISOString(),
        replied: false,
      },
    ];

    (messagesApi.getStats as any).mockResolvedValue({ data: { total: 1, replied: 0, pending: 1 } });
    
    (messagesApi.getAll as any).mockResolvedValue({ 
       data: {
         data: mockMessages,
         pagination: { hasMore: false, nextCursor: null, limit: 50 }
       }
    });
    (pagesApi.getAll as any).mockResolvedValue({ data: [] });

    render(<MessagesPage />);

    expect(await screen.findByText('Hello world')).toBeInTheDocument();
    expect(await screen.findByText('User One')).toBeInTheDocument();
  });
});
