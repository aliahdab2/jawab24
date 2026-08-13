import type { LeadStatus } from '@/lib/api';

/**
 * Which slice of the leads list is on screen.
 *
 * 'returning' is a cross-status filter (a lead that came back — needsFollowUp),
 * not a pipeline stage; it overlaps new/contacted/converted.
 */
export type StatusFilter = LeadStatus | 'all' | 'returning';

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'new', 'contacted', 'converted', 'returning'];

/**
 * Read a filter out of `?status=`, or null if it isn't one we render.
 *
 * The nav badge deep-links to `?status=new`, and the chips write back here, so
 * the URL is the shareable/reloadable description of the view. Validated rather
 * than cast: a hand-edited value would otherwise select a chip that doesn't
 * exist, leaving every chip unhighlighted over a filtered list.
 */
export function parseStatusFilter(value: unknown): StatusFilter | null {
  return typeof value === 'string' && STATUS_FILTERS.includes(value as StatusFilter)
    ? (value as StatusFilter)
    : null;
}

/**
 * Which page the badge's deep link should open, given where the waiting leads
 * are (`waiting`, longest-waiting page first) and which pages the picker offers.
 *
 * The badge counts the whole workspace while the list shows a single page, so
 * without this a badge of 9 can open a page holding none of them — an empty
 * list under a non-zero badge, which reads as a broken count rather than as a
 * page selection.
 *
 * `currentPageId` wins whenever it has waiting leads of its own: landing on the
 * right queue must not cost the merchant the page they were working. Returns
 * null when no offered page is waiting, meaning "leave the selection alone".
 */
export function pickWaitingPage(
  // Structural on purpose: the summary's own `NewLeadsPageShare` carries an
  // `oldestAt` this decision never reads (the server already ordered by it), and
  // a second named type for the same concept is how the two drift apart.
  waiting: readonly { pageId: string; count: number }[],
  selectablePageIds: string[],
  currentPageId: string,
): string | null {
  const offered = waiting.filter((share) => share.count > 0 && selectablePageIds.includes(share.pageId));
  if (offered.some((share) => share.pageId === currentPageId)) return currentPageId;
  return offered[0]?.pageId ?? null;
}
