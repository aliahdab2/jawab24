import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Page, UsageSummary } from '@jawab24/shared';
import { SetupChecklistCard } from './SetupChecklistCard';

const LONG_KB = 'x'.repeat(80); // exactly the KB_MIN_CHARS threshold

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1',
    name: 'My Page',
    facebookPageId: 'fb1',
    autoReplyEnabled: false,
    knowledgeBase: null,
    repliesCount: 0,
    isConnected: true,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Page;
}

function makeUsage(usedReplies = 0): UsageSummary {
  return {
    currentPeriod: { start: '2026-06-01', end: '2026-06-30' },
    aiReplies: { used: usedReplies, limit: 1000, remaining: 1000 - usedReplies, percentUsed: 0 },
    pages: { used: 1, limit: 5, remaining: 4 },
    subscription: { plan: { slug: 'starter' }, status: 'active' },
  } as UsageSummary;
}

describe('SetupChecklistCard', () => {
  beforeEach(() => localStorage.clear());

  it('shows the two paths once a page is connected — quick Post Reply CTA + smart-path links', () => {
    const onTry = vi.fn();
    render(<SetupChecklistCard pages={[makePage()]} usage={makeUsage(0)} onTryPostReply={onTry} />);

    expect(screen.getByText('Start replying automatically')).toBeInTheDocument();
    // Quick path: Post Reply, one button, opens the post picker
    expect(screen.getByText('Post Reply — ready in a minute')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a post' }));
    expect(onTry).toHaveBeenCalledTimes(1);
    // Smart path: the two actionable steps with their deep links
    expect(screen.getByText('Smart Replies — AI answers for you')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add your Business Info/ })).toHaveAttribute('href', '/pages?openKb=true');
    expect(screen.getByRole('link', { name: 'Turn on auto-reply' })).toHaveAttribute('href', '/settings');
    // The passive "first reply" step is no longer part of the panel
    expect(screen.queryByRole('link', { name: 'Try your first reply' })).not.toBeInTheDocument();
  });

  // THE D-026 regression: page-level toggle ON but workspace masters OFF (the
  // new-signup default) must NOT count as "auto-reply on" — the old checklist
  // showed the step done and hid itself while the pipeline was gated off.
  it('keeps the enable step pending when page-level is ON but the workspace masters are OFF', () => {
    const pageLevelOn = makePage({ knowledgeBase: LONG_KB, autoReplyEnabled: true });
    render(
      <SetupChecklistCard
        pages={[pageLevelOn]}
        usage={makeUsage(0)}
        masters={{ commentsAutoReply: false, messagesAutoReply: false }}
      />,
    );
    // Panel stays visible, enable step is still an actionable link
    expect(screen.getByRole('link', { name: 'Turn on auto-reply' })).toHaveAttribute('href', '/settings');
  });

  it('hides once a master is ON with page-level enabled and business info filled (smart path live)', () => {
    const pageLevelOn = makePage({ knowledgeBase: LONG_KB, autoReplyEnabled: true });
    const { container } = render(
      <SetupChecklistCard
        pages={[pageLevelOn]}
        usage={makeUsage(0)}
        masters={{ commentsAutoReply: true, messagesAutoReply: false }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hides once a Post Reply trigger is configured (quick path live, D-027)', () => {
    const withTrigger = makePage({ hasPostReplyTrigger: true });
    const { container } = render(<SetupChecklistCard pages={[withTrigger]} usage={makeUsage(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides itself entirely once all four steps are complete', () => {
    const donePage = makePage({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 3 });
    const { container } = render(<SetupChecklistCard pages={[donePage]} usage={makeUsage(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides once the three active steps are done, even before a first reply lands', () => {
    // page + business info + auto-reply on, but NO reply yet. `firstReplySent` is
    // passive, so the card hands its slot to the Post Reply nudge at this point
    // rather than lingering on a task the merchant can't directly complete.
    const coreDone = makePage({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 0 });
    const { container } = render(<SetupChecklistCard pages={[coreDone]} usage={makeUsage(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts first reply from monthly usage when no per-page reply count exists', () => {
    // KB filled + auto-reply on + a reply sent THIS MONTH (usage) but repliesCount=0
    const page = makePage({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 0 });
    const { container } = render(<SetupChecklistCard pages={[page]} usage={makeUsage(5)} />);
    expect(container).toBeEmptyDOMElement(); // all 4 done → hidden
  });

  it('requires >= 80 KB chars for the business-info step', () => {
    const shortKb = makePage({ knowledgeBase: 'x'.repeat(79), autoReplyEnabled: true });
    render(<SetupChecklistCard pages={[shortKb]} usage={makeUsage(0)} />);
    // KB step still incomplete (79 < 80) → rendered as a link
    expect(screen.getByRole('link', { name: /Add your Business Info/ })).toBeInTheDocument();
  });

  it('can be dismissed, persisting to localStorage', () => {
    const { container, rerender } = render(<SetupChecklistCard pages={[makePage()]} usage={makeUsage(0)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container).toBeEmptyDOMElement();
    expect(localStorage.getItem('setupChecklistDismissedAt')).toBeTruthy();
    // Stays hidden on re-render (reads localStorage synchronously)
    rerender(<SetupChecklistCard pages={[makePage()]} usage={makeUsage(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('with zero pages collapses to the single connect step linking /pages', () => {
    render(<SetupChecklistCard pages={[]} usage={null} />);
    expect(screen.getByRole('link', { name: 'Connect your page' })).toHaveAttribute('href', '/pages');
    // No path cards before a page exists
    expect(screen.queryByText('Post Reply — ready in a minute')).not.toBeInTheDocument();
  });

  it('does NOT count a disconnected page as connected', () => {
    // A merchant who connected then lost FB access (isConnected:false) has no
    // effective setup — the panel must collapse back to the connect step.
    render(<SetupChecklistCard pages={[makePage({ isConnected: false, knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 5 })]} usage={makeUsage(0)} />);
    expect(screen.getByRole('link', { name: 'Connect your page' })).toBeInTheDocument();
    expect(screen.queryByText('Post Reply — ready in a minute')).not.toBeInTheDocument();
  });

  it('marks the KB step done when ANY connected page has filled business info', () => {
    // Mixed pages: one with a full KB, one empty. The `.some()` rule → KB step done.
    const filled = makePage({ id: 'p1', knowledgeBase: LONG_KB });
    const empty = makePage({ id: 'p2', knowledgeBase: null });
    render(<SetupChecklistCard pages={[filled, empty]} usage={makeUsage(0)} />);
    expect(screen.queryByRole('link', { name: /Add your Business Info/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on auto-reply' })).toBeInTheDocument();
  });

  it('does NOT mark KB done for shallow auto-synced info (knowledgeBase === suggestedKnowledgeBase)', () => {
    // First Facebook sync writes the same generated text into both fields. That is
    // not merchant-provided info, so the step must stay incomplete (the core fix).
    const autoSynced = makePage({ knowledgeBase: LONG_KB, suggestedKnowledgeBase: LONG_KB });
    render(<SetupChecklistCard pages={[autoSynced]} usage={makeUsage(0)} />);
    expect(screen.getByRole('link', { name: /Add your Business Info/ })).toBeInTheDocument();
  });

  it('marks KB done once the merchant enriches it beyond the Facebook snapshot', () => {
    const enriched = makePage({ knowledgeBase: `${LONG_KB} real merchant details`, suggestedKnowledgeBase: LONG_KB });
    render(<SetupChecklistCard pages={[enriched]} usage={makeUsage(0)} />);
    expect(screen.queryByRole('link', { name: /Add your Business Info/ })).not.toBeInTheDocument();
  });

  it('emphasizes the Business Info step with a "Most important" badge while incomplete', () => {
    render(<SetupChecklistCard pages={[makePage()]} usage={makeUsage(0)} />);
    expect(screen.getByText('Most important')).toBeInTheDocument();
  });
});
