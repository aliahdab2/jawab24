import { postsScanEligibility, type Page, type PostsScanBlocker } from '@jawab24/shared';

/**
 * A page's auto-reply is "on" if either channel (Facebook or Instagram) has it
 * enabled. Single source of truth so the page-filter hook and the leads picker
 * agree on what "active vs paused" means.
 */
export function isPageAutoReplyEnabled(
  page: Pick<Page, 'autoReplyEnabled' | 'instagramAutoReplyEnabled'>,
): boolean {
  return !!(page.autoReplyEnabled || page.instagramAutoReplyEnabled);
}

/**
 * Client adapter for the shared posts-scan rule: maps a `Page` onto the facts
 * `postsScanEligibility` needs, and flattens the result to "which blocker copy
 * do I show" (null = the scan is offered).
 *
 * The rule itself lives in `@jawab24/shared/catalogScanEligibility` and is the
 * same one the backend enforces, so a hidden button and a 409 can never
 * disagree. All this adds is where the browser's version of each fact comes
 * from: `isConnected` is the server's own verdict on whether a usable page token
 * exists (`controllers/pages.ts` — it reports '' for an absent OR undecryptable
 * token), since the credential never reaches the client.
 *
 * `isConnected !== false` (not `=== true`) follows the convention used across the
 * app — an absent flag means "not told otherwise", never "disconnected".
 */
export function postsScanBlockerForPage(
  page: Pick<Page, 'facebookPageId' | 'isConnected'>,
): PostsScanBlocker | null {
  const eligibility = postsScanEligibility({
    facebookPageId: page.facebookPageId,
    hasUsableToken: page.isConnected !== false,
  });
  return eligibility.eligible ? null : eligibility.blocker;
}
