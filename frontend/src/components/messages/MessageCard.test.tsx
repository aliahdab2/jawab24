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
    it.each([
      ['whatsapp', 'WhatsApp'],
      ['instagram', 'Instagram'],
      ['facebook', 'Facebook'],
    ] as const)('shows the %s badge on multi-channel workspaces', (platform, label) => {
      render(
        <MessageCard
          {...defaultProps}
          showChannelBadge
          conversation={makeConversation({
            messages: [makeMessage({ platform })],
            lastMessage: makeMessage({ platform }),
          })}
        />
      );

      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });

    it('shows NO channel badge on single-channel workspaces (showChannelBadge omitted)', () => {
      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            messages: [makeMessage({ platform: 'whatsapp' })],
            lastMessage: makeMessage({ platform: 'whatsapp' }),
          })}
        />
      );

      for (const label of ['WhatsApp', 'Instagram', 'Facebook']) {
        expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
      }
    });

    it('renders the channel as a labelled role=img, not a bare span', () => {
      // `aria-label` on a bare span (role=generic) is ignored per ARIA, and here the
      // icon is the ONLY channel conveyance a screen reader gets — the row carries no
      // channel text and no avatar.
      render(
        <MessageCard
          {...defaultProps}
          showChannelBadge
          conversation={makeConversation({
            messages: [makeMessage({ platform: 'whatsapp' })],
            lastMessage: makeMessage({ platform: 'whatsapp' }),
          })}
        />
      );

      expect(screen.getByRole('img', { name: 'WhatsApp' })).toBeInTheDocument();
    });

    it('leads the row with the channel and reserves no trailing corner padding', () => {
      // The old marker was a diagonal corner ribbon: absolutely positioned, so the row
      // had to be `relative overflow-hidden` and reserve `pe-14`. The leading icon is a
      // flow child — padding is constant and symmetric.
      const { container } = render(
        <MessageCard
          {...defaultProps}
          showChannelBadge
          conversation={makeConversation({
            messages: [makeMessage({ platform: 'instagram' })],
            lastMessage: makeMessage({ platform: 'instagram' }),
          })}
        />
      );

      const row = container.querySelector('[role="button"]')!;
      expect(row.className).not.toMatch(/\bpe-14\b/);
      expect(row.className).not.toMatch(/\boverflow-hidden\b/);
      expect(row.className).toMatch(/\bpx-3\.5\b/);

      // The channel icon precedes the content in DOM order — that is what puts it at
      // the head of the row in BOTH directions, with no physical-side class involved.
      const icon = screen.getByRole('img', { name: 'Instagram' });
      expect(row.firstElementChild!.contains(icon)).toBe(true);
    });

    it('renders no initials avatar — initials do not survive Arabic', () => {
      // `split(' ').slice(0,2).map(w => w[0])` gave «القحطاني» its article's alif, so
      // nearly every Arabic customer shared the same second letter (نا / سا / ما / أا).
      // The name beside the icon carries identity; the disc carried nothing.
      render(
        <MessageCard
          {...defaultProps}
          showChannelBadge
          conversation={makeConversation({
            senderName: 'نورة القحطاني',
            messages: [makeMessage({ platform: 'whatsapp', senderName: 'نورة القحطاني' })],
            lastMessage: makeMessage({ platform: 'whatsapp', senderName: 'نورة القحطاني' }),
          })}
        />
      );

      expect(screen.getByText('نورة القحطاني')).toBeInTheDocument();
      expect(screen.queryByText('نا')).not.toBeInTheDocument();
    });

    it('prefers whatsapp over a legacy defaulted-facebook outgoing row', () => {
      const legacyOutgoing = makeMessage({
        id: '1',
        direction: 'outgoing',
        replied: true,
        replyMethod: 'ai',
        platform: 'facebook', // legacy rows were stamped with the default
      });
      const incoming = makeMessage({ id: '2', platform: 'whatsapp' });

      render(
        <MessageCard
          {...defaultProps}
          showChannelBadge
          conversation={makeConversation({
            messages: [legacyOutgoing, incoming],
            lastMessage: incoming,
          })}
        />
      );

      expect(screen.getByLabelText('WhatsApp')).toBeInTheDocument();
      expect(screen.queryByLabelText('Facebook')).not.toBeInTheDocument();
    });
  });

  describe('customer identity (WhatsApp number)', () => {
    it('falls back to the formatted phone number when a WhatsApp conversation has no name', () => {
      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            senderId: '46700224720',
            senderName: null,
            messages: [makeMessage({ platform: 'whatsapp', senderName: null })],
            lastMessage: makeMessage({ platform: 'whatsapp', senderName: null }),
          })}
        />
      );

      expect(screen.getByText('+46 70 022 47 20')).toBeInTheDocument();
      expect(screen.queryByText('Unknown User')).not.toBeInTheDocument();
    });

    it('prefers the WhatsApp display name over the number when a name exists', () => {
      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            senderId: '46700224720',
            senderName: 'Sara',
            messages: [makeMessage({ platform: 'whatsapp' })],
            lastMessage: makeMessage({ platform: 'whatsapp' }),
          })}
        />
      );

      expect(screen.getByText('Sara')).toBeInTheDocument();
      expect(screen.queryByText('+46 70 022 47 20')).not.toBeInTheDocument();
    });

    it('never renders a Facebook PSID as a phone number (keeps Unknown User)', () => {
      render(
        <MessageCard
          {...defaultProps}
          conversation={makeConversation({
            // Digits, but a Facebook PSID must never be shown as a dialable number.
            senderId: '46700224720',
            senderName: null,
            messages: [makeMessage({ platform: 'facebook', senderName: null })],
            lastMessage: makeMessage({ platform: 'facebook', senderName: null }),
          })}
        />
      );

      expect(screen.getByText('Unknown User')).toBeInTheDocument();
      expect(screen.queryByText('+46 70 022 47 20')).not.toBeInTheDocument();
    });
  });
});
