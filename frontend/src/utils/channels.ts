import type { Page } from '@jawab24/shared';

/**
 * True when a workspace has more than one messaging channel connected across its
 * pages. This is the single gate for showing a per-conversation channel indicator
 * (the ribbon on inbox rows) — a single-channel workspace doesn't need one, so the
 * list stays clean. Shared by the Messages page and the dashboard so both agree.
 */
export function hasMultipleConnectedChannels(pages: Page[]): boolean {
  const channels = new Set<string>();
  for (const p of pages) {
    if (p.facebookPageId) channels.add('facebook');
    if (p.instagramAccountId || p.instagramUsername) channels.add('instagram');
    if (p.whatsappConnected) channels.add('whatsapp');
  }
  return channels.size > 1;
}
