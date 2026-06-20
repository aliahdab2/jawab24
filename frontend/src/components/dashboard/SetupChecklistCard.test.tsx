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

  it('shows progress and renders incomplete steps as links, completed steps as done', () => {
    // Only "connect" is done (1 page exists); the other three are incomplete.
    render(<SetupChecklistCard pages={[makePage()]} usage={makeUsage(0)} />);

    expect(screen.getByText('Finish your setup (1/4)')).toBeInTheDocument();
    // Completed step is NOT a link (just a done row)
    expect(screen.queryByRole('link', { name: 'Connect your page' })).not.toBeInTheDocument();
    // Incomplete steps are actionable links pointing at the right routes
    // The Business Info link carries an extra "Most important" badge + hint, so its
    // accessible name is a superset of the label — match by substring.
    expect(screen.getByRole('link', { name: /Add your Business Info/ })).toHaveAttribute('href', '/pages?openKb=true');
    expect(screen.getByRole('link', { name: 'Turn on auto-reply' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'See your first reply' })).toHaveAttribute('href', '/comments');
  });

  it('hides itself entirely once all four steps are complete', () => {
    const donePage = makePage({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 3 });
    const { container } = render(<SetupChecklistCard pages={[donePage]} usage={makeUsage(0)} />);
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

  it('with zero pages shows 0/4 and links the connect step to /pages', () => {
    render(<SetupChecklistCard pages={[]} usage={null} />);
    expect(screen.getByText('Finish your setup (0/4)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect your page' })).toHaveAttribute('href', '/pages');
  });

  it('does NOT count a disconnected page as connected', () => {
    // A merchant who connected then lost FB access (isConnected:false) has no
    // effective setup — every step, including "connect", must read incomplete.
    render(<SetupChecklistCard pages={[makePage({ isConnected: false, knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 5 })]} usage={makeUsage(0)} />);
    expect(screen.getByText('Finish your setup (0/4)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect your page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add your Business Info/ })).toBeInTheDocument();
  });

  it('marks the KB step done when ANY connected page has filled business info', () => {
    // Mixed pages: one with a full KB, one empty. The `.some()` rule → KB step done.
    const filled = makePage({ id: 'p1', knowledgeBase: LONG_KB });
    const empty = makePage({ id: 'p2', knowledgeBase: null });
    render(<SetupChecklistCard pages={[filled, empty]} usage={makeUsage(0)} />);
    expect(screen.getByText('Finish your setup (2/4)')).toBeInTheDocument(); // connect + kb
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
