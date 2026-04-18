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
  it('returns true when backend needsAttention flag is set', () => {
    expect(checkNeedsAttention({ ...baseComment, needsAttention: true })).toBe(true);
  });

  it('returns false for a normal unreplied comment without the flag', () => {
    expect(checkNeedsAttention(baseComment)).toBe(false);
  });

  it('returns false for replied comments when the flag is not set', () => {
    expect(checkNeedsAttention({ ...baseComment, replied: true })).toBe(false);
  });

  it('returns true for replied comments when the backend keeps the flag set', () => {
    expect(checkNeedsAttention({ ...baseComment, replied: true, needsAttention: true })).toBe(true);
  });

  it('does not flag comments based on client-side keyword matching', () => {
    // The client trusts the backend flag only — no local keyword fallback.
    expect(checkNeedsAttention({ ...baseComment, message: 'I need help please' })).toBe(false);
    expect(checkNeedsAttention({ ...baseComment, message: 'أحتاج مساعدة' })).toBe(false);
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
    expect(screen.getByText('Waiting to reply')).toBeInTheDocument();
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
    expect(screen.queryByText('Waiting to reply')).not.toBeInTheDocument();
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

  it('renders long post message with line-clamp class', () => {
    const longMessage = 'هذا منشور طويل جداً يحتوي على نص كثير ويجب أن يتم اقتطاعه عند الخمسين حرف تقريباً';
    render(<CommentCard {...defaultProps} comment={{ ...baseComment, postMessage: longMessage }} />);
    // Full text is in the DOM; CSS line-clamp handles visual truncation
    const span = screen.getByText(longMessage);
    expect(span).toBeInTheDocument();
    expect(span.className).toContain('line-clamp-1');
  });

  it('does not render inline action buttons (actions handled by swipe or modal)', () => {
    // Inline resolve/reply buttons were removed — cards are compact and actions
    // happen via the swipe gesture (SwipeableCommentCard) or the detail modal.
    render(<CommentCard {...defaultProps} onResolve={vi.fn()} onQuickReply={vi.fn()} />);
    expect(screen.queryByText('Mark as handled')).not.toBeInTheDocument();
    expect(screen.queryByText('Reply')).not.toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<CommentCard {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByText('كم سعر الدورة؟'));
    expect(onClick).toHaveBeenCalled();
  });


  it('shows page name when provided', () => {
    render(<CommentCard {...defaultProps} pageName="معهد النور" />);
    expect(screen.getByText('معهد النور')).toBeInTheDocument();
  });

  it('shows count badge when groupCount > 1', () => {
    render(<CommentCard {...defaultProps} groupCount={3} />);
    expect(screen.getByText('3 comments')).toBeInTheDocument();
  });

  it('does not show count badge when groupCount is 1', () => {
    render(<CommentCard {...defaultProps} groupCount={1} />);
    expect(screen.queryByText(/\d+ comments?/)).not.toBeInTheDocument();
  });

  it('does not show count badge when groupCount is undefined', () => {
    render(<CommentCard {...defaultProps} />);
    expect(screen.queryByText(/\d+ comments?/)).not.toBeInTheDocument();
  });

  it('shows expand toggle when grouped with earlier comments', () => {
    const earlier: Comment[] = [
      { ...baseComment, id: 'c0', message: 'Earlier question' },
    ];
    render(<CommentCard {...defaultProps} groupCount={2} earlierComments={earlier} />);
    expect(screen.getByText('Show earlier comments')).toBeInTheDocument();
  });

  it('shows earlier comments when expanded', () => {
    const earlier: Comment[] = [
      { ...baseComment, id: 'c0', message: 'Earlier question' },
    ];
    render(<CommentCard {...defaultProps} groupCount={2} earlierComments={earlier} isExpanded />);
    expect(screen.getByText('Earlier question')).toBeInTheDocument();
    expect(screen.getByText('Hide earlier comments')).toBeInTheDocument();
  });

  it('calls onToggleExpand with stopPropagation when toggle is clicked', () => {
    const onClick = vi.fn();
    const onToggleExpand = vi.fn();
    const earlier: Comment[] = [
      { ...baseComment, id: 'c0', message: 'Earlier question' },
    ];
    render(
      <CommentCard
        {...defaultProps}
        onClick={onClick}
        groupCount={2}
        earlierComments={earlier}
        onToggleExpand={onToggleExpand}
      />
    );

    fireEvent.click(screen.getByText('Show earlier comments'));
    expect(onToggleExpand).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
