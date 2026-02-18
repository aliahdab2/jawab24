import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageCard, Conversation } from './MessageCard';
import type { Message } from '@/lib/api';

// Mock translation hook
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    dateLocale: undefined,
  }),
}));

// Mock date-fns to return stable values
vi.mock('date-fns', () => ({
  formatDistanceToNow: () => '5 minutes ago',
}));

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: '1',
    pageId: 'page1',
    facebookMessageId: 'fb1',
    senderId: 'sender1',
    senderName: 'Ali',
    message: 'Hello',
    direction: 'incoming',
    replied: false,
    replyText: null,
    replyMethod: null,
    createdTime: null,
    repliedAt: null,
    createdAt: '2026-02-16T06:00:00Z',
    resolved: false,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation>): Conversation {
  return {
    senderId: 'sender1',
    senderName: 'Ali',
    messages: [],
    lastMessage: makeMessage({}),
    needsHumanAttention: false,
    ...overrides,
  };
}

describe('MessageCard', () => {
  const defaultProps = {
    onClick: vi.fn(),
    animationDelay: 0,
  };

  describe('chronological message ordering', () => {
    it('shows outgoing reply after incoming when reply is newer', () => {
      const incoming = makeMessage({
        id: '1',
        message: 'Customer question',
        direction: 'incoming',
        createdAt: '2026-02-16T06:00:00Z',
      });
      const outgoing = makeMessage({
        id: '2',
        message: 'Our reply',
        direction: 'outgoing',
        replied: true,
        replyMethod: 'template',
        createdAt: '2026-02-16T06:05:00Z',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming, outgoing],
            lastMessage: outgoing,
          })}
        />
      );

      const customerMsg = screen.getByText('Customer question');
      const replyMsg = screen.getByText('Our reply');

      // Incoming should appear before outgoing in the DOM
      expect(
        customerMsg.compareDocumentPosition(replyMsg) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('shows outgoing reply before incoming when customer message is newer', () => {
      const outgoing = makeMessage({
        id: '1',
        message: 'Previous reply',
        direction: 'outgoing',
        replied: true,
        replyMethod: 'manual',
        createdAt: '2026-02-16T06:35:00Z',
      });
      const incoming = makeMessage({
        id: '2',
        message: 'New customer message',
        direction: 'incoming',
        replied: false,
        createdAt: '2026-02-16T06:39:00Z',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [outgoing, incoming],
            lastMessage: incoming,
          })}
        />
      );

      const replyMsg = screen.getByText('Previous reply');
      const customerMsg = screen.getByText('New customer message');

      // Outgoing (older) should appear before incoming (newer) in the DOM
      expect(
        replyMsg.compareDocumentPosition(customerMsg) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('shows only incoming bubble when there is no outgoing message', () => {
      const incoming = makeMessage({
        id: '1',
        message: 'Unanswered question',
        direction: 'incoming',
        createdAt: '2026-02-16T06:00:00Z',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming],
            lastMessage: incoming,
          })}
        />
      );

      expect(screen.getByText('Unanswered question')).toBeInTheDocument();
      // Reply link should be shown
      expect(screen.getByText('comments.reply')).toBeInTheDocument();
    });

    it('hides outgoing bubble when needsHumanAttention is true', () => {
      const incoming = makeMessage({
        id: '1',
        message: 'Angry message',
        direction: 'incoming',
        createdAt: '2026-02-16T06:00:00Z',
      });
      const outgoing = makeMessage({
        id: '2',
        message: 'Auto reply',
        direction: 'outgoing',
        replyMethod: 'ai',
        createdAt: '2026-02-16T06:01:00Z',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming, outgoing],
            lastMessage: outgoing,
            needsHumanAttention: true,
          })}
        />
      );

      expect(screen.getByText('Angry message')).toBeInTheDocument();
      expect(screen.queryByText('Auto reply')).not.toBeInTheDocument();
    });

    it('shows both incoming messages when last 2 messages are from the customer', () => {
      const older = makeMessage({
        id: '1',
        message: 'مساء الخير',
        direction: 'incoming',
        createdAt: '2026-02-16T22:21:00Z',
      });
      const newer = makeMessage({
        id: '2',
        message: 'باديش كيلو الموز',
        direction: 'incoming',
        createdAt: '2026-02-16T22:21:30Z',
      });
      const outgoing = makeMessage({
        id: '3',
        message: 'Earlier reply',
        direction: 'outgoing',
        replyMethod: 'template',
        createdAt: '2026-02-16T11:10:00Z',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [outgoing, older, newer],
            lastMessage: newer,
          })}
        />
      );

      // Both incoming messages should be visible
      expect(screen.getByText('مساء الخير')).toBeInTheDocument();
      expect(screen.getByText('باديش كيلو الموز')).toBeInTheDocument();
      // The older outgoing reply should NOT be visible (not in last 2)
      expect(screen.queryByText('Earlier reply')).not.toBeInTheDocument();
    });
  });

  describe('status badges', () => {
    it('shows IN QUEUE badge when last message is unreplied incoming', () => {
      const incoming = makeMessage({
        direction: 'incoming',
        replied: false,
        message: 'Waiting',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming],
            lastMessage: incoming,
          })}
        />
      );

      expect(screen.getByText('comments.pending')).toBeInTheDocument();
    });

    it('shows NEEDS ATTENTION badge when flagged', () => {
      const incoming = makeMessage({ direction: 'incoming', message: 'Problem' });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming],
            lastMessage: incoming,
            needsHumanAttention: true,
          })}
        />
      );

      expect(screen.getByText('comments.needsAttention')).toBeInTheDocument();
    });
  });

  describe('resolve button', () => {
    it('shows resolve button when onResolve is provided', () => {
      const onResolve = vi.fn();
      const incoming = makeMessage({ direction: 'incoming', message: 'Question' });

      render(
        <MessageCard
          {...defaultProps}
          onResolve={onResolve}
          conversation={makeConversation({
            messages: [incoming],
            lastMessage: incoming,
          })}
        />
      );

      expect(screen.getByText('comments.resolve')).toBeInTheDocument();
    });

    it('does not show resolve button when onResolve is not provided', () => {
      const incoming = makeMessage({ direction: 'incoming', message: 'Question' });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming],
            lastMessage: incoming,
          })}
        />
      );

      expect(screen.queryByText('comments.resolve')).not.toBeInTheDocument();
    });

    it('calls onResolve without triggering onClick', async () => {
      const onResolve = vi.fn();
      const onClick = vi.fn();
      const incoming = makeMessage({ direction: 'incoming', message: 'Question' });

      render(
        <MessageCard
          onClick={onClick}
          onResolve={onResolve}
          animationDelay={0}
          conversation={makeConversation({
            messages: [incoming],
            lastMessage: incoming,
          })}
        />
      );

      const resolveBtn = screen.getByText('comments.resolve');
      resolveBtn.click();

      expect(onResolve).toHaveBeenCalledTimes(1);
      // onClick should not fire due to stopPropagation
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('reply source indicator', () => {
    it('shows TEMPLATE REPLY badge for template replies', () => {
      const incoming = makeMessage({ id: '1', direction: 'incoming', message: 'Q' });
      const outgoing = makeMessage({
        id: '2',
        direction: 'outgoing',
        message: 'A',
        replyMethod: 'template',
        createdAt: '2026-02-16T06:05:00Z',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming, outgoing],
            lastMessage: outgoing,
          })}
        />
      );

      expect(screen.getByText('dashboard.templateReply')).toBeInTheDocument();
    });

    it('shows SMART REPLY badge for AI replies', () => {
      const incoming = makeMessage({ id: '1', direction: 'incoming', message: 'Q' });
      const outgoing = makeMessage({
        id: '2',
        direction: 'outgoing',
        message: 'A',
        replyMethod: 'ai',
        createdAt: '2026-02-16T06:05:00Z',
      });

      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming, outgoing],
            lastMessage: outgoing,
          })}
        />
      );

      expect(screen.getByText('dashboard.aiReply')).toBeInTheDocument();
    });
  });
});
