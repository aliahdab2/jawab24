import { describe, it, expect } from 'vitest';
import { getPageExternalUrl } from './pageUrl';

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
