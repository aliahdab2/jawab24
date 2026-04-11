import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentDetailModal } from '@/components/comments/CommentDetailModal';
import type { Comment } from '@jawab24/shared';

// next-intl, next/router, useLocale mocked globally via test/setup.ts

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/useEscapeKey', () => ({ useEscapeKey: vi.fn() }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: vi.fn() }));
vi.mock('@/hooks/useModalBackHandler', () => ({ useModalBackHandler: vi.fn() }));
vi.mock('@/hooks/useAiGeneration', () => ({
  useAiGeneration: () => ({
    isGenerating: false,
    generationStatus: null,
    aiLimit: { allowed: true },
    generatedReply: null,
    generate: vi.fn(),
  }),
}));
vi.mock('@/lib/api', () => ({
  commentsApi: { sendReply: vi.fn(), resolveComment: vi.fn() },
  messagesApi: { getPauseStatus: vi.fn().mockResolvedValue({ data: null }) },
}));
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('@/utils/pageUrl', () => ({ getCommentExternalUrl: vi.fn().mockReturnValue(null) }));
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, createPortal: (node: React.ReactNode) => node };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    message: 'Hello',
    fromName: 'Test User',
    fromId: 'user-1',
    replied: false,
    replyText: null,
    replyMethod: null,
    detectedLanguage: 'en',
    pageId: 'page-1',
    createdAt: new Date().toISOString(),
    repliedAt: null,
    postId: 'post-1',
    needsAttention: true,
    flagReason: null,
    aiIntent: null,
    aiOriginalReply: null,
    resolved: false,
    postMessage: null,
    ...overrides,
  };
}

describe('CommentDetailModal — KB nudge', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onReplySuccess: vi.fn(),
    onResolve: vi.fn(),
    onUnresolve: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Add to Business Info" link when primary flag is info_not_in_kb', () => {
    const comment = makeComment({ needsAttention: true, flagReason: 'info_not_in_kb' });
    render(<CommentDetailModal {...defaultProps} comment={comment} />);
    expect(screen.getByText('Add to Business Info')).toBeInTheDocument();
  });

  it('shows "Add to Business Info" link when primary flag is price_not_in_kb', () => {
    const comment = makeComment({ needsAttention: true, flagReason: 'price_not_in_kb' });
    render(<CommentDetailModal {...defaultProps} comment={comment} />);
    expect(screen.getByText('Add to Business Info')).toBeInTheDocument();
  });

  it('does NOT show "Add to Business Info" link for non-KB flags', () => {
    const comment = makeComment({ needsAttention: true, flagReason: 'low_confidence' });
    render(<CommentDetailModal {...defaultProps} comment={comment} />);
    expect(screen.queryByText('Add to Business Info')).not.toBeInTheDocument();
  });

  it('does NOT show "Add to Business Info" link when an urgent flag takes priority over a KB flag', () => {
    // Primary flag = cancellation_request (urgent) — KB nudge should NOT show
    const comment = makeComment({ needsAttention: true, flagReason: 'info_not_in_kb,cancellation_request' });
    render(<CommentDetailModal {...defaultProps} comment={comment} />);
    expect(screen.queryByText('Add to Business Info')).not.toBeInTheDocument();
  });

  it('does NOT show "Add to Business Info" link when flagReason is null', () => {
    const comment = makeComment({ needsAttention: true, flagReason: null });
    render(<CommentDetailModal {...defaultProps} comment={comment} />);
    expect(screen.queryByText('Add to Business Info')).not.toBeInTheDocument();
  });

  it('"Add to Business Info" link points to pages?openKb=true', () => {
    const comment = makeComment({ needsAttention: true, flagReason: 'info_not_in_kb' });
    render(<CommentDetailModal {...defaultProps} comment={comment} />);
    const link = screen.getByText('Add to Business Info').closest('a');
    expect(link?.getAttribute('href')).toContain('openKb=true');
  });
});
