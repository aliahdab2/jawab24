import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CommentDetailModal } from '@/components/comments/CommentDetailModal';
import { subscriptionApi, aiApi } from '@/lib/api';
import { Comment } from '@jawab24/shared';

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
    reply: vi.fn()
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
});

