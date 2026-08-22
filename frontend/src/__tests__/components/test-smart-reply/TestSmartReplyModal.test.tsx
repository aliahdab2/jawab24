import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TestSmartReplyModal } from '@/components/test-smart-reply/TestSmartReplyModal';
import { pagesApi } from '@/lib/api';
import type { Page } from '@jawab24/shared';

vi.mock('@/lib/api', () => ({
  pagesApi: { testReply: vi.fn() },
}));
vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));

/**
 * The wire contract for the reply-mode preview (D-087).
 *
 * This modal had NO tests, so the one line that puts the drafted mode on the
 * request could be deleted and the whole suite stayed green with the feature
 * silently inert — a merchant picks «مصدر معلومات», presses Test, and reads a
 * reply generated under the mode they are trying to leave. The card's own tests
 * assert the prop reaches a STUB; only this file asserts it reaches the server.
 */
const PAGE = { id: 'page-1', name: 'Resort Page' } as Page;

const reply = {
  data: {
    data: {
      reply: 'أهلاً! للحجز تواصلوا معنا على 0189955.',
      replyMethod: 'ai',
      intent: 'PRODUCT_INQUIRY',
      confidence: 'high',
      flags: [],
      cached: false,
      latencyMs: 12,
    },
  },
};

const ask = async (text = 'كم السعر؟') => {
  const box = screen.getByRole('textbox');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(vi.mocked(pagesApi.testReply)).toHaveBeenCalled());
  return vi.mocked(pagesApi.testReply).mock.calls[0][1] as Record<string, unknown>;
};

describe('TestSmartReplyModal — reply-mode override on the wire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pagesApi.testReply).mockResolvedValue(reply as never);
  });

  it('sends the drafted mode when the card passes one', async () => {
    render(<TestSmartReplyModal page={PAGE} replyMode="info" onClose={vi.fn()} />);
    expect(await ask()).toMatchObject({ replyMode: 'info' });
  });

  // The mutation this kills: `...(replyMode ? { replyMode } : { replyMode: 'sales' })`.
  // A default would force sales over a page's own 'info' pin, so the merchant
  // would preview a reply that page never produces.
  it('omits the key entirely when the card passes none', async () => {
    render(<TestSmartReplyModal page={PAGE} onClose={vi.fn()} />);
    expect(await ask()).not.toHaveProperty('replyMode');
  });

  it('still sends the question and channel it always did', async () => {
    render(<TestSmartReplyModal page={PAGE} replyMode="sales" onClose={vi.fn()} />);
    const body = await ask('عندكم توصيل؟');
    expect(body).toMatchObject({ question: 'عندكم توصيل؟', channel: 'dm', replyMode: 'sales' });
  });
});

describe('TestSmartReplyModal — composer above the safe area', () => {
  // The footer carried a fixed `pb-4`, so on a native device — where the sheet
  // is full-height — the composer sat 16px from the system bar, flush on the
  // safe area (reported 2026-08-22). `pb-safe-modal` is the one class that adds
  // --sai-bottom on native and collapses under the keyboard; every sibling
  // modal footer (MessageDetailModal, CommentDetailModal) uses it. A `md:pb-*`
  // next to it would be dead: .pb-safe-modal is emitted after the utilities.
  it('pads the footer with pb-safe-modal and no fixed bottom padding', () => {
    render(<TestSmartReplyModal page={PAGE} onClose={vi.fn()} />);
    const footer = screen.getByRole('textbox').closest('.border-t') as HTMLElement;
    expect(footer.className).toContain('pb-safe-modal');
    expect(footer.className).not.toMatch(/\bpb-\d/);
    expect(footer.className).not.toMatch(/\bmd:pb-\d/);
  });
});
