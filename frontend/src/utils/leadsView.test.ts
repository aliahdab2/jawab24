import { describe, it, expect } from 'vitest';
import { parseStatusFilter, pickWaitingPage } from './leadsView';

describe('parseStatusFilter', () => {
  it('accepts every filter the chips render', () => {
    expect(parseStatusFilter('all')).toBe('all');
    expect(parseStatusFilter('new')).toBe('new');
    expect(parseStatusFilter('contacted')).toBe('contacted');
    expect(parseStatusFilter('converted')).toBe('converted');
    expect(parseStatusFilter('returning')).toBe('returning');
  });

  it('rejects anything the chips cannot show, so no filter is applied invisibly', () => {
    // A hand-edited or stale value would otherwise filter the list while every
    // chip renders unselected — the merchant sees a short list and no reason.
    expect(parseStatusFilter('archived')).toBeNull();
    expect(parseStatusFilter('NEW')).toBeNull();
    expect(parseStatusFilter('')).toBeNull();
    // Next.js hands back an array when a param is repeated (?status=new&status=all).
    expect(parseStatusFilter(['new'])).toBeNull();
    expect(parseStatusFilter(undefined)).toBeNull();
  });
});

describe('pickWaitingPage', () => {
  const pages = ['page-a', 'page-b', 'page-c'];

  it('keeps the merchant on their own page when it has waiting leads', () => {
    // Landing on the right queue must not cost them the page they were working,
    // even when another page has waited longer.
    const waiting = [{ pageId: 'page-b', count: 5 }, { pageId: 'page-a', count: 2 }];
    expect(pickWaitingPage(waiting, pages, 'page-a')).toBe('page-a');
  });

  it('moves to the longest-waiting page when the current one is quiet', () => {
    // This is the whole point: a badge of 7 must not open a page holding none
    // of them. `waiting` arrives longest-waiting first from the server.
    const waiting = [{ pageId: 'page-b', count: 5 }, { pageId: 'page-c', count: 2 }];
    expect(pickWaitingPage(waiting, pages, 'page-a')).toBe('page-b');
  });

  it('picks a page even when nothing is selected yet', () => {
    const waiting = [{ pageId: 'page-c', count: 1 }];
    expect(pickWaitingPage(waiting, pages, '')).toBe('page-c');
  });

  it('ignores waiting pages the picker does not offer', () => {
    // A lead can outlive its page's presence in the picker; selecting one would
    // query a page that isn't there and 404 the list.
    const waiting = [{ pageId: 'page-gone', count: 9 }, { pageId: 'page-c', count: 1 }];
    expect(pickWaitingPage(waiting, pages, 'page-a')).toBe('page-c');
    expect(pickWaitingPage([{ pageId: 'page-gone', count: 9 }], pages, 'page-a')).toBeNull();
  });

  it('returns null when nothing is waiting, leaving the selection alone', () => {
    expect(pickWaitingPage([], pages, 'page-a')).toBeNull();
    expect(pickWaitingPage([{ pageId: 'page-b', count: 0 }], pages, 'page-a')).toBeNull();
  });
});
