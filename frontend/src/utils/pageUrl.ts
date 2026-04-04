import type { Page, Comment } from '@jawab24/shared';

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
  return page.facebookPageId ? `https://facebook.com/${page.facebookPageId}` : '';
}

/**
 * Build the Facebook Graph API avatar URL for a page.
 * Returns null for WhatsApp-only pages (no facebookPageId).
 */
export function getPageAvatarUrl(page: Pick<Page, 'facebookPageId'>): string | null {
  return page.facebookPageId
    ? `https://graph.facebook.com/${page.facebookPageId}/picture?type=large`
    : null;
}

/**
 * Build the external URL for a specific comment's post.
 * Facebook: links to the post (with comment_id highlight if available).
 * Instagram: uses the stored media permalink.
 * Falls back to the page URL if no post data is available.
 */
export function getCommentExternalUrl(
  comment: Pick<Comment, 'postPermalink' | 'facebookCommentId' | 'source'>,
  fallbackPageUrl?: string,
): string | undefined {
  const isInstagram = comment.source === 'instagram';

  if (isInstagram) {
    return comment.postPermalink || fallbackPageUrl;
  }

  if (comment.postPermalink) {
    const postUrl = `https://facebook.com/${comment.postPermalink}`;
    return comment.facebookCommentId
      ? `${postUrl}?comment_id=${comment.facebookCommentId}`
      : postUrl;
  }

  return fallbackPageUrl;
}
