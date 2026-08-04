/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Page } from '@jawab24/shared';
import { usePageFilter } from './usePageFilter';

const STORAGE_KEY = 'test-page-filter';

// Minimal page rows — the hook only reads `id` plus the two auto-reply flags.
function page(id: string, opts: { autoReply?: boolean; igAutoReply?: boolean } = {}): Page {
  return {
    id,
    autoReplyEnabled: opts.autoReply ?? false,
    instagramAutoReplyEnabled: opts.igAutoReply ?? false,
  } as unknown as Page;
}

beforeEach(() => {
  localStorage.clear();
});

describe('usePageFilter', () => {
  it('restores pageId from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'p1');
    const { result } = renderHook(() =>
      usePageFilter([page('p1', { autoReply: true })], { storageKey: STORAGE_KEY }),
    );
    expect(result.current.pageId).toBe('p1');
  });

  it("validateAgainst 'auto-reply' (default) keeps only auto-reply-enabled pages", () => {
    const pages = [page('p1', { autoReply: true }), page('p2'), page('p3', { igAutoReply: true })];
    const { result } = renderHook(() => usePageFilter(pages, { storageKey: STORAGE_KEY }));
    expect(result.current.validPages.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it("validateAgainst 'all' keeps every connected page", () => {
    const pages = [page('p1', { autoReply: true }), page('p2')];
    const { result } = renderHook(() =>
      usePageFilter(pages, { storageKey: STORAGE_KEY, validateAgainst: 'all' }),
    );
    expect(result.current.validPages.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it("validateAgainst 'connected' hides disconnected pages and keeps flag-less ones (absent = connected)", () => {
    const pages = [
      page('live', { autoReply: true }),                       // no flag → connected by convention
      { ...page('dead'), isConnected: false } as Page,          // needs reconnect → hidden
      { ...page('wa'), isConnected: true } as Page,             // WhatsApp-only with a live token
    ];
    const { result } = renderHook(() =>
      usePageFilter(pages, { storageKey: STORAGE_KEY, validateAgainst: 'connected' }),
    );
    expect(result.current.validPages.map((p) => p.id)).toEqual(['live', 'wa']);
  });

  // /business (owner ruling 2026-08-04): a selection stored before the page
  // disconnected must not survive into a surface that no longer offers it.
  it("clears a stored id whose page has since disconnected (validateAgainst 'connected')", () => {
    localStorage.setItem(STORAGE_KEY, 'dead');
    const { result } = renderHook(() =>
      usePageFilter([{ ...page('dead'), isConnected: false } as Page], {
        storageKey: STORAGE_KEY,
        validateAgainst: 'connected',
      }),
    );
    expect(result.current.pageId).toBe('');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // Regression for the reported /leads bug: a page connected but with auto-reply
  // OFF (e.g. blocked by the one-trial-per-channel rule) must stay a valid
  // selection under 'all', so the merchant's existing leads still load.
  it("keeps a stored auto-reply-off page when validating against 'all'", () => {
    localStorage.setItem(STORAGE_KEY, 'blocked');
    const { result } = renderHook(() =>
      usePageFilter([page('blocked', { autoReply: false })], {
        storageKey: STORAGE_KEY,
        validateAgainst: 'all',
      }),
    );
    expect(result.current.pageId).toBe('blocked');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('blocked');
  });

  // Regression for the shared early-return bug: a stale id must be dropped once
  // pages load EVEN when no page qualifies for the surface. Previously the
  // `validPages.length === 0` guard let it survive, and the consumer 404'd
  // querying it (the "Page not found" → "failed to load" symptom).
  it('clears a stored id invalid for the surface even when zero pages qualify', () => {
    localStorage.setItem(STORAGE_KEY, 'p1');
    const { result } = renderHook(() =>
      usePageFilter([page('p1', { autoReply: false })], {
        storageKey: STORAGE_KEY,
        validateAgainst: 'auto-reply', // p1 is off → validPages is empty
      }),
    );
    expect(result.current.pageId).toBe('');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clears a stored id pointing to a page that no longer exists', () => {
    localStorage.setItem(STORAGE_KEY, 'gone');
    const { result } = renderHook(() =>
      usePageFilter([page('p1', { autoReply: true })], {
        storageKey: STORAGE_KEY,
        validateAgainst: 'all',
      }),
    );
    expect(result.current.pageId).toBe('');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // The cleanup must NOT run before pages have loaded, or it would wipe the
  // restored selection during the initial (empty) render.
  it('preserves the restored id while pages are still loading (empty array)', () => {
    localStorage.setItem(STORAGE_KEY, 'p1');
    const { result, rerender } = renderHook(
      ({ pages }: { pages: Page[] }) =>
        usePageFilter(pages, { storageKey: STORAGE_KEY, validateAgainst: 'all' }),
      { initialProps: { pages: [] as Page[] } },
    );
    // Still loading: id preserved.
    expect(result.current.pageId).toBe('p1');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('p1');
    // Pages arrive and include p1: still preserved.
    rerender({ pages: [page('p1', { autoReply: true })] });
    expect(result.current.pageId).toBe('p1');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('p1');
  });

  it('updatePageId persists to localStorage and clearing removes it', () => {
    const { result } = renderHook(() =>
      usePageFilter([page('p1', { autoReply: true })], {
        storageKey: STORAGE_KEY,
        validateAgainst: 'all',
      }),
    );
    act(() => result.current.updatePageId('p1'));
    expect(result.current.pageId).toBe('p1');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('p1');

    act(() => result.current.updatePageId(''));
    expect(result.current.pageId).toBe('');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
