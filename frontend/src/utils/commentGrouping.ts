import type { Comment } from '@jawab24/shared';
import { checkNeedsAttention } from '@/components/comments/CommentCard';

export interface CommentGroup {
  /** Unique key for React rendering: `${fromId}::${postId}` or `__solo::${id}` */
  groupKey: string;
  /** The newest comment in the group (by createdAt) */
  latestComment: Comment;
  /** All comments in the group, sorted newest-first */
  comments: Comment[];
  /** Total number of comments in the group */
  count: number;
  /** true if ANY comment in the group needs attention */
  needsAttention: boolean;
  /** true only if ALL comments in the group are resolved */
  allResolved: boolean;
  /** true if ANY comment in the group has a reply */
  hasAnyReply: boolean;
}

function getCreatedAtMs(comment: Comment): number {
  if (!comment.createdAt) return 0;
  return new Date(comment.createdAt).getTime();
}

/**
 * Group a flat list of comments by fromId + postId.
 * Comments with null fromId or postId are treated as solo groups.
 * Groups are sorted by the latest comment's createdAt (newest first).
 */
export function groupComments(comments: Comment[]): CommentGroup[] {
  if (comments.length === 0) return [];

  const map = new Map<string, Comment[]>();

  for (const comment of comments) {
    const key =
      comment.fromId && comment.postId
        ? `${comment.fromId}::${comment.postId}`
        : `__solo::${comment.id}`;

    const existing = map.get(key);
    if (existing) {
      existing.push(comment);
    } else {
      map.set(key, [comment]);
    }
  }

  const groups: CommentGroup[] = [];

  for (const [groupKey, groupComments] of map) {
    // Sort newest-first
    groupComments.sort((a, b) => getCreatedAtMs(b) - getCreatedAtMs(a));

    const latestComment = groupComments[0];

    groups.push({
      groupKey,
      latestComment,
      comments: groupComments,
      count: groupComments.length,
      needsAttention: groupComments.some(c => checkNeedsAttention(c)),
      allResolved: groupComments.every(c => c.resolved === true),
      hasAnyReply: groupComments.some(c => c.replied === true),
    });
  }

  // Sort groups by latest comment timestamp, newest first
  groups.sort((a, b) => getCreatedAtMs(b.latestComment) - getCreatedAtMs(a.latestComment));

  return groups;
}

/**
 * Filter groups by search query. A group is included if ANY comment
 * in the group matches on message or fromName.
 */
export function filterGroupsBySearch(
  groups: CommentGroup[],
  query: string,
): CommentGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;

  return groups.filter(group =>
    group.comments.some(
      c =>
        c.message.toLowerCase().includes(q) ||
        (c.fromName || '').toLowerCase().includes(q),
    ),
  );
}
