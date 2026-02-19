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

vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
    dateLocale: undefined
  })
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches limits on mount', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });
    
    render(<CommentDetailModal comment={mockComment} onClose={vi.fn()} onReplySuccess={vi.fn()} />);
    
    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
    });
  });

  it('disables generate button if limit reached', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({
      data: { allowed: false, reason: 'Limit reached' }
    });

    render(<CommentDetailModal comment={mockComment} onClose={vi.fn()} onReplySuccess={vi.fn()} />);

    await waitFor(() => {
      // Button text shows the translation key for "Limit Reached" when disabled
      const button = screen.getByRole('button', { name: /pricing\.limitReached/i });
      expect(button).toBeDisabled();
    });
  });

  it('shows regenerate button after successful generation (allows multiple)', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });
    (aiApi.generateAsync as any).mockResolvedValue({ data: { jobId: 'job1' } });

    // Return completed immediately
    (aiApi.getJobStatus as any).mockResolvedValue({
        data: { status: 'completed', result: { reply: 'AI Reply' } }
    });

    render(<CommentDetailModal comment={mockComment} onClose={vi.fn()} onReplySuccess={vi.fn()} />);

    await waitFor(() => expect(subscriptionApi.checkAiLimit).toHaveBeenCalled());

    const generateBtn = screen.getByRole('button', { name: /dashboard.aiReply/i });
    fireEvent.click(generateBtn);

    // After generation, button shows "Regenerate" and stays enabled
    await waitFor(() => {
      const regenBtn = screen.getByRole('button', { name: /comments\.regenerate/i });
      expect(regenBtn).toBeInTheDocument();
      expect(regenBtn).not.toBeDisabled();
    }, { timeout: 3000 });
  });

  it('closes on ESC key press', () => {
    const onClose = vi.fn();
    render(<CommentDetailModal comment={mockComment} onClose={onClose} onReplySuccess={vi.fn()} />);

    // Simulate ESC key press
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('shows post context when postMessage is present', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });

    const commentWithPost: Comment = {
      ...mockComment,
      postMessage: 'Special offer on all courses!',
    };

    render(<CommentDetailModal comment={commentWithPost} onClose={vi.fn()} onReplySuccess={vi.fn()} />);

    expect(screen.getByText('Special offer on all courses!')).toBeInTheDocument();
  });

  it('does not show post context when postMessage is absent', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });

    render(<CommentDetailModal comment={mockComment} onClose={vi.fn()} onReplySuccess={vi.fn()} />);

    // The FileText icon area for post context should not be present
    expect(screen.queryByText('Special offer')).not.toBeInTheDocument();
  });

  it('shows resolve button when onResolve is provided and comment is not replied', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });

    render(
      <CommentDetailModal
        comment={mockComment}
        onClose={vi.fn()}
        onReplySuccess={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /comments\.resolve/i })).toBeInTheDocument();
    });
  });

  it('calls onResolve and onClose when resolve button is clicked', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });
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
      expect(screen.getByRole('button', { name: /comments\.resolve/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /comments\.resolve/i }));
    expect(onResolve).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show resolve button when comment is already replied', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });

    const repliedComment: Comment = {
      ...mockComment,
      replied: true,
      replyText: 'Thanks for reaching out!',
      replyMethod: 'ai',
    };

    render(
      <CommentDetailModal
        comment={repliedComment}
        onClose={vi.fn()}
        onReplySuccess={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    // Reply section is hidden for replied comments, so resolve button shouldn't exist
    expect(screen.queryByRole('button', { name: /comments\.resolve/i })).not.toBeInTheDocument();
  });

  it('shows comment message in the modal body', () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });

    render(<CommentDetailModal comment={mockComment} onClose={vi.fn()} onReplySuccess={vi.fn()} />);

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('shows commenter name in the header', () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({ data: { allowed: true } });

    render(<CommentDetailModal comment={mockComment} onClose={vi.fn()} onReplySuccess={vi.fn()} />);

    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  describe('page name link', () => {
    it('shows clickable page name button when facebookCommentId is present', () => {
      const comment: Comment = { ...mockComment, facebookCommentId: 'fb_comment_123' };

      render(
        <CommentDetailModal
          comment={comment}
          onClose={vi.fn()}
          onReplySuccess={vi.fn()}
          pageName="My Page"
        />
      );

      expect(screen.getByRole('button', { name: /my page/i })).toBeInTheDocument();
    });

    it('opens facebook comment URL when page name is clicked', () => {
      const comment: Comment = { ...mockComment, facebookCommentId: 'fb_comment_123' };

      render(
        <CommentDetailModal
          comment={comment}
          onClose={vi.fn()}
          onReplySuccess={vi.fn()}
          pageName="My Page"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://facebook.com/fb_comment_123');
    });

    it('falls back to pageUrl for Instagram comments without facebookCommentId', () => {
      const comment: Comment = { ...mockComment, facebookCommentId: undefined, source: 'instagram' };

      render(
        <CommentDetailModal
          comment={comment}
          onClose={vi.fn()}
          onReplySuccess={vi.fn()}
          pageName="My Page"
          pageUrl="https://instagram.com/mypageusername"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://instagram.com/mypageusername');
    });

    it('shows non-clickable page name when no URL available', () => {
      const comment: Comment = { ...mockComment, facebookCommentId: undefined };

      render(
        <CommentDetailModal
          comment={comment}
          onClose={vi.fn()}
          onReplySuccess={vi.fn()}
          pageName="My Page"
        />
      );

      expect(screen.getByText('My Page')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /my page/i })).not.toBeInTheDocument();
    });

    it('does not render page name row when pageName is not provided', () => {
      const comment: Comment = { ...mockComment, facebookCommentId: 'fb_comment_123' };

      render(
        <CommentDetailModal
          comment={comment}
          onClose={vi.fn()}
          onReplySuccess={vi.fn()}
        />
      );

      expect(screen.queryByText('My Page')).not.toBeInTheDocument();
    });
  });
});

