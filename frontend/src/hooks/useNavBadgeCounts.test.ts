/**
 * The leads badge does not clear by being looked at — it counts unworked leads,
 * so it survives the visit by design (2026-08-04: a merchant sat on 19 unworked
 * leads because opening the page had silenced the signal).
 *
 * That only works if the badge stays resolvable: tapping it has to land on the
 * leads it counted, not on the unfiltered list. These tests pin that target, and
 * pin that the surfaces which route by it agree.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNavBadgeCounts, aggregateNavBadge, resolveNavHref, type NavBadge } from './useNavBadgeCounts';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => `${key}:${values?.count ?? ''}`,
}));

const mockUIState = { unreadComments: 0, unreadMessages: 0 };
vi.mock('@/lib/store', () => ({
  useUIStore: (selector: (s: typeof mockUIState) => unknown) => selector(mockUIState),
}));

const mockSummary = { count: 0 };
vi.mock('./useNewLeadsSummary', () => ({
  useNewLeadsSummary: () => mockSummary,
}));

function badges() {
  return renderHook(() => useNavBadgeCounts()).result.current;
}

describe('useNavBadgeCounts', () => {
  beforeEach(() => {
    mockUIState.unreadComments = 0;
    mockUIState.unreadMessages = 0;
    mockSummary.count = 0;
  });

  it('sends the leads badge to the leads it counted, not to the full list', () => {
    mockSummary.count = 9;
    expect(badges()['/leads'].targetHref).toBe('/leads?status=new');
  });

  it('leaves unread badges pointing at their own destination', () => {
    // Comments and messages clear by being read, so their destination already
    // shows what the badge counted — a narrower view would only hide the rest.
    mockUIState.unreadComments = 3;
    mockUIState.unreadMessages = 4;
    expect(badges()['/comments'].targetHref).toBeUndefined();
    expect(badges()['/messages'].targetHref).toBeUndefined();
  });
});

describe('resolveNavHref', () => {
  const leadsBadge: NavBadge = {
    count: 2,
    color: 'brand',
    srLabel: '2 new leads',
    targetHref: '/leads?status=new',
  };

  it('follows the badge while something is waiting', () => {
    expect(resolveNavHref('/leads', leadsBadge)).toBe('/leads?status=new');
  });

  it('falls back to the plain destination on an empty queue', () => {
    // The filtered view would be empty — the merchant asked for leads, not for
    // proof that none are waiting.
    expect(resolveNavHref('/leads', { ...leadsBadge, count: 0 })).toBe('/leads');
  });

  it('falls back for badges and destinations with no target at all', () => {
    expect(resolveNavHref('/comments', { count: 5, color: 'red', srLabel: '5' })).toBe('/comments');
    expect(resolveNavHref('/settings', null)).toBe('/settings');
    expect(resolveNavHref('/settings', undefined)).toBe('/settings');
  });
});

describe('aggregateNavBadge', () => {
  it('rolls up counts without a target — the container opens an overlay, it does not navigate', () => {
    const map = {
      '/leads': { count: 2, color: 'brand' as const, srLabel: '2 new leads', targetHref: '/leads?status=new' },
      '/team': { count: 1, color: 'red' as const, srLabel: '1 item' },
    };
    const rolled = aggregateNavBadge(map, ['/leads', '/team'], (total) => `${total} items`);
    expect(rolled).toMatchObject({ count: 3, color: 'red' });
    expect(rolled?.targetHref).toBeUndefined();
  });

  it("carries the single contributor's own label, still without a target", () => {
    const map = {
      '/leads': { count: 2, color: 'brand' as const, srLabel: '2 new leads', targetHref: '/leads?status=new' },
    };
    const rolled = aggregateNavBadge(map, ['/leads'], (total) => `${total} items`);
    expect(rolled?.srLabel).toBe('2 new leads');
    expect(rolled?.targetHref).toBeUndefined();
  });

  it('returns null when nothing is waiting', () => {
    const map = { '/leads': { count: 0, color: 'brand' as const, srLabel: 'none' } };
    expect(aggregateNavBadge(map, ['/leads'], () => '')).toBeNull();
  });
});
