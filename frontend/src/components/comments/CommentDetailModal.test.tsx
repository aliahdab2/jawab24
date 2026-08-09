import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommentDetailModal } from '@/components/comments/CommentDetailModal';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { Comment } from '@jawab24/shared';
import enMessages from '@/i18n/en/messages.json';

vi.mock('@/lib/openExternalUrl', () => ({
  openExternalUrl: vi.fn()
}));

vi.mock('@/lib/api', () => ({
  commentsApi: {
    reply: vi.fn(),
    resolve: vi.fn()
  },
  messagesApi: {
    getPauseStatus: vi.fn().mockRejectedValue(new Error('not found')),
    pauseConversation: vi.fn().mockResolvedValue({ data: { pausedUntil: '2026-04-01T12:00:00Z' } }),
    resumeConversation: vi.fn().mockResolvedValue({ data: {} }),
  },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ data: { handoffPauseDurationMinutes: 15 } }),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }
}));

const mockComment: Comment = {
  id: 'c1',
  postId: 'p1',
  pageId: 'page1',
  message: 'Hello world',
  createdAt: new Date().toISOString(),
  replied: false,
  fromName: 'Test User',
  replyText: null,
  replyMethod: null,
  detectedLanguage: 'en'
};

describe('CommentDetailModal', () => {
  const renderModal = (override: Partial<React.ComponentProps<typeof CommentDetailModal>> = {}) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <CommentDetailModal
          comment={mockComment}
          onClose={vi.fn()}
          onReplySuccess={vi.fn()}
          {...override}
        />
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Post Reply action', () => {
    const postComment = { ...mockComment, postMessage: 'Our latest post' };

    it('renders the Set up Post Reply action and calls onSetupPostReply when clicked', () => {
      const onSetupPostReply = vi.fn();
      renderModal({ comment: postComment, onSetupPostReply, postTrigger: null });
      const btn = screen.getByRole('button', { name: /set up post reply/i });
      fireEvent.click(btn);
      expect(onSetupPostReply).toHaveBeenCalledTimes(1);
    });

    it('shows the Edit Post Reply action when the post already has a configured reply', () => {
      renderModal({ comment: postComment, onSetupPostReply: vi.fn(), postTrigger: { keyword: 'register' } });
      expect(screen.getByRole('button', { name: /edit post reply/i })).toBeInTheDocument();
      expect(screen.getByText('register')).toBeInTheDocument();
    });

    it('treats an any-comment rule (keyword null) as configured — Edit action + mode chip', () => {
      renderModal({ comment: postComment, onSetupPostReply: vi.fn(), postTrigger: { keyword: null } });
      expect(screen.getByRole('button', { name: /edit post reply/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /set up post reply/i })).not.toBeInTheDocument();
      // Chips row shows the mode label instead of keywords
      expect(screen.getByText(/any comment/i)).toBeInTheDocument();
    });

    it('does not render the Post Reply action when no handler is provided', () => {
      renderModal({ comment: postComment });
      expect(screen.queryByRole('button', { name: /post reply/i })).not.toBeInTheDocument();
    });
  });

  it('closes on ESC key press', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('shows post context when postMessage is present', () => {
    const commentWithPost: Comment = {
      ...mockComment,
      postMessage: 'Special offer on all courses!',
    };

    renderModal({ comment: commentWithPost });

    expect(screen.getByText('Special offer on all courses!')).toBeInTheDocument();
  });

  it('does not show post context when postMessage is absent', () => {
    renderModal();

    expect(screen.queryByText('Special offer')).not.toBeInTheDocument();
  });

  it('shows resolve button when comment needs attention', () => {
    const attentionComment: Comment = { ...mockComment, needsAttention: true };
    renderModal({ comment: attentionComment, onResolve: vi.fn() });

    expect(screen.getByRole('button', { name: /Resolve/i })).toBeInTheDocument();
  });

  it('calls onResolve and onClose when resolve button is clicked', () => {
    const onResolve = vi.fn();
    const onClose = vi.fn();
    const attentionComment: Comment = { ...mockComment, needsAttention: true };

    renderModal({ comment: attentionComment, onClose, onResolve });

    fireEvent.click(screen.getByRole('button', { name: /Resolve/i }));
    expect(onResolve).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show resolve button for auto-replied comments without attention flag', () => {
    const repliedComment: Comment = {
      ...mockComment,
      replied: true,
      replyText: 'Thanks for reaching out!',
      replyMethod: 'ai',
    };

    renderModal({ comment: repliedComment, onResolve: vi.fn() });

    expect(screen.queryByRole('button', { name: /Resolve/i })).not.toBeInTheDocument();
  });

  // The delivered Post Reply CTA button (flagMeta.reply_cta) renders inside the reply
  // bubble as the customer received it — label linking to the configured URL.
  it('renders the delivered Post Reply CTA button inside the reply bubble', () => {
    const repliedComment: Comment = {
      ...mockComment,
      replied: true,
      replyText: 'تفضل الرابط 👇',
      replyMethod: 'post_reply',
      flagMeta: { reply_cta: { label: 'رابط التسجيل', url: 'https://jawab24.com/login' } },
    };

    renderModal({ comment: repliedComment });

    const cta = screen.getByRole('link', { name: 'رابط التسجيل' });
    expect(cta).toHaveAttribute('href', 'https://jawab24.com/login');
  });

  it('renders no CTA button when the reply has no reply_cta marker', () => {
    const repliedComment: Comment = {
      ...mockComment,
      replied: true,
      replyText: 'تفضل الرابط 👇',
      replyMethod: 'post_reply',
    };

    renderModal({ comment: repliedComment });

    expect(screen.queryByText('رابط التسجيل')).not.toBeInTheDocument();
  });

  it('renders PauseToggle when comment has fromId', () => {
    const commentWithSender: Comment = { ...mockComment, fromId: 'sender123', pageId: 'page1' };
    renderModal({ comment: commentWithSender });

    expect(screen.getByRole('button', { name: new RegExp(enMessages.pauseSmartReply, 'i') })).toBeInTheDocument();
  });

  it('does not render PauseToggle when comment has no fromId', () => {
    const commentWithoutSender: Comment = { ...mockComment, fromId: undefined };
    renderModal({ comment: commentWithoutSender });

    expect(screen.queryByRole('button', { name: new RegExp(enMessages.pauseSmartReply, 'i') })).not.toBeInTheDocument();
  });

  it('shows toast when pause is toggled', async () => {
    const { toast } = await import('sonner');
    const { messagesApi } = await import('@/lib/api');
    const commentWithSender: Comment = { ...mockComment, fromId: 'sender123', pageId: 'page1' };
    renderModal({ comment: commentWithSender });

    const pauseButton = screen.getByRole('button', { name: /Pause Smart Reply/i });
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(messagesApi.pauseConversation).toHaveBeenCalledWith('sender123', 'page1');
      expect(toast.warning).toHaveBeenCalledWith(enMessages.pauseSuccess, { id: 'smart-reply-status' });
    });
  });

  it('shows toast when resume is toggled', async () => {
    const { toast } = await import('sonner');
    const { messagesApi } = await import('@/lib/api');
    vi.mocked(messagesApi.getPauseStatus).mockResolvedValueOnce({ data: { paused: true, pausedUntil: '2026-04-01T12:00:00Z', remainingMinutes: 15 } } as never);
    const commentWithSender: Comment = { ...mockComment, fromId: 'sender123', pageId: 'page1' };
    renderModal({ comment: commentWithSender });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Resume Smart Reply/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Resume Smart Reply/i }));

    await waitFor(() => {
      expect(messagesApi.resumeConversation).toHaveBeenCalledWith('sender123', 'page1');
      expect(toast.success).toHaveBeenCalledWith(enMessages.resumeSuccess, { id: 'smart-reply-status' });
    });
  });

  it('shows comment message in the modal body', () => {
    renderModal();

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('shows commenter name in the header', () => {
    renderModal();

    expect(screen.getAllByText('Test User').length).toBeGreaterThanOrEqual(1);
  });

  describe('held low-confidence reply', () => {
    it('shows held reply banner and pre-fills textarea when aiOriginalReply is present', () => {
      const heldComment: Comment = {
        ...mockComment,
        replied: false,
        aiOriginalReply: 'AI draft: Thanks for your interest!',
        flagReason: 'held_low_confidence',
      };

      renderModal({ comment: heldComment });

      expect(screen.getByText("Jawab suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).toBeInTheDocument();
      const textarea = screen.getByPlaceholderText('Type your reply here...');
      expect(textarea).toHaveValue('AI draft: Thanks for your interest!');
    });

    it('does not show held reply banner for normal unreplied comments', () => {
      renderModal();

      expect(screen.queryByText("Jawab suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });

    it('does not show held reply banner when flagReason is not held_low_confidence', () => {
      const flaggedComment: Comment = {
        ...mockComment,
        replied: false,
        aiOriginalReply: 'Some reply',
        flagReason: 'angry_customer',
      };

      renderModal({ comment: flaggedComment });

      expect(screen.queryByText("Jawab suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });

    it('does not show held reply banner when comment is already replied', () => {
      const repliedComment: Comment = {
        ...mockComment,
        replied: true,
        replyText: 'Sent reply',
        replyMethod: 'ai',
        aiOriginalReply: 'Original draft',
        flagReason: 'held_low_confidence',
      };

      renderModal({ comment: repliedComment });

      expect(screen.queryByText("Jawab suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });
  });

  describe('page name link', () => {
    it('shows clickable page name button when postPermalink is present', () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: 'fb_comment_123' };

      renderModal({ comment, pageName: 'My Page' });

      expect(screen.getByRole('button', { name: /my page/i })).toBeInTheDocument();
    });

    it('opens facebook post URL with comment_id when both postPermalink and facebookCommentId exist', () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: 'fb_comment_123', source: 'facebook' };

      renderModal({ comment, pageName: 'My Page' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://facebook.com/123_456?comment_id=fb_comment_123');
    });

    it('opens facebook post URL without comment_id when facebookCommentId is absent', () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: undefined, source: 'facebook' };

      renderModal({ comment, pageName: 'My Page' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://facebook.com/123_456');
    });

    it('opens instagram permalink directly for instagram comments', () => {
      const comment: Comment = { ...mockComment, postPermalink: 'https://instagram.com/p/ABC123/', facebookCommentId: undefined, source: 'instagram' };

      renderModal({ comment, pageName: 'My Page' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://instagram.com/p/ABC123/');
    });

    it('falls back to pageUrl when postPermalink is absent', () => {
      const comment: Comment = { ...mockComment, postPermalink: undefined, facebookCommentId: undefined, source: 'instagram' };

      renderModal({ comment, pageName: 'My Page', pageUrl: 'https://instagram.com/mypageusername' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://instagram.com/mypageusername');
    });

    it('shows non-clickable page name when no URL available', () => {
      const comment: Comment = { ...mockComment, facebookCommentId: undefined, postPermalink: undefined };

      renderModal({ comment, pageName: 'My Page' });

      expect(screen.getByText('My Page')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /my page/i })).not.toBeInTheDocument();
    });

    it('does not render page name row when pageName is not provided', () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: 'fb_comment_123' };

      renderModal({ comment });

      expect(screen.queryByText('My Page')).not.toBeInTheDocument();
    });
  });

  describe('reply source badge', () => {
    const makeReplied = (replyMethod: Comment['replyMethod']): Comment => ({
      ...mockComment,
      replied: true,
      replyText: 'Sent',
      replyMethod,
    });

    it('shows Smart Reply label for AI replies', () => {
      renderModal({ comment: makeReplied('ai') });
      expect(screen.getByText('Smart Reply')).toBeInTheDocument();
    });

    // Regression: manual replies were labeled "Post Reply" in the detail modal.
    it('shows Manual label for manually-sent replies (not "Post Reply")', () => {
      renderModal({ comment: makeReplied('manual') });
      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });

    it('shows Post Reply label for post_reply replies', () => {
      renderModal({ comment: makeReplied('post_reply') });
      expect(screen.getByText('Post Reply')).toBeInTheDocument();
    });

    it('shows Auto reply label for template (AI fallback) replies', () => {
      renderModal({ comment: makeReplied('template') });
      expect(screen.getByText('Auto reply')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });
  });

  // Keyboard-aware overlay/panel className contract is locked for all four
  // modals in src/components/__tests__/keyboardAwareModalOverlays.test.tsx.
});
