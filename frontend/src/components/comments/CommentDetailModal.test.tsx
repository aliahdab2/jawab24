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
    language: 'en'
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
      // Button text changes to "Limit Reached" when disabled
      const button = screen.getByRole('button', { name: /Limit Reached/i });
      expect(button).toBeDisabled();
    });
  });

  it('locks button after successful generation (one-shot)', async () => {
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
    
    // Wait for the interval to tick (real time)
    await new Promise(resolve => setTimeout(resolve, 1100));

    await waitFor(() => {
      expect(screen.getByText('Generated')).toBeInTheDocument();
    });
  });
});

