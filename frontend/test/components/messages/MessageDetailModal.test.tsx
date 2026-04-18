import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageDetailModal } from '@/components/messages/MessageDetailModal';
import type { Conversation } from '@/components/messages/MessageCard';
import type { Message } from '@/lib/api';

// next-intl, next/router, useLocale mocked globally via test/setup.ts

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useEscapeKey', () => ({ useEscapeKey: vi.fn() }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: vi.fn() }));
vi.mock('@/hooks/useModalBackHandler', () => ({ useModalBackHandler: vi.fn() }));
vi.mock('@/hooks/useAiGeneration', () => ({
  useAiGeneration: () => ({
    isGenerating: false,
    generationStatus: null,
    aiLimit: { allowed: true },
    generatedReply: null,
    generate: vi.fn(),
  }),
}));
vi.mock('@/lib/api', () => ({
  messagesApi: {
    getConversation: vi.fn().mockResolvedValue({ data: [] }),
    sendReply: vi.fn(),
  },
}));
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, createPortal: (node: React.ReactNode) => node };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const now = new Date().toISOString();

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm-1',
    pageId: 'page-1',
    platformMessageId: 'pm-1',
    senderId: 'sender-1',
    senderName: 'Test User',
    message: 'Hello',
    direction: 'incoming',
    replied: false,
    replyText: null,
    replyMethod: null,
    createdTime: now,
    repliedAt: null,
    createdAt: now,
    flagReason: null,
    needsAttention: false,
    ...overrides,
  };
}

function makeConversation(lastMessage: Message, overrides: Partial<Conversation> = {}): Conversation {
  return {
    senderId: 'sender-1',
    senderName: 'Test User',
    messages: [lastMessage],
    lastMessage,
    // A KB-flagged message inherently needs human attention (the AI couldn't answer).
    // The NeedsAttentionBanner, which hosts the "Add to Business Info" link, only
    // renders when this is true — so default accordingly.
    needsHumanAttention: !!lastMessage.flagReason,
    ...overrides,
  };
}

const defaultProps = {
  onClose: vi.fn(),
  onReply: vi.fn(),
  onResolve: vi.fn(),
  onUnresolve: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  isReplying: false,
  isPausing: false,
  isResuming: false,
};

describe('MessageDetailModal — KB nudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Add to Business Info" link when lastMessage flag is info_not_in_kb', () => {
    const msg = makeMessage({ flagReason: 'info_not_in_kb' });
    const conv = makeConversation(msg);
    render(<MessageDetailModal {...defaultProps} conversation={conv} />);
    expect(screen.getByText('Add to Business Info')).toBeInTheDocument();
  });

  it('shows "Add to Business Info" link when lastMessage flag is price_not_in_kb', () => {
    const msg = makeMessage({ flagReason: 'price_not_in_kb' });
    const conv = makeConversation(msg);
    render(<MessageDetailModal {...defaultProps} conversation={conv} />);
    expect(screen.getByText('Add to Business Info')).toBeInTheDocument();
  });

  it('does NOT show "Add to Business Info" link for non-KB flags', () => {
    const msg = makeMessage({ flagReason: 'low_confidence' });
    const conv = makeConversation(msg);
    render(<MessageDetailModal {...defaultProps} conversation={conv} />);
    expect(screen.queryByText('Add to Business Info')).not.toBeInTheDocument();
  });

  it('does NOT show "Add to Business Info" link when an urgent flag takes priority over a KB flag', () => {
    const msg = makeMessage({ flagReason: 'info_not_in_kb,cancellation_request' });
    const conv = makeConversation(msg);
    render(<MessageDetailModal {...defaultProps} conversation={conv} />);
    expect(screen.queryByText('Add to Business Info')).not.toBeInTheDocument();
  });

  it('does NOT show "Add to Business Info" link when flagReason is null', () => {
    const msg = makeMessage({ flagReason: null });
    const conv = makeConversation(msg);
    render(<MessageDetailModal {...defaultProps} conversation={conv} />);
    expect(screen.queryByText('Add to Business Info')).not.toBeInTheDocument();
  });

  it('"Add to Business Info" link points to pages?openKb=true', () => {
    const msg = makeMessage({ flagReason: 'price_not_in_kb' });
    const conv = makeConversation(msg);
    render(<MessageDetailModal {...defaultProps} conversation={conv} />);
    const link = screen.getByText('Add to Business Info').closest('a');
    expect(link?.getAttribute('href')).toContain('openKb=true');
  });
});
