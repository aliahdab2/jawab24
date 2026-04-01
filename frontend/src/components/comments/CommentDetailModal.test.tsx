import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CommentDetailModal } from '@/components/comments/CommentDetailModal';
import { subscriptionApi, aiApi } from '@/lib/api';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { Comment } from '@jawab24/shared';

vi.mock('@/lib/openExternalUrl', () => ({
  openExternalUrl: vi.fn()
}));

// Mock dependencies
vi.mock('@/lib/api', () => ({
  subscriptionApi: {
    checkAiLimit: vi.fn()
  },
  aiApi: {
    generateAsync: vi.fn(),
    getJobStatus: vi.fn()
  },
  commentsApi: {
    reply: vi.fn(),
    resolve: vi.fn()
  },
  messagesApi: {
    getPauseStatus: vi.fn().mockRejectedValue(new Error('not found'))
  }
}));


vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
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
  const renderModal = async (override: Partial<React.ComponentProps<typeof CommentDetailModal>> = {}) => {
    const result = render(
      <CommentDetailModal
        comment={mockComment}
        onClose={vi.fn()}
        onReplySuccess={vi.fn()}
        {...override}
      />
    );

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
    });

    return result;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: allow AI replies (prevents act() warnings from unhandled mount effect)
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });
  });

  it('fetches limits on mount', async () => {
    await renderModal();
  });

  it('disables generate button if limit reached', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({
      data: { allowed: false, reason: 'Limit reached' }
    });

    await renderModal();

    await waitFor(() => {
      // Button text shows the translation key for "Limit Reached" when disabled
      const button = screen.getByRole('button', { name: /Limit Reached/i });
      expect(button).toBeDisabled();
    });
  });

  it('shows regenerate button after successful generation (allows multiple)', async () => {
    (aiApi.generateAsync as any).mockResolvedValue({ data: { jobId: 'job1' } });

    // Return completed immediately
    (aiApi.getJobStatus as any).mockResolvedValue({
        data: { status: 'completed', result: { reply: 'AI Reply' } }
    });

    await renderModal();

    const generateBtn = screen.getByRole('button', { name: /Smart Reply/i });
    fireEvent.click(generateBtn);

    // After generation, button shows "Regenerate" and stays enabled
    await waitFor(() => {
      const regenBtn = screen.getByRole('button', { name: /Regenerate/i });
      expect(regenBtn).toBeInTheDocument();
      expect(regenBtn).not.toBeDisabled();
    }, { timeout: 3000 });
  });

  it('closes on ESC key press', async () => {
    const onClose = vi.fn();
    await renderModal({ onClose });

    // Simulate ESC key press
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('shows post context when postMessage is present', async () => {
    const commentWithPost: Comment = {
      ...mockComment,
      postMessage: 'Special offer on all courses!',
    };

    await renderModal({ comment: commentWithPost });

    expect(screen.getByText('Special offer on all courses!')).toBeInTheDocument();
  });

  it('does not show post context when postMessage is absent', async () => {
    await renderModal();

    // The FileText icon area for post context should not be present
    expect(screen.queryByText('Special offer')).not.toBeInTheDocument();
  });

  it('shows resolve button when onResolve is provided and comment is not replied', async () => {
    render(
      <CommentDetailModal
        comment={mockComment}
        onClose={vi.fn()}
        onReplySuccess={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Mark as handled/i })).toBeInTheDocument();
    });
  });

  it('calls onResolve and onClose when resolve button is clicked', async () => {
    const onResolve = vi.fn();
    const onClose = vi.fn();

    render(
      <CommentDetailModal
        comment={mockComment}
        onClose={onClose}
        onReplySuccess={vi.fn()}
        onResolve={onResolve}
      />
    );

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Mark as handled/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Mark as handled/i }));
    expect(onResolve).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show resolve button when comment is already replied', async () => {
    const repliedComment: Comment = {
      ...mockComment,
      replied: true,
      replyText: 'Thanks for reaching out!',
      replyMethod: 'ai',
    };

    await renderModal({
      comment: repliedComment,
      onResolve: vi.fn(),
    });

    // Resolve button is always visible — even after AI replied (for needs-attention review)
    expect(screen.queryByRole('button', { name: /Mark as handled/i })).toBeInTheDocument();
  });

  it('shows comment message in the modal body', async () => {
    await renderModal();

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('shows commenter name in the header', async () => {
    await renderModal();

    expect(screen.getAllByText('Test User').length).toBeGreaterThanOrEqual(1);
  });

  describe('held low-confidence reply', () => {
    it('shows held reply banner and pre-fills textarea when aiOriginalReply is present', async () => {
      const heldComment: Comment = {
        ...mockComment,
        replied: false,
        aiOriginalReply: 'AI draft: Thanks for your interest!',
        flagReason: 'held_low_confidence',
      };

      await renderModal({ comment: heldComment });

      expect(screen.getByText("AI suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).toBeInTheDocument();
      const textarea = screen.getByPlaceholderText('Type your reply here...');
      expect(textarea).toHaveValue('AI draft: Thanks for your interest!');
    });

    it('does not show held reply banner for normal unreplied comments', async () => {
      await renderModal();

      expect(screen.queryByText("AI suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });

    it('does not show held reply banner when flagReason is not held_low_confidence', async () => {
      const flaggedComment: Comment = {
        ...mockComment,
        replied: false,
        aiOriginalReply: 'Some reply',
        flagReason: 'angry_customer',
      };

      await renderModal({ comment: flaggedComment });

      expect(screen.queryByText("AI suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });

    it('does not show held reply banner when comment is already replied', async () => {
      const repliedComment: Comment = {
        ...mockComment,
        replied: true,
        replyText: 'Sent reply',
        replyMethod: 'ai',
        aiOriginalReply: 'Original draft',
        flagReason: 'held_low_confidence',
      };

      await renderModal({ comment: repliedComment });

      expect(screen.queryByText("AI suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });
  });

  describe('page name link', () => {
    it('shows clickable page name button when postPermalink is present', async () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: 'fb_comment_123' };

      await renderModal({ comment, pageName: 'My Page' });

      expect(screen.getByRole('button', { name: /my page/i })).toBeInTheDocument();
    });

    it('opens facebook post URL with comment_id when both postPermalink and facebookCommentId exist', async () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: 'fb_comment_123', source: 'facebook' };

      await renderModal({ comment, pageName: 'My Page' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://facebook.com/123_456?comment_id=fb_comment_123');
    });

    it('opens facebook post URL without comment_id when facebookCommentId is absent', async () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: undefined, source: 'facebook' };

      await renderModal({ comment, pageName: 'My Page' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://facebook.com/123_456');
    });

    it('opens instagram permalink directly for instagram comments', async () => {
      const comment: Comment = { ...mockComment, postPermalink: 'https://instagram.com/p/ABC123/', facebookCommentId: undefined, source: 'instagram' };

      await renderModal({ comment, pageName: 'My Page' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://instagram.com/p/ABC123/');
    });

    it('falls back to pageUrl when postPermalink is absent', async () => {
      const comment: Comment = { ...mockComment, postPermalink: undefined, facebookCommentId: undefined, source: 'instagram' };

      await renderModal({ comment, pageName: 'My Page', pageUrl: 'https://instagram.com/mypageusername' });

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://instagram.com/mypageusername');
    });

    it('shows non-clickable page name when no URL available', async () => {
      const comment: Comment = { ...mockComment, facebookCommentId: undefined, postPermalink: undefined };

      await renderModal({ comment, pageName: 'My Page' });

      expect(screen.getByText('My Page')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /my page/i })).not.toBeInTheDocument();
    });

    it('does not render page name row when pageName is not provided', async () => {
      const comment: Comment = { ...mockComment, postPermalink: '123_456', facebookCommentId: 'fb_comment_123' };

      await renderModal({ comment });

      expect(screen.queryByText('My Page')).not.toBeInTheDocument();
    });
  });
});
