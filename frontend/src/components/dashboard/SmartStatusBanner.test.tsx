import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Comment } from '@jawab24/shared';
import { SmartStatusBanner, type NeedsAttentionItem } from './SmartStatusBanner';

function makeMessageItem(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: '1',
    type: 'message',
    senderName: 'Ali',
    text: 'What are your packages?',
    createdAt: '2026-03-01T10:00:00Z',
    flagReason: null,
    href: '/messages?filter=needs_action',
    senderId: 'sender1',
    pageId: 'page1',
    ...overrides,
  };
}

function makeCommentItem(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: 'c1',
    type: 'comment',
    senderName: 'Sara',
    text: 'Is this available?',
    createdAt: '2026-03-01T10:00:00Z',
    flagReason: null,
    href: '/comments?filter=needs_action',
    commentData: { id: 'c1', message: 'Is this available?' } as Comment,
    ...overrides,
  };
}

function renderBanner(
  items: NeedsAttentionItem[],
  onClick = vi.fn(),
  counts?: { comments?: number; messages?: number },
) {
  const commentCount = counts?.comments ?? items.filter(i => i.type === 'comment').length;
  const messageCount = counts?.messages ?? items.filter(i => i.type === 'message').length;
  return render(
    <SmartStatusBanner
      commentNeedsAction={commentCount}
      messageNeedsAction={messageCount}
      items={items}
      onItemClick={onClick}
    />,
  );
}

describe('SmartStatusBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the correct attention count in the header button aria-label', () => {
    renderBanner([makeMessageItem(), makeMessageItem({ id: '2' })]);
    expect(screen.getByRole('button', { name: /2 items need your attention/i })).toBeInTheDocument();
  });

  it('renders items in the DOM after expanding', () => {
    renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('What are your packages?')).toBeInTheDocument();
  });

  // Regression: bug where comma-separated flagReason was passed directly to
  // the translator, rendering raw "flagReason.info_not_in_kb,low_confidence"
  it('shows translated primary flag label for comma-separated flagReason', () => {
    renderBanner([makeMessageItem({ flagReason: 'info_not_in_kb,low_confidence' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('Missing from Business Info')).toBeInTheDocument();
    expect(screen.queryByText(/info_not_in_kb,low_confidence/)).not.toBeInTheDocument();
    expect(screen.queryByText(/flagReason\./)).not.toBeInTheDocument();
  });

  it('shows translated label for single flag', () => {
    renderBanner([makeMessageItem({ flagReason: 'angry_customer' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('Angry customer')).toBeInTheDocument();
  });

  it('does not show a flag tag for sla_no_reply (default reason)', () => {
    renderBanner([makeMessageItem({ flagReason: 'sla_no_reply:60' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.queryByText(/sla_no_reply/)).not.toBeInTheDocument();
  });

  it('calls onItemClick when a message item is clicked', () => {
    const onClick = vi.fn();
    renderBanner([makeMessageItem()], onClick);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    fireEvent.click(screen.getByText('What are your packages?'));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1', type: 'message' }));
  });

  it('calls onItemClick when a comment item with commentData is clicked', () => {
    const onClick = vi.fn();
    renderBanner([makeCommentItem()], onClick);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    fireEvent.click(screen.getByText('Is this available?'));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', type: 'comment' }));
  });

  it('renders a link (not a button) for a comment item without commentData', () => {
    renderBanner([makeCommentItem({ commentData: undefined })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    const item = screen.getByText('Is this available?').closest('a');
    expect(item).toHaveAttribute('href', '/comments?filter=needs_action');
  });

  // --- Dismiss behavior ---

  it('hides banner after clicking the dismiss button', () => {
    renderBanner([makeMessageItem()]);
    // Banner should be visible
    expect(screen.getByRole('button', { name: /item.*need.*attention/i })).toBeInTheDocument();

    // Click the dismiss X button
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButton);

    // Banner should be gone
    expect(screen.queryByRole('button', { name: /item.*need.*attention/i })).not.toBeInTheDocument();
  });

  it('stays hidden on re-render after dismiss (localStorage persistence)', () => {
    const { unmount } = renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();

    // Re-render with the same count — should still be hidden
    renderBanner([makeMessageItem()]);
    expect(screen.queryByRole('button', { name: /item.*need.*attention/i })).not.toBeInTheDocument();
  });

  it('re-shows banner when item count increases after dismiss', () => {
    // Render with 1 item, dismiss
    const { unmount } = renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();

    // Re-render with 2 items (count increased) — should re-show
    renderBanner([makeMessageItem(), makeCommentItem()]);
    expect(screen.getByRole('button', { name: /item.*need.*attention/i })).toBeInTheDocument();
  });

  it('stays hidden when item count decreases after dismiss', () => {
    // Render with 2 items, dismiss
    const { unmount } = renderBanner(
      [makeMessageItem(), makeCommentItem()],
      vi.fn(),
      { comments: 1, messages: 1 },
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();

    // Re-render with 1 item (count decreased) — should stay hidden
    renderBanner([makeMessageItem()]);
    expect(screen.queryByRole('button', { name: /item.*need.*attention/i })).not.toBeInTheDocument();
  });

  it('re-shows banner after 24-hour dismiss period expires', () => {
    renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    // Fast-forward localStorage timestamp to > 24 hours ago
    const stored = JSON.parse(localStorage.getItem('smartBannerDismissedAt')!);
    stored.dismissedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem('smartBannerDismissedAt', JSON.stringify(stored));

    // Re-render — 24h expired, should re-show
    const { container } = renderBanner([makeMessageItem()]);
    expect(screen.getByRole('button', { name: /item.*need.*attention/i })).toBeInTheDocument();
  });

  it('has a visible dismiss button with correct aria-label', () => {
    renderBanner([makeMessageItem()]);
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    expect(dismissButton).toBeInTheDocument();
  });
});
