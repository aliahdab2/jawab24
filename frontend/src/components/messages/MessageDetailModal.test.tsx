import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { MessageDetailModal } from './MessageDetailModal';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { Conversation } from './MessageCard';
import type { Message } from '@/lib/api';

vi.mock('@/lib/openExternalUrl', () => ({
  openExternalUrl: vi.fn()
}));

// Mock translation hook
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
    dateLocale: undefined,
  }),
}));

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

    expect(screen.getByPlaceholderText('messages.typeReply')).toBeInTheDocument();
    expect(screen.getByLabelText('comments.reply')).toBeInTheDocument();
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

    const textarea = screen.getByPlaceholderText('messages.typeReply');
    fireEvent.change(textarea, { target: { value: 'My reply' } });

    const sendButton = screen.getByLabelText('comments.reply');
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

    const textarea = screen.getByPlaceholderText('messages.typeReply');
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

    const textarea = screen.getByPlaceholderText('messages.typeReply');
    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onReply).not.toHaveBeenCalled();
  });

  it('shows resolve button when conversation has unresolved unreplied messages', () => {
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

    expect(screen.getByText('comments.resolve')).toBeInTheDocument();
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
    expect(screen.queryByText('comments.resolve')).not.toBeInTheDocument();
    expect(screen.getByText('messages.resolved')).toBeInTheDocument();
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

    fireEvent.click(screen.getByText('comments.resolve'));
    expect(onResolve).toHaveBeenCalledWith('sender1', 'page1');
  });

  it('shows pause button by default', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation()}
      />
    );

    expect(screen.getByRole('button', { name: 'messages.pauseSmartReply' })).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: 'messages.resumeSmartReply' })).toBeInTheDocument();
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

    expect(screen.getByText('messages.smartReplyPausedRemaining')).toBeInTheDocument();
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

    fireEvent.click(screen.getByLabelText('comments.close'));
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

  it('shows needs attention badge when flagged', () => {
    render(
      <MessageDetailModal
        {...defaultProps}
        conversation={makeConversation({ needsHumanAttention: true })}
      />
    );

    expect(screen.getByText('messages.needsHuman')).toBeInTheDocument();
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

    expect(screen.getByText('dashboard.aiReply')).toBeInTheDocument();
  });
});
