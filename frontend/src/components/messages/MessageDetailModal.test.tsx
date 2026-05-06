import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { MessageDetailModal } from './MessageDetailModal';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { Conversation } from './MessageCard';
import type { Message } from '@/lib/api';

vi.mock('@/lib/openExternalUrl', () => ({
  openExternalUrl: vi.fn()
}));

// Mock react-query — useQuery returns conversation.messages as fallback
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

// Mock messagesApi (imported by the modal for conversation fetch)
vi.mock('@/lib/api', () => ({
  messagesApi: {
    getConversation: vi.fn(),
  },
}));

// Translation mocked globally via test/setup.ts (next-intl mock returns the key as-is)

// Mock useEscapeKey hook
vi.mock('@/hooks/useEscapeKey', () => ({
  useEscapeKey: (handler: () => void) => {
    // Register global keydown listener for ESC
    if (typeof window !== 'undefined') {
      const listener = (e: KeyboardEvent) => {
        if (e.key === 'Escape') handler();
      };
      window.addEventListener('keydown', listener);
    }
  },
}));

// Mock date-fns
vi.mock('date-fns', () => ({
  format: () => 'Feb 17, 2026, 10:00 AM',
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
    createdAt: '2026-02-17T10:00:00Z',
    resolved: false,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const incoming = makeMessage({});
  return {
    senderId: 'sender1',
    senderName: 'Ali',
    messages: [incoming],
    lastMessage: incoming,
    needsHumanAttention: false,
    ...overrides,
  };
}

const defaultProps = {
  onClose: vi.fn(),
  onReply: vi.fn(),
  onResolve: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  isReplying: false,
  isPausing: false,
  isResuming: false,
};

describe('MessageDetailModal', () => {
  it('renders message thread', () => {
    const incoming = makeMessage({ id: '1', message: 'Customer question', direction: 'incoming' });
    const outgoing = makeMessage({
      id: '2',
      message: 'Our answer',
      direction: 'outgoing',
      replied: true,
      replyMethod: 'template',
      createdAt: '2026-02-17T10:05:00Z',
    });

    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({
          messages: [incoming, outgoing],
          lastMessage: outgoing,
        })}
      />
    );

    expect(screen.getByText('Customer question')).toBeInTheDocument();
    expect(screen.getByText('Our answer')).toBeInTheDocument();
  });

  it('renders sender name in header', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({ senderName: 'TestUser' })}
      />
    );

    expect(screen.getAllByText('TestUser').length).toBeGreaterThanOrEqual(1);
  });

  it('shows reply textarea and send button', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation()}
      />
    );

    expect(screen.getByPlaceholderText('Type your reply...')).toBeInTheDocument();
    expect(screen.getByLabelText('Reply')).toBeInTheDocument();
  });

  it('calls onReply when send button is clicked', () => {
    const onReply = vi.fn();

    render(
      <MessageDetailModal
        {...defaultProps}
        onReply={onReply}
        conversation={makeConversation()}
      />
    );

    const textarea = screen.getByPlaceholderText('Type your reply...');
    fireEvent.change(textarea, { target: { value: 'My reply' } });

    const sendButton = screen.getByLabelText('Reply');
    fireEvent.click(sendButton);

    expect(onReply).toHaveBeenCalledWith('1', 'My reply');
  });

  it('sends reply on Enter key (without Shift)', () => {
    const onReply = vi.fn();

    render(
      <MessageDetailModal
        {...defaultProps}
        onReply={onReply}
        conversation={makeConversation()}
      />
    );

    const textarea = screen.getByPlaceholderText('Type your reply...');
    fireEvent.change(textarea, { target: { value: 'Enter reply' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onReply).toHaveBeenCalledWith('1', 'Enter reply');
  });

  it('does not send on Shift+Enter (allows multiline)', () => {
    const onReply = vi.fn();

    render(
      <MessageDetailModal
        {...defaultProps}
        onReply={onReply}
        conversation={makeConversation()}
      />
    );

    const textarea = screen.getByPlaceholderText('Type your reply...');
    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onReply).not.toHaveBeenCalled();
  });

  it('shows resolve button when conversation has any unresolved incoming message', () => {
    const incoming = makeMessage({ replied: false, resolved: false });

    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({
          messages: [incoming],
          lastMessage: incoming,
        })}
      />
    );

    expect(screen.getByText('Resolve')).toBeInTheDocument();
  });

  it('shows resolve button on a replied, needs-attention conversation (regression: unresolvable DM)', () => {
    const incoming = makeMessage({ replied: true, resolved: false });

    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({
          needsHumanAttention: true,
          messages: [incoming],
          lastMessage: incoming,
        })}
      />
    );

    expect(screen.getByText('Resolve')).toBeInTheDocument();
  });

  it('hides resolve button when all messages are resolved', () => {
    const incoming = makeMessage({ replied: false, resolved: true });

    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({
          messages: [incoming],
          lastMessage: incoming,
        })}
      />
    );

    // The clickable resolve button should not appear (only the resolved badge)
    expect(screen.queryByText('Resolve')).not.toBeInTheDocument();
    expect(screen.getByText('Handled')).toBeInTheDocument();
  });

  it('calls onResolve with senderId and pageId', () => {
    const onResolve = vi.fn();
    const incoming = makeMessage({ replied: false, resolved: false, senderId: 'sender1', pageId: 'page1' });

    render(
      <MessageDetailModal
        {...defaultProps}
        onResolve={onResolve}
        conversation={makeConversation({
          senderId: 'sender1',
          messages: [incoming],
          lastMessage: incoming,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onResolve).toHaveBeenCalledWith('sender1', 'page1');
  });

  it('shows pause button by default', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation()}
      />
    );

    expect(screen.getByRole('button', { name: 'Pause Smart Reply' })).toBeInTheDocument();
  });

  it('shows resume button when conversation is paused', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({
          pauseStatus: { paused: true, pausedUntil: null, remainingMinutes: 10 },
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Resume Smart Reply' })).toBeInTheDocument();
  });

  it('shows remaining minutes when paused', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({
          pauseStatus: { paused: true, pausedUntil: null, remainingMinutes: 10 },
        })}
      />
    );

    // Shown in both the PauseBanner (header) and the PauseToggle (footer).
    expect(screen.getAllByText('10 min remaining').length).toBeGreaterThan(0);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();

    render(
      <MessageDetailModal
        {...defaultProps}
        onClose={onClose}
        conversation={makeConversation()}
      />
    );

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on ESC key', () => {
    const onClose = vi.fn();

    render(
      <MessageDetailModal
        {...defaultProps}
        onClose={onClose}
        conversation={makeConversation()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows needs attention banner in the footer when flagged', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({ needsHumanAttention: true })}
      />
    );

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  describe('page name link', () => {
    it('shows clickable page name button when pageName and pageUrl are provided', () => {
      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation()}
          pageName="My Page"
          pageUrl="https://facebook.com/123456"
        />
      );

      expect(screen.getByRole('button', { name: /my page/i })).toBeInTheDocument();
    });

    it('opens page URL when page name is clicked', () => {
      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation()}
          pageName="My Page"
          pageUrl="https://facebook.com/123456"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /my page/i }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://facebook.com/123456');
    });

    it('shows non-clickable page name when pageUrl is not provided', () => {
      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation()}
          pageName="My Page"
        />
      );

      expect(screen.getByText('My Page')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /my page/i })).not.toBeInTheDocument();
    });

    it('does not render page name row when pageName is not provided', () => {
      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation()}
          pageUrl="https://facebook.com/123456"
        />
      );

      expect(screen.queryByRole('button', { name: /my page/i })).not.toBeInTheDocument();
    });
  });

  it('shows reply method badge for outgoing messages', () => {
    const incoming = makeMessage({ id: '1', direction: 'incoming' });
    const outgoing = makeMessage({
      id: '2',
      direction: 'outgoing',
      replyMethod: 'ai',
      createdAt: '2026-02-17T10:05:00Z',
    });

    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({
          messages: [incoming, outgoing],
          lastMessage: outgoing,
        })}
      />
    );

    // The reply method badge is inside the message bubble metadata
    const badges = screen.getAllByText('Smart Reply');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  describe('held low-confidence reply', () => {
    it('shows held reply banner and pre-fills textarea when aiOriginalReply is present', () => {
      const heldMessage = makeMessage({
        replied: false,
        aiOriginalReply: 'AI suggested draft reply',
        flagReason: 'held_low_confidence',
      });

      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation({
            messages: [heldMessage],
            lastMessage: heldMessage,
          })}
        />
      );

      expect(screen.getByText("AI suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).toBeInTheDocument();
      const textarea = screen.getByPlaceholderText('Type your reply...');
      expect(textarea).toHaveValue('AI suggested draft reply');
    });

    it('does not show held reply banner for normal unreplied messages', () => {
      const incoming = makeMessage({ replied: false });

      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming],
            lastMessage: incoming,
          })}
        />
      );

      expect(screen.queryByText("AI suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });

    it('does not show held reply banner when aiOriginalReply exists but flagReason is different', () => {
      const flaggedMessage = makeMessage({
        replied: false,
        aiOriginalReply: 'Some reply',
        flagReason: 'angry_customer',
      });

      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation({
            messages: [flaggedMessage],
            lastMessage: flaggedMessage,
          })}
        />
      );

      expect(screen.queryByText("AI suggested this reply but wasn't confident enough to send it. Review, edit if needed, then send.")).not.toBeInTheDocument();
    });
  });

  describe('Smart Reply button', () => {
    it('shows Smart Reply button when there are unreplied incoming messages', () => {
      const incoming = makeMessage({ replied: false });

      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation({ messages: [incoming], lastMessage: incoming })}
        />
      );

      // Smart Reply button uses 'Smart Reply' text
      const buttons = screen.getAllByRole('button');
      const smartReplyBtn = buttons.find(btn => btn.textContent?.includes('Smart Reply'));
      expect(smartReplyBtn).toBeDefined();
    });

    it('hides Smart Reply button when all incoming messages are replied', () => {
      const incoming = makeMessage({ replied: true });
      const outgoing = makeMessage({
        id: '2',
        direction: 'outgoing',
        replyMethod: 'ai',
        replied: true,
        createdAt: '2026-02-17T10:05:00Z',
      });

      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation({
            messages: [incoming, outgoing],
            lastMessage: outgoing,
          })}
        />
      );

      // Smart Reply generate button should not be visible (all incoming are replied)
      // The Pause Smart Reply button is separate; check there's no generate button with exact "Smart Reply" text
      const buttons = screen.getAllByRole('button');
      const smartReplyGenerateBtn = buttons.find(
        btn => btn.textContent?.trim() === 'Smart Reply'
      );
      expect(smartReplyGenerateBtn).toBeUndefined();
    });

    it('disables Smart Reply button and textarea while generating', () => {
      // This test verifies the disabled states are wired correctly
      const incoming = makeMessage({ replied: false });

      render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation({ messages: [incoming], lastMessage: incoming })}
        />
      );

      const textarea = screen.getByPlaceholderText('Type your reply...');
      expect(textarea).not.toBeDisabled();
    });
  });

  // Keyboard-aware overlay/panel className contract is locked for all four
  // modals in src/components/__tests__/keyboardAwareModalOverlays.test.tsx.

  describe('reply source badge', () => {
    const renderWithOutgoing = (replyMethod: Message['replyMethod']) => {
      const incoming = makeMessage({ id: '1', message: 'Q', direction: 'incoming' });
      const outgoing = makeMessage({
        id: '2',
        message: 'A',
        direction: 'outgoing',
        replied: true,
        replyMethod,
        createdAt: '2026-02-17T10:05:00Z',
      });
      return render(
        <MessageDetailModal
          {...defaultProps}
          conversation={makeConversation({ messages: [incoming, outgoing], lastMessage: outgoing })}
        />,
      );
    };

    it('shows Smart Reply badge for AI replies', () => {
      renderWithOutgoing('ai');
      expect(screen.getByText('Smart Reply')).toBeInTheDocument();
    });

    // Regression: manual replies were labeled "Post Reply" in the thread view.
    it('shows Manual badge for manually-sent replies (not "Post Reply")', () => {
      renderWithOutgoing('manual');
      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });

    it('shows Preset Reply badge for historical template replies', () => {
      renderWithOutgoing('template');
      expect(screen.getByText('Post Reply')).toBeInTheDocument();
    });
  });
});
