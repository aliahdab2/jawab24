import { describe, it, expect } from 'vitest';
import type { Page, UsageSummary } from '@jawab24/shared';
import { deriveSetupState } from '../setupChecklist';

const LONG_KB = 'x'.repeat(80);

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1',
    name: 'My Page',
    facebookPageId: 'fb1',
    autoReplyEnabled: false,
    knowledgeBase: null,
    repliesCount: 0,
    isConnected: true,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Page;
}

function usage(usedReplies = 0): UsageSummary {
  return {
    currentPeriod: { start: '2026-06-01', end: '2026-06-30' },
    aiReplies: { used: usedReplies, limit: 1000, remaining: 1000 - usedReplies, percentUsed: 0 },
    pages: { used: 1, limit: 5, remaining: 4 },
    subscription: { plan: { slug: 'starter' }, status: 'active' },
  } as UsageSummary;
}

describe('deriveSetupState', () => {
  it('marks only pageConnected when a bare connected page exists', () => {
    const s = deriveSetupState([page()], usage(0));
    expect(s).toMatchObject({ pageConnected: true, kbFilled: false, autoReplyOn: false, firstReplySent: false, allDone: false });
  });

  it('allDone when kb filled + auto-reply on + a reply sent', () => {
    const s = deriveSetupState([page({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 3 })], usage(0));
    expect(s.allDone).toBe(true);
  });

  it('counts first reply from monthly usage when per-page count is zero', () => {
    const s = deriveSetupState([page({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 0 })], usage(5));
    expect(s.firstReplySent).toBe(true);
    expect(s.allDone).toBe(true);
  });

  it('ignores disconnected pages', () => {
    const s = deriveSetupState([page({ isConnected: false, knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 3 })], usage(0));
    expect(s.pageConnected).toBe(false);
    expect(s.allDone).toBe(false);
  });

  it('treats Instagram/WhatsApp auto-reply as auto-reply on', () => {
    const s = deriveSetupState([page({ autoReplyEnabled: false, instagramAutoReplyEnabled: true })], usage(0));
    expect(s.autoReplyOn).toBe(true);
  });

  it('counts a catalog with items as kbFilled even with an empty free-text KB', () => {
    const s = deriveSetupState([page({ knowledgeBase: null, catalogItemsCount: 2 })], usage(0));
    expect(s.kbFilled).toBe(true);
  });

  it('does not count a catalog with zero items as kbFilled', () => {
    const s = deriveSetupState([page({ knowledgeBase: null, catalogItemsCount: 0 })], usage(0));
    expect(s.kbFilled).toBe(false);
  });

  it('coreSetupDone is true with page + kb + auto-reply even before any reply lands', () => {
    const s = deriveSetupState([page({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 0 })], usage(0));
    expect(s.coreSetupDone).toBe(true);
    // ...but the passive milestone hasn't flipped, so it's not fully "allDone".
    expect(s.firstReplySent).toBe(false);
    expect(s.allDone).toBe(false);
  });

  it('coreSetupDone is false while any active step is missing', () => {
    // Missing auto-reply.
    expect(deriveSetupState([page({ knowledgeBase: LONG_KB, autoReplyEnabled: false })], usage(0)).coreSetupDone).toBe(false);
    // Missing business info.
    expect(deriveSetupState([page({ knowledgeBase: null, autoReplyEnabled: true })], usage(0)).coreSetupDone).toBe(false);
  });

  it('allDone implies coreSetupDone', () => {
    const s = deriveSetupState([page({ knowledgeBase: LONG_KB, autoReplyEnabled: true, repliesCount: 3 })], usage(0));
    expect(s.allDone).toBe(true);
    expect(s.coreSetupDone).toBe(true);
  });
});
