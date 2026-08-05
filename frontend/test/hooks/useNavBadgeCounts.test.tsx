/**
 * Tests: useNavBadgeCounts + aggregateNavBadge — the one source every nav
 * surface reads.
 *
 * The defect these pin: the mobile bottom nav badged its "More" button with the
 * new-lead count, but the overlay behind it rendered icon + label only. A
 * merchant tapping a badge that says 29 landed on a grid of identical tiles with
 * nothing pointing at Leads. Keying counts by href is what stops a destination
 * being badged on one surface and bare on another; the roll-up is what keeps the
 * container's number equal to the sum of what it hides.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const uiState = { unreadComments: 0, unreadMessages: 0 };
const leadsSummary = { count: 0, latestName: null as string | null, latestAt: null as string | null };

vi.mock('@/lib/store', () => ({
    useUIStore: (selector: (s: typeof uiState) => unknown) => selector(uiState),
}));

vi.mock('@/hooks/useNewLeadsSummary', () => ({
    useNewLeadsSummary: () => leadsSummary,
}));

import { useNavBadgeCounts, aggregateNavBadge, type NavBadge } from '@/hooks/useNavBadgeCounts';

function badge(count: number, color: NavBadge['color'], srLabel = `${count}`): NavBadge {
    return { count, color, srLabel };
}

describe('useNavBadgeCounts', () => {
    beforeEach(() => {
        uiState.unreadComments = 0;
        uiState.unreadMessages = 0;
        leadsSummary.count = 0;
    });

    it('keys every counted destination by its href', () => {
        uiState.unreadComments = 4;
        uiState.unreadMessages = 2;
        leadsSummary.count = 29;

        const { result } = renderHook(() => useNavBadgeCounts());

        expect(result.current['/comments'].count).toBe(4);
        expect(result.current['/messages'].count).toBe(2);
        expect(result.current['/leads'].count).toBe(29);
    });

    // Leads are an opportunity, not an alert — the brand pill distinguishes them
    // from the red unread badges. The overlay tile and the bottom nav both read
    // the colour from here, so they cannot disagree.
    it('marks leads brand and unread counts red', () => {
        expect(renderHook(() => useNavBadgeCounts()).result.current['/leads'].color).toBe('brand');
        expect(renderHook(() => useNavBadgeCounts()).result.current['/comments'].color).toBe('red');
        expect(renderHook(() => useNavBadgeCounts()).result.current['/messages'].color).toBe('red');
    });

    // The pill itself is aria-hidden, so the count reaches a screen reader only
    // through this label. It must be pluralized, not "29 lead(s)".
    it('carries a pluralized screen-reader label', () => {
        leadsSummary.count = 1;
        uiState.unreadComments = 3;

        const { result } = renderHook(() => useNavBadgeCounts());

        expect(result.current['/leads'].srLabel).toBe('1 new lead');
        expect(result.current['/comments'].srLabel).toBe('3 unread comments');
    });
});

describe('aggregateNavBadge', () => {
    const roll = (total: number) => `${total} items need attention`;

    it('returns null when nothing behind the container is waiting', () => {
        const badges = { '/leads': badge(0, 'brand'), '/settings': badge(0, 'red') };

        expect(aggregateNavBadge(badges, ['/leads', '/settings'], roll)).toBeNull();
    });

    it('ignores hrefs that carry no badge at all', () => {
        const badges = { '/leads': badge(5, 'brand') };

        expect(aggregateNavBadge(badges, ['/team', '/pricing'], roll)).toBeNull();
        expect(aggregateNavBadge(badges, ['/leads', '/team'], roll)?.count).toBe(5);
    });

    // Today's only real case: Leads is the single counted destination inside the
    // overlay. Announcing "29 new leads" beats the vaguer roll-up wording, and it
    // is the same sentence the tile inside announces — the two agree by construction.
    it('keeps the single contributor own label and colour', () => {
        const badges = { '/leads': badge(29, 'brand', '29 new leads') };

        expect(aggregateNavBadge(badges, ['/leads'], roll)).toEqual({
            count: 29,
            color: 'brand',
            srLabel: '29 new leads',
        });
    });

    it('sums several contributors and falls back to the roll-up label', () => {
        const badges = { '/leads': badge(29, 'brand'), '/comments': badge(3, 'red') };

        expect(aggregateNavBadge(badges, ['/leads', '/comments'], roll)).toEqual({
            count: 32,
            color: 'red',
            srLabel: '32 items need attention',
        });
    });

    // Red outranks brand: an unread alert must not be softened into a brand-tinted
    // pill because a lead happened to be counted alongside it.
    it('lets red win the colour whatever the order or the counts', () => {
        const badges = { '/leads': badge(99, 'brand'), '/comments': badge(1, 'red') };

        expect(aggregateNavBadge(badges, ['/comments', '/leads'], roll)?.color).toBe('red');
        expect(aggregateNavBadge(badges, ['/leads', '/comments'], roll)?.color).toBe('red');
    });

    // A zero-count destination must not drag the roll-up into the multi-contributor
    // branch — that would replace "29 new leads" with the vaguer wording for free.
    it('does not let a zero-count sibling change the single-contributor label', () => {
        const badges = { '/leads': badge(29, 'brand', '29 new leads'), '/comments': badge(0, 'red') };

        expect(aggregateNavBadge(badges, ['/leads', '/comments'], roll)?.srLabel).toBe('29 new leads');
    });
});
