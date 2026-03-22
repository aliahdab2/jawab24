import { describe, it, expect } from 'vitest';
import type { Comment } from '@jawab24/shared';
import { groupComments, filterGroupsBySearch, type CommentGroup } from './commentGrouping';

function makeComment(overrides: Partial<Comment> & { id: string }): Comment {
  return {
    message: 'test message',
    fromName: 'Test User',
    fromId: 'user1',
    replied: false,
    replyText: null,
    replyMethod: null,
    detectedLanguage: null,
    pageId: 'page1',
    createdAt: '2026-03-20T10:00:00Z',
    postId: 'post1',
    postMessage: null,
    needsAttention: false,
    resolved: false,
    ...overrides,
  };
}

describe('groupComments', () => {
  it('returns empty array for empty input', () => {
    expect(groupComments([])).toEqual([]);
  });

  it('groups comments with same fromId + postId', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', createdAt: '2026-03-20T10:00:00Z' }),
      makeComment({ id: 'c2', fromId: 'u1', postId: 'p1', createdAt: '2026-03-20T11:00:00Z' }),
      makeComment({ id: 'c3', fromId: 'u2', postId: 'p1', createdAt: '2026-03-20T12:00:00Z' }),
    ];

    const groups = groupComments(comments);
    expect(groups).toHaveLength(2);

    const u1Group = groups.find(g => g.groupKey === 'u1::p1')!;
    expect(u1Group.count).toBe(2);
    expect(u1Group.latestComment.id).toBe('c2');
    expect(u1Group.comments[0].id).toBe('c2'); // newest first
    expect(u1Group.comments[1].id).toBe('c1');

    const u2Group = groups.find(g => g.groupKey === 'u2::p1')!;
    expect(u2Group.count).toBe(1);
  });

  it('does NOT group when fromId is null', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: null, postId: 'p1' }),
      makeComment({ id: 'c2', fromId: null, postId: 'p1' }),
    ];

    const groups = groupComments(comments);
    expect(groups).toHaveLength(2);
    expect(groups.every(g => g.count === 1)).toBe(true);
  });

  it('does NOT group when postId is null', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: null }),
      makeComment({ id: 'c2', fromId: 'u1', postId: null }),
    ];

    const groups = groupComments(comments);
    expect(groups).toHaveLength(2);
  });

  it('sorts groups by latest comment timestamp (newest first)', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', createdAt: '2026-03-20T08:00:00Z' }),
      makeComment({ id: 'c2', fromId: 'u2', postId: 'p1', createdAt: '2026-03-20T12:00:00Z' }),
      makeComment({ id: 'c3', fromId: 'u3', postId: 'p1', createdAt: '2026-03-20T10:00:00Z' }),
    ];

    const groups = groupComments(comments);
    expect(groups[0].latestComment.id).toBe('c2');
    expect(groups[1].latestComment.id).toBe('c3');
    expect(groups[2].latestComment.id).toBe('c1');
  });

  it('sets needsAttention=true if any comment needs attention', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', needsAttention: false }),
      makeComment({ id: 'c2', fromId: 'u1', postId: 'p1', needsAttention: true }),
    ];

    const groups = groupComments(comments);
    expect(groups[0].needsAttention).toBe(true);
  });

  it('sets needsAttention via keyword detection', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', message: 'I need help please', needsAttention: false }),
    ];

    const groups = groupComments(comments);
    expect(groups[0].needsAttention).toBe(true);
  });

  it('sets allResolved=true only when all comments are resolved', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', resolved: true }),
      makeComment({ id: 'c2', fromId: 'u1', postId: 'p1', resolved: false }),
    ];

    const groups = groupComments(comments);
    expect(groups[0].allResolved).toBe(false);

    const allResolved = [
      makeComment({ id: 'c3', fromId: 'u2', postId: 'p1', resolved: true }),
      makeComment({ id: 'c4', fromId: 'u2', postId: 'p1', resolved: true }),
    ];

    const groups2 = groupComments(allResolved);
    expect(groups2[0].allResolved).toBe(true);
  });

  it('sets hasAnyReply=true if any comment has a reply', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', replied: false }),
      makeComment({ id: 'c2', fromId: 'u1', postId: 'p1', replied: true, replyText: 'Thanks!' }),
    ];

    const groups = groupComments(comments);
    expect(groups[0].hasAnyReply).toBe(true);
  });

  it('handles single-comment groups correctly', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1' }),
    ];

    const groups = groupComments(comments);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
    expect(groups[0].latestComment.id).toBe('c1');
    expect(groups[0].comments).toHaveLength(1);
  });

  it('separates same person on different posts', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1' }),
      makeComment({ id: 'c2', fromId: 'u1', postId: 'p2' }),
    ];

    const groups = groupComments(comments);
    expect(groups).toHaveLength(2);
  });

  it('handles null createdAt gracefully', () => {
    const comments = [
      makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', createdAt: null }),
      makeComment({ id: 'c2', fromId: 'u1', postId: 'p1', createdAt: '2026-03-20T10:00:00Z' }),
    ];

    const groups = groupComments(comments);
    expect(groups[0].latestComment.id).toBe('c2');
  });
});

describe('filterGroupsBySearch', () => {
  const groups: CommentGroup[] = [
    {
      groupKey: 'u1::p1',
      latestComment: makeComment({ id: 'c2', fromId: 'u1', postId: 'p1', message: 'follow up' }),
      comments: [
        makeComment({ id: 'c2', fromId: 'u1', postId: 'p1', message: 'follow up' }),
        makeComment({ id: 'c1', fromId: 'u1', postId: 'p1', message: 'shipping question' }),
      ],
      count: 2,
      needsAttention: false,
      allResolved: false,
      hasAnyReply: false,
    },
    {
      groupKey: 'u2::p1',
      latestComment: makeComment({ id: 'c3', fromId: 'u2', postId: 'p1', fromName: 'Ahmed', message: 'great product' }),
      comments: [
        makeComment({ id: 'c3', fromId: 'u2', postId: 'p1', fromName: 'Ahmed', message: 'great product' }),
      ],
      count: 1,
      needsAttention: false,
      allResolved: false,
      hasAnyReply: false,
    },
  ];

  it('returns all groups for empty query', () => {
    expect(filterGroupsBySearch(groups, '')).toHaveLength(2);
    expect(filterGroupsBySearch(groups, '  ')).toHaveLength(2);
  });

  it('matches on message text in any comment of the group', () => {
    const result = filterGroupsBySearch(groups, 'shipping');
    expect(result).toHaveLength(1);
    expect(result[0].groupKey).toBe('u1::p1');
  });

  it('matches on fromName', () => {
    const result = filterGroupsBySearch(groups, 'ahmed');
    expect(result).toHaveLength(1);
    expect(result[0].groupKey).toBe('u2::p1');
  });

  it('is case-insensitive', () => {
    expect(filterGroupsBySearch(groups, 'SHIPPING')).toHaveLength(1);
    expect(filterGroupsBySearch(groups, 'Ahmed')).toHaveLength(1);
  });

  it('returns empty when no match', () => {
    expect(filterGroupsBySearch(groups, 'nonexistent')).toHaveLength(0);
  });
});
