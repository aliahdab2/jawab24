import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CommentCard, checkNeedsAttention } from './CommentCard';
import type { Comment } from '@jawab24/shared';

const baseComment: Comment = {
  id: 'c1',
  postId: 'p1',
  pageId: 'page1',
  message: 'كم سعر الدورة؟',
  createdAt: new Date().toISOString(),
  replied: false,
  fromName: 'أحمد محمد',
  replyText: null,
  replyMethod: null,
  detectedLanguage: 'ar',
};

describe('checkNeedsAttention', () => {
  it('returns true when needsAttention flag is set', () => {
    expect(checkNeedsAttention({ ...baseComment, needsAttention: true })).toBe(true);
  });

  it('returns true when message contains help keywords', () => {
    expect(checkNeedsAttention({ ...baseComment, message: 'I need help please' })).toBe(true);
    expect(checkNeedsAttention({ ...baseComment, message: 'أحتاج مساعدة' })).toBe(true);
  });

  it('returns false for normal unreplied comment', () => {
    expect(checkNeedsAttention(baseComment)).toBe(false);
  });

  it('returns false for replied comment even with keywords', () => {
    expect(checkNeedsAttention({ ...baseComment, replied: true, message: 'I need help' })).toBe(false);
  });
});

describe('CommentCard', () => {
  const defaultProps = {
    comment: baseComment,
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders comment message', () => {
    render(<CommentCard {...defaultProps} />);
    expect(screen.getByText('كم سعر الدورة؟')).toBeInTheDocument();
  });

  it('renders commenter name', () => {
    render(<CommentCard {...defaultProps} />);
    expect(screen.getByText('أحمد محمد')).toBeInTheDocument();
  });

  it('shows unknown user when fromName is null', () => {
    render(<CommentCard {...defaultProps} comment={{ ...baseComment, fromName: null }} />);
    expect(screen.getByText('Unknown User')).toBeInTheDocument();
  });

  it('shows pending badge for unreplied comments', () => {
    render(<CommentCard {...defaultProps} />);
    expect(screen.getByText('In queue')).toBeInTheDocument();
  });

  it('shows needs attention badge for flagged comments', () => {
    render(<CommentCard {...defaultProps} comment={{ ...baseComment, needsAttention: true }} />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('does not show pending badge when comment is replied', () => {
    const replied: Comment = {
      ...baseComment,
      replied: true,
      replyText: 'شكراً لتواصلك',
      replyMethod: 'ai',
    };
    render(<CommentCard {...defaultProps} comment={replied} />);
    expect(screen.queryByText('In queue')).not.toBeInTheDocument();
  });

  it('shows reply bubble when comment is replied', () => {
    const replied: Comment = {
      ...baseComment,
      replied: true,
      replyText: 'الرسوم 1500 ريال',
      replyMethod: 'ai',
    };
    render(<CommentCard {...defaultProps} comment={replied} />);
    expect(screen.getByText('الرسوم 1500 ريال')).toBeInTheDocument();
  });

  it('shows post context when postMessage is provided', () => {
    render(<CommentCard {...defaultProps} comment={{ ...baseComment, postMessage: 'عرض خاص على الدورات' }} />);
    expect(screen.getByText('عرض خاص على الدورات')).toBeInTheDocument();
  });

  it('renders long post message with truncate class', () => {
    const longMessage = 'هذا منشور طويل جداً يحتوي على نص كثير ويجب أن يتم اقتطاعه عند الخمسين حرف تقريباً';
    render(<CommentCard {...defaultProps} comment={{ ...baseComment, postMessage: longMessage }} />);
    // Full text is in the DOM; CSS truncate handles visual truncation
    const span = screen.getByText(longMessage);
    expect(span).toBeInTheDocument();
    expect(span.className).toContain('truncate');
  });

  it('shows resolve button when onResolve is provided', () => {
    render(<CommentCard {...defaultProps} onResolve={vi.fn()} onQuickReply={vi.fn()} />);
    expect(screen.getByText('Resolve')).toBeInTheDocument();
  });

  it('shows reply button when onQuickReply is provided', () => {
    render(<CommentCard {...defaultProps} onQuickReply={vi.fn()} />);
    expect(screen.getByText('Reply')).toBeInTheDocument();
  });

  it('does not show resolve/reply buttons when comment is already replied', () => {
    const replied: Comment = {
      ...baseComment,
      replied: true,
      replyText: 'Done',
      replyMethod: 'ai',
    };
    render(<CommentCard {...defaultProps} comment={replied} onResolve={vi.fn()} onQuickReply={vi.fn()} />);
    expect(screen.queryByText('Resolve')).not.toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<CommentCard {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByText('كم سعر الدورة؟'));
    expect(onClick).toHaveBeenCalled();
  });

  it('calls onResolve and stops propagation when resolve is clicked', () => {
    const onClick = vi.fn();
    const onResolve = vi.fn();
    render(<CommentCard {...defaultProps} onClick={onClick} onResolve={onResolve} onQuickReply={vi.fn()} />);

    fireEvent.click(screen.getByText('Resolve'));
    expect(onResolve).toHaveBeenCalled();
    // onClick should NOT be called — stopPropagation
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onQuickReply and stops propagation when reply is clicked', () => {
    const onClick = vi.fn();
    const onQuickReply = vi.fn();
    render(<CommentCard {...defaultProps} onClick={onClick} onQuickReply={onQuickReply} />);

    fireEvent.click(screen.getByText('Reply'));
    expect(onQuickReply).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows page name when provided', () => {
    render(<CommentCard {...defaultProps} pageName="معهد النور" />);
    expect(screen.getByText('معهد النور')).toBeInTheDocument();
  });
});
