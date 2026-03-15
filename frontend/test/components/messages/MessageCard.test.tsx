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
    facebookMessageId: `fb-${Math.random().toString(36).slice(2, 8)}`,
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

  it('counts only incoming messages, not outgoing replies', () => {
    const incoming1 = makeMessage({ message: 'Hello', direction: 'incoming', createdAt: '2026-01-01T00:00:00Z' });
    const outgoing1 = makeMessage({ message: 'Hi! How can I help?', direction: 'outgoing', replied: true, replyMethod: 'ai', createdAt: '2026-01-01T00:00:01Z' });
    const incoming2 = makeMessage({ message: 'I need help', direction: 'incoming', createdAt: '2026-01-01T00:00:02Z' });
    const outgoing2 = makeMessage({ message: 'Sure thing!', direction: 'outgoing', replied: true, replyMethod: 'ai', createdAt: '2026-01-01T00:00:03Z' });

    const conv = makeConversation([incoming1, outgoing1, incoming2, outgoing2]);
    render(<MessageCard conversation={conv} onClick={vi.fn()} />);

    // 4 total messages but only 2 are incoming — the badge should show 2
    const badge = screen.getByText('2');
    expect(badge).toBeInTheDocument();
  });

  it('shows 1 when a single incoming message has an outgoing reply', () => {
    const incoming = makeMessage({ message: 'Hello', direction: 'incoming', createdAt: '2026-01-01T00:00:00Z' });
    const outgoing = makeMessage({ message: 'Hello! How can I assist you?', direction: 'outgoing', replied: true, replyMethod: 'ai', createdAt: '2026-01-01T00:00:01Z' });

    const conv = makeConversation([incoming, outgoing]);
    render(<MessageCard conversation={conv} onClick={vi.fn()} />);

    // Only 1 incoming message — badge should show 1, not 2
    const badge = screen.getByText('1');
    expect(badge).toBeInTheDocument();
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
});
