import type { Page } from '@jawab24/shared';

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
