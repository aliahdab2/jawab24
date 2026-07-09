import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageCard, Conversation } from './MessageCard';
import type { Message } from '@/lib/api';

// Mock translation hook
// Mock date-fns to return stable values
vi.mock('date-fns', () => ({
  formatDistanceToNow: () => '5 minutes ago',
}));

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: '1',
    pageId: 'page1',
    platformMessageId: 'fb1',
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

    it('shows latest incoming in row 2 and latest outgoing in row 3 regardless of timestamp order', () => {
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

      const customerMsg = screen.getByText('New customer message');
      const replyMsg = screen.getByText('Previous reply');

      // Latest incoming (row 2) always appears before latest outgoing (row 3)
      expect(
        customerMsg.compareDocumentPosition(replyMsg) & Node.DOCUMENT_POSITION_FOLLOWING
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
      // No outgoing reply row when there are no outgoing messages
      expect(screen.queryByText('Reply')).not.toBeInTheDocument();
    });

    it('shows outgoing bubble even when needsHumanAttention is true', () => {
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
      expect(screen.getByText('Auto reply')).toBeInTheDocument();
    });

    it('shows only the latest incoming message and latest outgoing reply', () => {
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

      // Only the latest incoming should be visible (older incoming is not shown)
      expect(screen.getByText('باديش كيلو الموز')).toBeInTheDocument();
      expect(screen.queryByText('مساء الخير')).not.toBeInTheDocument();
      // The latest outgoing reply is always shown regardless of timestamp
      expect(screen.getByText('Earlier reply')).toBeInTheDocument();
    });
  });

  describe('status badges', () => {
    it('shows Waiting to reply badge when last message is unreplied incoming', () => {
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

      expect(screen.getByText('Waiting to reply')).toBeInTheDocument();
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

      expect(screen.getByText('Needs attention')).toBeInTheDocument();
    });
  });

  describe('resolve button', () => {
    it('does not render inline resolve buttons (actions handled in the detail modal)', () => {
      // Inline resolve button was removed — same as CommentCard. Actions via modal only.
      const incoming = makeMessage({ direction: 'incoming', message: 'Question' });
      render(
        <MessageCard
          {...defaultProps}
          onResolve={vi.fn()}
          onUnresolve={vi.fn()}
          conversation={makeConversation({ messages: [incoming], lastMessage: incoming })}
        />
      );
      expect(screen.queryByText('Mark as handled')).not.toBeInTheDocument();
      expect(screen.queryByText('Mark as unhandled')).not.toBeInTheDocument();
    });
  });

  describe('reply source indicator', () => {
    it('shows POST REPLY badge for post_reply replies', () => {
      const incoming = makeMessage({ id: '1', direction: 'incoming', message: 'Q' });
      const outgoing = makeMessage({
        id: '2',
        direction: 'outgoing',
        message: 'A',
        replyMethod: 'post_reply',
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

      expect(screen.getByText('Post Reply')).toBeInTheDocument();
    });

    it('shows AUTO REPLY badge for template (AI fallback) replies', () => {
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

      expect(screen.getByText('Auto reply')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
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

      expect(screen.getByText('Smart Reply')).toBeInTheDocument();
    });

    // Regression: manual replies were being labeled "Post Reply" in the list card
    // because the badge logic branched only on 'ai' vs else (treated everything else as template).
    it('shows MANUAL badge for manually-sent replies (not "Post Reply")', () => {
      const incoming = makeMessage({ id: '1', direction: 'incoming', message: 'Q' });
      const outgoing = makeMessage({
        id: '2',
        direction: 'outgoing',
        message: 'A',
        replyMethod: 'manual',
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

      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });
  });

  describe('channel badge', () => {
    it('shows the WhatsApp badge when the conversation has whatsapp messages', () => {
      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [makeMessage({ platform: 'whatsapp' })],
            lastMessage: makeMessage({ platform: 'whatsapp' }),
          })}
        />
      );

      expect(screen.getByLabelText('WhatsApp')).toBeInTheDocument();
    });

    it('shows NO channel badge for facebook conversations (existing UI unchanged)', () => {
      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [makeMessage({ platform: 'facebook' })],
            lastMessage: makeMessage({ platform: 'facebook' }),
          })}
        />
      );

      expect(screen.queryByLabelText('WhatsApp')).not.toBeInTheDocument();
    });
  });
});
