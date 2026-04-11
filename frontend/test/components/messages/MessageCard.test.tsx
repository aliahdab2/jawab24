import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageCard, type Conversation } from '@/components/messages/MessageCard';
import type { Message } from '@/lib/api';

// Translation mocked globally via test/setup.ts (next-intl mock returns real English strings)

const now = new Date().toISOString();

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    pageId: 'page-1',
    platformMessageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    senderId: 'sender-1',
    senderName: 'Ali',
    message: 'Hello',
    direction: 'incoming',
    replied: false,
    replyText: null,
    replyMethod: null,
    createdTime: now,
    repliedAt: null,
    createdAt: now,
    ...overrides,
  };
}

function makeConversation(messages: Message[], overrides: Partial<Conversation> = {}): Conversation {
  return {
    senderId: 'sender-1',
    senderName: 'Ali',
    messages,
    lastMessage: messages[messages.length - 1],
    needsHumanAttention: false,
    ...overrides,
  };
}

describe('MessageCard', () => {
  it('renders sender name', () => {
    const conv = makeConversation([makeMessage()]);
    render(<MessageCard conversation={conv} onClick={vi.fn()} />);
    expect(screen.getByText('Ali')).toBeInTheDocument();
  });

  it('does not show an inline message count badge', () => {
    const incoming1 = makeMessage({ message: 'Hello', direction: 'incoming', createdAt: '2026-01-01T00:00:00Z' });
    const outgoing1 = makeMessage({ message: 'Hi! How can I help?', direction: 'outgoing', replied: true, replyMethod: 'ai', createdAt: '2026-01-01T00:00:01Z' });
    const incoming2 = makeMessage({ message: 'I need help', direction: 'incoming', createdAt: '2026-01-01T00:00:02Z' });
    const outgoing2 = makeMessage({ message: 'Sure thing!', direction: 'outgoing', replied: true, replyMethod: 'ai', createdAt: '2026-01-01T00:00:03Z' });

    const conv = makeConversation([incoming1, outgoing1, incoming2, outgoing2]);
    const { container } = render(<MessageCard conversation={conv} onClick={vi.fn()} />);

    // The inline count badge was removed (it showed unreliable paginated counts).
    // The accurate count is shown in the modal header instead.
    const countBadges = container.querySelectorAll('.bg-muted.rounded');
    const hasMsgCount = Array.from(countBadges).some(el => /^\d+$/.test(el.textContent?.trim() || ''));
    expect(hasMsgCount).toBe(false);
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    const conv = makeConversation([makeMessage()]);
    render(<MessageCard conversation={conv} onClick={onClick} />);

    fireEvent.click(screen.getByText('Ali'));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows "Unknown User" when senderName is null', () => {
    const conv = makeConversation([makeMessage({ senderName: null })], { senderName: null });
    render(<MessageCard conversation={conv} onClick={vi.fn()} />);
    expect(screen.getByText('Unknown User')).toBeInTheDocument();
  });

  it('shows "Handled" badge when conversation is resolved', () => {
    const msg = makeMessage({ resolved: true, replied: true, replyMethod: 'ai' });
    const conv = makeConversation([msg]);
    render(<MessageCard conversation={conv} onClick={vi.fn()} />);
    expect(screen.getByText('Handled')).toBeInTheDocument();
  });

  it('does not render inline action buttons (actions handled in the detail modal)', () => {
    // Inline resolve/unresolve buttons were removed from the card — actions happen in the modal.
    const msg = makeMessage({ resolved: true, replied: true, replyMethod: 'ai' });
    const conv = makeConversation([msg]);
    render(<MessageCard conversation={conv} onClick={vi.fn()} onResolve={vi.fn()} onUnresolve={vi.fn()} />);
    expect(screen.queryByText('Mark as handled')).not.toBeInTheDocument();
    expect(screen.queryByText('Mark as unhandled')).not.toBeInTheDocument();
  });
});
