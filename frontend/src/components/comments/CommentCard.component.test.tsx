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

  it('shows the real low-signal comment text (e.g. a lone "."), never an intent label or "No preview"', () => {
    // Post-reply keyword flow: customers comment "." on purpose — it must be
    // shown verbatim, never replaced by the AI intent label or "No preview".
    render(<CommentCard {...defaultProps} comment={{ ...baseComment, message: '.', aiIntent: 'QUESTION' }} />);
    expect(screen.getByText('.')).toBeInTheDocument();
    expect(screen.queryByText('Question')).not.toBeInTheDocument();
    expect(screen.queryByText('No preview')).not.toBeInTheDocument();
  });

  it('shows an emoji-only comment verbatim', () => {
    render(<CommentCard {...defaultProps} comment={{ ...baseComment, message: '👍', aiIntent: null }} />);
    expect(screen.getByText('👍')).toBeInTheDocument();
    expect(screen.queryByText('No preview')).not.toBeInTheDocument();
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

  it('direction-detects the reply text, exactly as it does the incoming comment', () => {
    // Found 2026-09-04 in the Arabic dashboard: the incoming comment carried
    // dir="auto" and the reply bubble did not, so an English reply took the
    // page's RTL base direction and painted its trailing punctuation on the
    // wrong side — «…options for you.» rendered as «.…options for you».
    // CommentDetailModal already had dir="auto" on this same field; only the
    // card was missing it.
    // ⚠️ jsdom does no bidi layout, so this asserts the ATTRIBUTE; the painted
    // order was verified in real Chrome on /ar/comments.
    const replied: Comment = {
      ...baseComment,
      replied: true,
      replyText: 'Hi Fatima! We ship across Saudi Arabia. DM us your location.',
      replyMethod: 'ai',
    };
    render(<CommentCard {...defaultProps} comment={replied} />);
    const bubble = screen.getByText('Hi Fatima! We ship across Saudi Arabia. DM us your location.');
    expect(
      bubble.getAttribute('dir'),
      'the reply bubble lost dir="auto" — a Latin reply will paint right-to-left in the Arabic dashboard',
    ).toBe('auto');
  });

  describe('reply source indicator', () => {
    it('shows Smart Reply indicator for AI replies', () => {
      const replied: Comment = { ...baseComment, replied: true, replyText: 'x', replyMethod: 'ai' };
      render(<CommentCard {...defaultProps} comment={replied} />);
      expect(screen.getByLabelText('Smart Reply')).toBeInTheDocument();
    });

    // Regression: manual replies were showing the same Zap+emerald indicator as
    // preset replies because the branch was `isAI ? ai : template`.
    it('shows Manual indicator for manually-sent replies (not Preset Reply)', () => {
      const replied: Comment = { ...baseComment, replied: true, replyText: 'x', replyMethod: 'manual' };
      render(<CommentCard {...defaultProps} comment={replied} />);
      expect(screen.getByLabelText('Manual')).toBeInTheDocument();
      expect(screen.queryByLabelText('Post Reply')).not.toBeInTheDocument();
    });

    it('shows Post Reply indicator for post_reply replies', () => {
      const replied: Comment = { ...baseComment, replied: true, replyText: 'x', replyMethod: 'post_reply' };
      render(<CommentCard {...defaultProps} comment={replied} />);
      expect(screen.getByLabelText('Post Reply')).toBeInTheDocument();
    });

    it('shows Auto reply indicator for template (AI fallback / canned) replies', () => {
      const replied: Comment = { ...baseComment, replied: true, replyText: 'x', replyMethod: 'template' };
      render(<CommentCard {...defaultProps} comment={replied} />);
      expect(screen.getByLabelText('Auto reply')).toBeInTheDocument();
      expect(screen.queryByLabelText('Post Reply')).not.toBeInTheDocument();
    });

    it('renders no indicator when reply has no method', () => {
      const replied: Comment = { ...baseComment, replied: true, replyText: 'x', replyMethod: null };
      render(<CommentCard {...defaultProps} comment={replied} />);
      expect(screen.queryByLabelText('Smart Reply')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Manual')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Post Reply')).not.toBeInTheDocument();
    });
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
