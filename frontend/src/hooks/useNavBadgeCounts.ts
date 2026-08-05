import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useUIStore } from '@/lib/store';
import { useNewLeadsSummary } from './useNewLeadsSummary';

export type NavBadgeColor = 'red' | 'brand';

export interface NavBadge {
  count: number;
  color: NavBadgeColor;
  /** Announced to screen readers — the pill itself is `aria-hidden`. */
  srLabel: string;
}

export type NavBadgeMap = Record<string, NavBadge>;

/**
 * Every nav destination that carries a count, keyed by href.
 *
 * One source for all three nav surfaces — the desktop sidebar, the mobile bottom
 * nav, and the mobile "More" overlay — so a destination cannot show a badge on
 * one surface and nothing on another. That drift is exactly what shipped: the
 * bottom nav's "More" button carried the new-leads count, but the overlay behind
 * it rendered icon + label only, so a merchant who tapped the badge landed on a
 * grid of identical tiles with nothing pointing at Leads.
 *
 * A badge on a container is a promise that something inside needs attention; iOS
 * and Material both resolve it by repeating the indicator on the item that owns
 * the count. Keying by href is what lets any surface honour that without knowing
 * which destinations happen to have counts today.
 */
export function useNavBadgeCounts(): NavBadgeMap {
  const tNav = useTranslations('nav');
  const unreadComments = useUIStore((s) => s.unreadComments);
  const unreadMessages = useUIStore((s) => s.unreadMessages);
  // Server-backed standing queue, not the session counter — see useNewLeadsSummary.
  const { count: newLeads } = useNewLeadsSummary();

  return useMemo(
    () => ({
      '/comments': {
        count: unreadComments,
        color: 'red' as const,
        srLabel: tNav('badgeUnreadComments', { count: unreadComments }),
      },
      '/messages': {
        count: unreadMessages,
        color: 'red' as const,
        srLabel: tNav('badgeUnreadMessages', { count: unreadMessages }),
      },
      '/leads': {
        count: newLeads,
        color: 'brand' as const,
        srLabel: tNav('badgeNewLeads', { count: newLeads }),
      },
    }),
    [unreadComments, unreadMessages, newLeads, tNav],
  );
}

/**
 * Roll the badges of `hrefs` up into the single badge shown on the container
 * that hides them — the bottom nav's "More" button standing in for everything
 * inside the overlay.
 *
 * Red outranks brand: an unread alert must not be softened into a brand-tinted
 * pill because a lead happened to be counted alongside it. When exactly one
 * destination contributes, its own label is announced ("29 new leads") rather
 * than the vaguer roll-up wording — that is today's only case, and the specific
 * label is the more useful one.
 *
 * Returns null when nothing is waiting, so callers can render nothing at all
 * instead of a zero pill.
 */
export function aggregateNavBadge(
  badges: NavBadgeMap,
  hrefs: string[],
  labelForTotal: (total: number) => string,
): NavBadge | null {
  const contributing = hrefs
    .map((href) => badges[href])
    .filter((badge): badge is NavBadge => !!badge && badge.count > 0);

  if (contributing.length === 0) return null;

  const total = contributing.reduce((sum, badge) => sum + badge.count, 0);
  const color: NavBadgeColor = contributing.some((b) => b.color === 'red') ? 'red' : 'brand';

  return {
    count: total,
    color,
    srLabel: contributing.length === 1 ? contributing[0].srLabel : labelForTotal(total),
  };
}
