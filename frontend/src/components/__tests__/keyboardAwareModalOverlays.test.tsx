import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Comment, Conversation, Page } from '@jawab24/shared';

import { CommentDetailModal } from '@/components/comments/CommentDetailModal';
import { MessageDetailModal } from '@/components/messages/MessageDetailModal';
import { KnowledgeBaseModal } from '@/components/knowledge-base/KnowledgeBaseModal';
import { TestSmartReplyModal } from '@/components/test-smart-reply/TestSmartReplyModal';

/**
 * Cross-modal regression guard for the keyboard-aware overlay contract.
 *
 * Bug history:
 *   1. paddingBottom: var(--keyboard-height) on a `fixed inset-0` overlay
 *      collided with `.is-android .modal-overlay { height: 100dvh }` in
 *      globals.css → modal anchored at viewport − 2 × keyboardHeight,
 *      exposing a dimmed strip behind the panel.
 *   2. After switching to bottom-[…], `max-h-full` on the panel resolved
 *      against an indefinite parent height in Chromium and collapsed to
 *      `none`, leaving the panel content-sized and unable to fill the
 *      keyboard-aware overlay.
 *
 * Single source of truth for the className contract on all four
 * keyboard-aware modals. Geometric verification lives in
 * e2e/keyboard-modal-layout.spec.ts.
 */

vi.mock('@/lib/api', () => ({
  commentsApi: { reply: vi.fn(), resolve: vi.fn() },
  messagesApi: {
    getPauseStatus: vi.fn().mockRejectedValue(new Error('not found')),
    pauseConversation: vi.fn(),
    resumeConversation: vi.fn(),
    sendReply: vi.fn(),
  },
  pagesApi: {
    getKbGaps: vi.fn().mockResolvedValue({ data: { data: [] } }),
    dismissGap: vi.fn(),
  },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ data: { handoffPauseDurationMinutes: 15 } }),
  },
  authApi: { getProfile: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));

const renderWithQuery = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

const mockComment: Comment = {
  id: 'c1',
  postId: 'p1',
  pageId: 'page1',
  message: 'Hello',
  createdAt: new Date().toISOString(),
  replied: false,
  fromName: 'Test User',
  replyText: null,
  replyMethod: null,
  detectedLanguage: 'en',
};

const incomingMessage = {
  id: '1',
  pageId: 'page1',
  platformMessageId: 'fb1',
  senderId: 'sender1',
  senderName: 'Ali',
  message: 'Hello',
  direction: 'incoming' as const,
  replied: false,
  replyText: null,
  replyMethod: null,
  createdTime: null,
  repliedAt: null,
  createdAt: '2026-02-17T10:00:00Z',
  resolved: false,
};

const mockConversation: Conversation = {
  senderId: 'sender1',
  senderName: 'Ali',
  messages: [incomingMessage],
  lastMessage: incomingMessage,
  needsHumanAttention: false,
} as unknown as Conversation;

const mockPage: Page = {
  id: 'page1',
  facebookPageId: 'fb1',
  name: 'Test Page',
  autoReplyEnabled: true,
  knowledgeBase: '',
} as unknown as Page;

const expectKeyboardAwareOverlay = () => {
  const overlay = document.querySelector('.modal-overlay');
  expect(overlay, 'each keyboard-aware modal must render a .modal-overlay element').toBeTruthy();
  const overlayClass = overlay?.getAttribute('class') ?? '';

  // Overlay required: positions the bottom edge above the soft keyboard.
  expect(overlayClass).toContain('bottom-[var(--keyboard-height,0px)]');
  // Overlay forbidden: legacy inset-0 + padding-based compensation patterns.
  expect(overlayClass).not.toMatch(/\binset-0\b/);
  const inlineStyle = overlay?.getAttribute('style') ?? '';
  expect(inlineStyle).not.toContain('padding-bottom');
  expect(inlineStyle).not.toContain('--keyboard-height');

  // Panel required: keyboard-aware sizing via calc(). Percentage max-h-full
  // resolves indefinitely against the bottom-anchored overlay parent and
  // collapses to `none`, so the panel can't fill the keyboard-aware area.
  const panel = overlay?.querySelector('[class*="bg-card"]');
  expect(panel, 'each modal must render a .bg-card panel inside the overlay').toBeTruthy();
  const panelClass = panel?.getAttribute('class') ?? '';
  expect(panelClass).toMatch(/\b(?:max-)?h-\[calc\(100vh-var\(--keyboard-height,0px\)\)\]/);
  expect(panelClass).not.toMatch(/\bmax-h-full\b/);
};

describe('keyboard-aware modal overlay contract', () => {
  afterEach(() => {
    cleanup();
  });

  it('CommentDetailModal overlay uses bottom-[--keyboard-height] (not paddingBottom + inset-0)', () => {
    renderWithQuery(
      <CommentDetailModal comment={mockComment} onClose={vi.fn()} onReplySuccess={vi.fn()} />
    );
    expectKeyboardAwareOverlay();
  });

  it('MessageDetailModal overlay uses bottom-[--keyboard-height] (not paddingBottom + inset-0)', () => {
    renderWithQuery(
      <MessageDetailModal
        conversation={mockConversation}
        isOpen={true}
        onClose={vi.fn()}
        onReplySuccess={vi.fn()}
      />
    );
    expectKeyboardAwareOverlay();
  });

  it('KnowledgeBaseModal overlay uses bottom-[--keyboard-height] (not paddingBottom + inset-0)', () => {
    renderWithQuery(
      <KnowledgeBaseModal
        page={mockPage}
        onClose={vi.fn()}
        onSave={vi.fn()}
        saving={false}
        saved={false}
      />
    );
    expectKeyboardAwareOverlay();
  });

  it('TestSmartReplyModal overlay uses bottom-[--keyboard-height] (not paddingBottom + inset-0)', () => {
    renderWithQuery(<TestSmartReplyModal page={mockPage} onClose={vi.fn()} />);
    expectKeyboardAwareOverlay();
  });

  // Regression: the modal auto-expands the first empty section on open. If
  // the textarea inside that section auto-focuses on `isExpanded` change,
  // the soft keyboard pops up before the user has interacted with anything
  // — wrong UX. Focus is only valid when triggered by a user click event.
  it('KnowledgeBaseModal does not auto-focus any input on mount', () => {
    renderWithQuery(
      <KnowledgeBaseModal
        page={mockPage}
        onClose={vi.fn()}
        onSave={vi.fn()}
        saving={false}
        saved={false}
      />
    );
    const active = document.activeElement;
    expect(active?.tagName).not.toBe('TEXTAREA');
    expect(active?.tagName).not.toBe('INPUT');
  });

  // Counterpart to the above: when the user explicitly clicks a section
  // header to expand it, focus IS expected (so they can type immediately).
  // This is implemented in handleToggle via requestAnimationFrame, NOT as a
  // useEffect side-effect on isExpanded.
  it('KnowledgeBaseModal focuses the section textarea when the user clicks a section header', async () => {
    renderWithQuery(
      <KnowledgeBaseModal
        page={mockPage}
        onClose={vi.fn()}
        onSave={vi.fn()}
        saving={false}
        saved={false}
      />
    );

    // Find a collapsed section's toggle button. The first empty section is
    // auto-expanded on mount, so click any other section's toggle.
    const sectionWrappers = document.querySelectorAll('[data-section-id]');
    expect(sectionWrappers.length).toBeGreaterThan(1);
    let collapsedToggle: HTMLButtonElement | null = null;
    for (const w of Array.from(sectionWrappers)) {
      const btn = w.querySelector<HTMLButtonElement>('button[type="button"]');
      const ta = w.querySelector('textarea');
      if (btn && !ta) {
        collapsedToggle = btn;
        break;
      }
    }
    expect(collapsedToggle, 'expected at least one collapsed section to test click-to-focus').toBeTruthy();

    await act(async () => {
      collapsedToggle?.click();
      // handleToggle uses requestAnimationFrame to focus after the section
      // re-renders with its textarea mounted.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });
});
