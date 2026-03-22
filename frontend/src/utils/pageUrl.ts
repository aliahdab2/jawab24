import type { Page } from '@jawab24/shared';

/**
 * Build the external URL for a connected page.
 * Instagram pages link to their profile; Facebook pages link to their page.
 */
export function getPageExternalUrl(
  page: Pick<Page, 'facebookPageId' | 'instagramUsername'>,
  source?: string,
): string {
  if (source === 'instagram' && page.instagramUsername) {
    return `https://instagram.com/${page.instagramUsername}`;
  }
  return `https://facebook.com/${page.facebookPageId}`;
}
