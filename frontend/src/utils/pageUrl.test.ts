import { describe, it, expect } from 'vitest';
import { getPageExternalUrl, getCommentExternalUrl } from './pageUrl';

describe('getPageExternalUrl', () => {
  const fbPage = { facebookPageId: '123456', instagramUsername: null };
  const igPage = { facebookPageId: '123456', instagramUsername: 'myshop' };

  it('returns Facebook URL by default', () => {
    expect(getPageExternalUrl(fbPage)).toBe('https://facebook.com/123456');
  });

  it('returns Facebook URL when source is not instagram', () => {
    expect(getPageExternalUrl(igPage, 'facebook')).toBe('https://facebook.com/123456');
  });

  it('returns Instagram URL when source is instagram and username exists', () => {
    expect(getPageExternalUrl(igPage, 'instagram')).toBe('https://instagram.com/myshop');
  });

  it('falls back to Facebook URL when source is instagram but no username', () => {
    expect(getPageExternalUrl(fbPage, 'instagram')).toBe('https://facebook.com/123456');
  });

  it('returns Facebook URL when source is undefined', () => {
    expect(getPageExternalUrl(igPage)).toBe('https://facebook.com/123456');
  });
});

describe('getCommentExternalUrl', () => {
  it('returns Facebook post URL with comment_id for Facebook comments', () => {
    expect(getCommentExternalUrl({
      postPermalink: '1074356795756273_123456789',
      facebookCommentId: 'comment_999',
      source: 'facebook',
    })).toBe('https://facebook.com/1074356795756273_123456789?comment_id=comment_999');
  });

  it('returns Facebook post URL without comment_id when missing', () => {
    expect(getCommentExternalUrl({
      postPermalink: '1074356795756273_123456789',
      source: 'facebook',
    })).toBe('https://facebook.com/1074356795756273_123456789');
  });

  it('returns Instagram permalink for Instagram comments', () => {
    expect(getCommentExternalUrl({
      postPermalink: 'https://instagram.com/p/ABC123/',
      source: 'instagram',
    })).toBe('https://instagram.com/p/ABC123/');
  });

  it('falls back to page URL when no post permalink (Facebook)', () => {
    expect(getCommentExternalUrl({
      source: 'facebook',
    }, 'https://facebook.com/123456')).toBe('https://facebook.com/123456');
  });

  it('falls back to page URL when no post permalink (Instagram)', () => {
    expect(getCommentExternalUrl({
      source: 'instagram',
    }, 'https://instagram.com/myshop')).toBe('https://instagram.com/myshop');
  });

  it('returns undefined when no permalink and no fallback', () => {
    expect(getCommentExternalUrl({ source: 'facebook' })).toBeUndefined();
  });
});
