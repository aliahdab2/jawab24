import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
});
