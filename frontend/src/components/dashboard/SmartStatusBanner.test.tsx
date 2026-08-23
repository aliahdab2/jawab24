import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Comment } from '@jawab24/shared';
import { SmartStatusBanner, type NeedsAttentionItem } from './SmartStatusBanner';

function makeMessageItem(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: '1',
    type: 'message',
    senderName: 'Ali',
    text: 'What are your packages?',
    createdAt: '2026-03-01T10:00:00Z',
    flagReason: null,
    href: '/messages?filter=needs_action',
    senderId: 'sender1',
    pageId: 'page1',
    ...overrides,
  };
}

function makeCommentItem(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: 'c1',
    type: 'comment',
    senderName: 'Sara',
    text: 'Is this available?',
    createdAt: '2026-03-01T10:00:00Z',
    flagReason: null,
    href: '/comments?filter=needs_action',
    commentData: { id: 'c1', message: 'Is this available?' } as Comment,
    ...overrides,
  };
}

function renderMultiChannelBanner(items: NeedsAttentionItem[]) {
  const result = render(
    <SmartStatusBanner
      commentNeedsAction={items.filter(i => i.type === 'comment').length}
      messageNeedsAction={items.filter(i => i.type === 'message').length}
      items={items}
      onItemClick={vi.fn()}
      showChannelBadge
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
  return result;
}

function renderBanner(
  items: NeedsAttentionItem[],
  onClick = vi.fn(),
  counts?: { comments?: number; messages?: number },
) {
  const commentCount = counts?.comments ?? items.filter(i => i.type === 'comment').length;
  const messageCount = counts?.messages ?? items.filter(i => i.type === 'message').length;
  return render(
    <SmartStatusBanner
      commentNeedsAction={commentCount}
      messageNeedsAction={messageCount}
      items={items}
      onItemClick={onClick}
    />,
  );
}

describe('SmartStatusBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the correct attention count in the header button aria-label', () => {
    renderBanner([makeMessageItem(), makeMessageItem({ id: '2' })]);
    expect(screen.getByRole('button', { name: /2 items need your attention/i })).toBeInTheDocument();
  });

  it('renders items in the DOM after expanding', () => {
    renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('What are your packages?')).toBeInTheDocument();
  });

  // Regression: bug where comma-separated flagReason was passed directly to
  // the translator, rendering raw "flagReason.info_not_in_kb,low_confidence"
  it('shows translated primary flag label for comma-separated flagReason', () => {
    renderBanner([makeMessageItem({ flagReason: 'info_not_in_kb,low_confidence' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('Please add info')).toBeInTheDocument();
    expect(screen.queryByText(/info_not_in_kb,low_confidence/)).not.toBeInTheDocument();
    expect(screen.queryByText(/flagReason\./)).not.toBeInTheDocument();
  });

  it('shows translated label for single flag', () => {
    renderBanner([makeMessageItem({ flagReason: 'angry_customer' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('Angry customer')).toBeInTheDocument();
  });

  it('does not show a flag tag for sla_no_reply (default reason)', () => {
    renderBanner([makeMessageItem({ flagReason: 'sla_no_reply:60' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.queryByText(/sla_no_reply/)).not.toBeInTheDocument();
  });

  it('calls onItemClick when a message item is clicked', () => {
    const onClick = vi.fn();
    renderBanner([makeMessageItem()], onClick);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    fireEvent.click(screen.getByText('What are your packages?'));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1', type: 'message' }));
  });

  it('calls onItemClick when a comment item with commentData is clicked', () => {
    const onClick = vi.fn();
    renderBanner([makeCommentItem()], onClick);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    fireEvent.click(screen.getByText('Is this available?'));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', type: 'comment' }));
  });

  it('renders a link (not a button) for a comment item without commentData', () => {
    renderBanner([makeCommentItem({ commentData: undefined })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    const item = screen.getByText('Is this available?').closest('a');
    expect(item).toHaveAttribute('href', '/comments?filter=needs_action');
  });

  // --- Dismiss behavior ---

  it('hides banner after clicking the dismiss button', () => {
    renderBanner([makeMessageItem()]);
    // Banner should be visible
    expect(screen.getByRole('button', { name: /item.*need.*attention/i })).toBeInTheDocument();

    // Click the dismiss X button
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButton);

    // Banner should be gone
    expect(screen.queryByRole('button', { name: /item.*need.*attention/i })).not.toBeInTheDocument();
  });

  it('stays hidden on re-render after dismiss (localStorage persistence)', () => {
    const { unmount } = renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();

    // Re-render with the same count — should still be hidden
    renderBanner([makeMessageItem()]);
    expect(screen.queryByRole('button', { name: /item.*need.*attention/i })).not.toBeInTheDocument();
  });

  it('re-shows banner when item count increases after dismiss', () => {
    // Render with 1 item, dismiss
    const { unmount } = renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();

    // Re-render with 2 items (count increased) — should re-show
    renderBanner([makeMessageItem(), makeCommentItem()]);
    expect(screen.getByRole('button', { name: /item.*need.*attention/i })).toBeInTheDocument();
  });

  it('stays hidden when item count decreases after dismiss', () => {
    // Render with 2 items, dismiss
    const { unmount } = renderBanner(
      [makeMessageItem(), makeCommentItem()],
      vi.fn(),
      { comments: 1, messages: 1 },
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();

    // Re-render with 1 item (count decreased) — should stay hidden
    renderBanner([makeMessageItem()]);
    expect(screen.queryByRole('button', { name: /item.*need.*attention/i })).not.toBeInTheDocument();
  });

  it('re-shows banner after 24-hour dismiss period expires', () => {
    renderBanner([makeMessageItem()]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    // Fast-forward localStorage timestamp to > 24 hours ago
    const stored = JSON.parse(localStorage.getItem('smartBannerDismissedAt')!);
    stored.dismissedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem('smartBannerDismissedAt', JSON.stringify(stored));

    // Re-render — 24h expired, should re-show
    renderBanner([makeMessageItem()]);
    expect(screen.getByRole('button', { name: /item.*need.*attention/i })).toBeInTheDocument();
  });

  it('has a visible dismiss button with correct aria-label', () => {
    renderBanner([makeMessageItem()]);
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    expect(dismissButton).toBeInTheDocument();
  });

  // The leads row: a workspace-wide queue of customers who left a phone number.
  // Regression origin (2026-08-04): a paying merchant had 19 unworked leads and
  // NOTHING on the dashboard mentioned them.
  describe('leads row', () => {
    const renderWithLeads = (
      leads: { count: number; latestName: string | null; latestAt: string | null; oldestAt?: string | null },
      items: NeedsAttentionItem[] = [],
      counts?: { comments?: number; messages?: number },
    ) =>
      render(
        <SmartStatusBanner
          commentNeedsAction={counts?.comments ?? items.filter(i => i.type === 'comment').length}
          messageNeedsAction={counts?.messages ?? items.filter(i => i.type === 'message').length}
          leads={leads}
          items={items}
        />,
      );

    it('shows the banner for leads ALONE (no comments or messages)', () => {
      renderWithLeads({ count: 19, latestName: 'Feras', latestAt: '2026-08-04T13:22:00Z' });
      expect(screen.getByRole('button', { name: /19 items need your attention/i })).toBeInTheDocument();
    });

    it('counts leads into the header total alongside comments and messages', () => {
      renderWithLeads(
        { count: 19, latestName: null, latestAt: null },
        [makeMessageItem(), makeCommentItem()],
      );
      expect(screen.getByRole('button', { name: /21 items need your attention/i })).toBeInTheDocument();
    });

    it('renders ONE aggregate row linking to /leads, never one row per lead', () => {
      renderWithLeads({ count: 19, latestName: 'Feras', latestAt: '2026-08-04T13:22:00Z' });
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));

      const leadLinks = screen.getAllByRole('link').filter(a => a.getAttribute('href') === '/leads');
      expect(leadLinks).toHaveLength(1);
      // Matches `smartBanner.leadsWaiting` as SHIPPED. The mobile-truncation fix
      // shortened this copy ("…left their number and are waiting" → "…waiting for
      // contact") and this assertion was left on the old wording, so the suite was
      // red on the branch. Keep the two in step.
      expect(screen.getByText(/19 customers waiting for contact/i)).toBeInTheDocument();
    });

    // The chip shows how long the queue's WORST case has waited. Showing the
    // newest arrival instead reads "1 minute ago" over a ten-day backlog, which
    // inverts the urgency this row exists to convey. Matches the sibling
    // comment/message rows, which render `earliestAt` with the same label.
    it('shows how long the OLDEST lead has waited, not the newest arrival', () => {
      const now = Date.now();
      renderWithLeads({
        count: 19,
        latestName: 'Feras',
        latestAt: new Date(now - 5 * 60_000).toISOString(),        // 5 minutes ago
        oldestAt: new Date(now - 10 * 24 * 3_600_000).toISOString(), // 10 days ago
      });
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));

      expect(screen.getByText(/waiting 10 days ago/i)).toBeInTheDocument();
      expect(screen.queryByText(/5 minutes ago/i)).not.toBeInTheDocument();
    });

    // A response cached before `oldestAt` existed must still render a time.
    it('falls back to latestAt when oldestAt is absent', () => {
      renderWithLeads({
        count: 3,
        latestName: null,
        latestAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      });
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
      expect(screen.getByText(/waiting 3 hours ago/i)).toBeInTheDocument();
    });

    it('names the most recent waiting lead when available', () => {
      renderWithLeads({ count: 3, latestName: 'عبدالخالق عامر', latestAt: '2026-08-04T13:22:00Z' });
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
      expect(screen.getByText(/عبدالخالق عامر/)).toBeInTheDocument();
    });

    it('falls back to a generic hint when the latest name is unknown', () => {
      renderWithLeads({ count: 3, latestName: null, latestAt: null });
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
      expect(screen.getByText(/open to contact them/i)).toBeInTheDocument();
    });

    // A leads-only banner has no comment/message items to wait for, so the
    // loading line must not appear (it would never resolve).
    it('does not show the loading line when only leads are present', () => {
      renderWithLeads({ count: 5, latestName: null, latestAt: null });
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    it('still shows the loading line when comment/message counts exist but items have not arrived', () => {
      renderWithLeads({ count: 5, latestName: null, latestAt: null }, [], { comments: 2 });
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('hides the leads row when the count is zero', () => {
      renderWithLeads({ count: 0, latestName: null, latestAt: null }, [makeMessageItem()]);
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
      expect(screen.queryByText(/left their number/i)).not.toBeInTheDocument();
      expect(screen.getAllByRole('link').filter(a => a.getAttribute('href') === '/leads')).toHaveLength(0);
    });

    it('renders nothing at all when leads are omitted and nothing needs action', () => {
      const { container } = render(
        <SmartStatusBanner commentNeedsAction={0} messageNeedsAction={0} items={[]} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    // "View all" belongs to the comment/message list, so its count must exclude
    // leads — otherwise a 19-lead queue would advertise "View all 21 comments".
    it('excludes leads from the comment/message "view all" count', () => {
      renderWithLeads(
        { count: 19, latestName: null, latestAt: null },
        Array.from({ length: 6 }, (_, i) => makeCommentItem({ id: `c${i}` })),
      );
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));
      // Comments-only → the generic "View all N items" label, counting the 6
      // comments and NOT the 19 leads (which have their own row and link).
      expect(screen.getByText(/View all 6 items/i)).toBeInTheDocument();
      expect(screen.queryByText(/View all 25/i)).not.toBeInTheDocument();
    });
  });

  // The channel REPLACES the type icon on message rows: the channel glyph already
  // implies "message", and the banner is short on room. Comment rows keep
  // MessageSquare, so the two row types still read apart.
  describe('channel icon (multi-channel workspaces)', () => {
    it('swaps the message row type icon for the channel', () => {
      const { container } = renderMultiChannelBanner([
        makeMessageItem({ platform: 'whatsapp' }),
      ]);

      expect(screen.getByRole('img', { name: 'WhatsApp' })).toBeInTheDocument();
      expect(container.querySelector('.lucide-message-circle')).toBeNull();
    });

    it('leaves comment rows on MessageSquare with no channel icon', () => {
      const { container } = renderMultiChannelBanner([makeCommentItem()]);

      expect(container.querySelector('.lucide-message-square')).not.toBeNull();
      expect(screen.queryByRole('img', { name: /WhatsApp|Facebook|Instagram/ })).toBeNull();
    });

    it('keeps MessageCircle on single-channel workspaces', () => {
      const { container } = renderBanner([makeMessageItem({ platform: 'whatsapp' })]);
      fireEvent.click(screen.getByRole('button', { name: /need.*attention/i }));

      expect(container.querySelector('.lucide-message-circle')).not.toBeNull();
      expect(screen.queryByRole('img', { name: 'WhatsApp' })).toBeNull();
    });

    it('reserves no corner padding and carries no ribbon rotation', () => {
      // The removed ChannelRibbon forced `relative overflow-hidden pe-14` on the row
      // and needed `rtl:-rotate-45` to mirror. None of that may survive.
      const { container } = renderMultiChannelBanner([
        makeMessageItem({ platform: 'facebook' }),
        makeMessageItem({ id: '2', platform: 'instagram' }),
      ]);

      const html = container.innerHTML;
      expect(html).not.toMatch(/\bpe-14\b/);
      expect(html).not.toMatch(/rotate-45/);
      expect(html).not.toMatch(/\boverflow-hidden\b.*\bpe-/);
    });

    it('tints the channel for the rose panel in BOTH themes', () => {
      // PLATFORM_TINT is built for a neutral card and lands at ~1.2:1 on the light
      // rose-50 panel. The alert palette must carry a light value AND a dark: pair.
      renderMultiChannelBanner([makeMessageItem({ platform: 'facebook' })]);

      const cls = screen.getByRole('img', { name: 'Facebook' }).className;
      expect(cls).toMatch(/text-blue-700/);
      expect(cls).toMatch(/dark:text-blue-300/);
    });

    it('keeps Instagram off the panel\'s own rose hue', () => {
      // rose-300 clears AA on the dark panel but IS the banner's hue, so it reads as
      // chrome rather than a channel — the problem the icon swap exists to solve.
      renderMultiChannelBanner([makeMessageItem({ platform: 'instagram' })]);

      const cls = screen.getByRole('img', { name: 'Instagram' }).className;
      expect(cls).toMatch(/fuchsia/);
      expect(cls).not.toMatch(/rose/);
    });
  });
});
