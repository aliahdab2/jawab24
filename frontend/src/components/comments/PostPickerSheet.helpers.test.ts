import { describe, it, expect, beforeEach } from 'vitest';
import type { Page } from '@jawab24/shared';
import { pickablePages, initialPage } from './PostPickerSheet';

const page = (over: Partial<Page> = {}): Page =>
  ({
    id: 'p1',
    name: 'Page',
    isConnected: true,
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    facebookPageId: 'fb1',
    instagramAccountId: null,
    ...over,
  }) as unknown as Page;

const STORAGE_KEY = 'post-reply-picker-page';

describe('pickablePages', () => {
  it('offers a connected, auto-reply-enabled FB page', () => {
    const pages = [page({ id: 'a' })];
    expect(pickablePages(pages).map((p) => p.id)).toEqual(['a']);
  });

  it('excludes a connected page whose auto-reply is OFF (a trigger there can never fire)', () => {
    const pages = [
      page({ id: 'on', autoReplyEnabled: true }),
      page({ id: 'off', autoReplyEnabled: false, instagramAutoReplyEnabled: false }),
    ];
    expect(pickablePages(pages).map((p) => p.id)).toEqual(['on']);
  });

  it('keeps a page when only its Instagram auto-reply is on', () => {
    const pages = [
      page({
        id: 'ig',
        autoReplyEnabled: false,
        instagramAutoReplyEnabled: true,
        facebookPageId: null,
        instagramAccountId: 'ig1',
      }),
    ];
    expect(pickablePages(pages).map((p) => p.id)).toEqual(['ig']);
  });

  it('excludes a disconnected page', () => {
    const pages = [page({ id: 'gone', isConnected: false })];
    expect(pickablePages(pages)).toEqual([]);
  });

  it('excludes a WhatsApp-only page (no FB page or IG account)', () => {
    const pages = [page({ id: 'wa', facebookPageId: null, instagramAccountId: null })];
    expect(pickablePages(pages)).toEqual([]);
  });
});

describe('initialPage (persistence)', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to the first candidate when nothing is stored', () => {
    const candidates = [page({ id: 'a' }), page({ id: 'b' })];
    expect(initialPage(candidates)?.id).toBe('a');
  });

  it('restores the last-picked page when it is still pickable', () => {
    window.localStorage.setItem(STORAGE_KEY, 'b');
    const candidates = [page({ id: 'a' }), page({ id: 'b' })];
    expect(initialPage(candidates)?.id).toBe('b');
  });

  it('falls back to the first candidate when the stored page is no longer pickable', () => {
    window.localStorage.setItem(STORAGE_KEY, 'gone');
    const candidates = [page({ id: 'a' }), page({ id: 'b' })];
    expect(initialPage(candidates)?.id).toBe('a');
  });
});
