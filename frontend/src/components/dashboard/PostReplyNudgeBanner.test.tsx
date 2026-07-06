import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Page, UsageSummary } from '@jawab24/shared';
import { PostReplyNudgeBanner } from './PostReplyNudgeBanner';

const LONG_KB = 'x'.repeat(80);

// A fully set-up, connected page with no Post Reply trigger yet — the state in which
// the nudge should appear.
function readyPage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1',
    name: 'My Page',
    facebookPageId: 'fb1',
    autoReplyEnabled: true,
    knowledgeBase: LONG_KB,
    repliesCount: 3,
    isConnected: true,
    hasPostReplyTrigger: false,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Page;
}

function usage(): UsageSummary {
  return {
    currentPeriod: { start: '2026-06-01', end: '2026-06-30' },
    aiReplies: { used: 10, limit: 1000, remaining: 990, percentUsed: 1 },
    pages: { used: 1, limit: 5, remaining: 4 },
    subscription: { plan: { slug: 'starter' }, status: 'active' },
  } as UsageSummary;
}

describe('PostReplyNudgeBanner', () => {
  beforeEach(() => localStorage.clear());

  it('appears once setup is complete and no post has a trigger yet', () => {
    render(<PostReplyNudgeBanner pages={[readyPage()]} usage={usage()} isOwner onTry={vi.fn()} />);
    expect(screen.getByText('Try Post Reply')).toBeInTheDocument();
  });

  it('is hidden while setup is incomplete', () => {
    // Auto-reply off → setup not done.
    const { container } = render(
      <PostReplyNudgeBanner pages={[readyPage({ autoReplyEnabled: false })]} usage={usage()} isOwner onTry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden once a post already has a Post Reply trigger', () => {
    const { container } = render(
      <PostReplyNudgeBanner pages={[readyPage({ hasPostReplyTrigger: true })]} usage={usage()} isOwner onTry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden for non-owners', () => {
    const { container } = render(
      <PostReplyNudgeBanner pages={[readyPage()]} usage={usage()} isOwner={false} onTry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onTry when the CTA is clicked', () => {
    const onTry = vi.fn();
    render(<PostReplyNudgeBanner pages={[readyPage()]} usage={usage()} isOwner onTry={onTry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a post' }));
    expect(onTry).toHaveBeenCalledTimes(1);
  });

  it('disappears after being dismissed', () => {
    render(<PostReplyNudgeBanner pages={[readyPage()]} usage={usage()} isOwner onTry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Try Post Reply')).not.toBeInTheDocument();
  });
});
