import { describe, it, expect } from 'vitest';
import type { Page, UsageSummary } from '@jawab24/shared';
import {
  countSetupStepsDone,
  deriveSetupState,
  isWithinSetupGrace,
  resolveSetupClockStart,
  SETUP_CHECKLIST_GRACE_MS,
} from '../setupChecklist';

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

  // D-026 regression: the workspace masters gate every reply — a page-level
  // toggle alone must not read as "auto-reply on" (the checklist lie that let
  // new signups finish setup with a pipeline that never replies).
  describe('workspace masters (D-026)', () => {
    it('page-level ON + masters OFF ⇒ autoReplyOn false, coreSetupDone false', () => {
      const s = deriveSetupState(
        [page({ knowledgeBase: LONG_KB, autoReplyEnabled: true })],
        usage(0),
        { commentsAutoReply: false, messagesAutoReply: false },
      );
      expect(s.autoReplyOn).toBe(false);
      expect(s.coreSetupDone).toBe(false);
    });

    it('page-level ON + one master ON ⇒ autoReplyOn true (OR semantics)', () => {
      const s = deriveSetupState(
        [page({ knowledgeBase: LONG_KB, autoReplyEnabled: true })],
        usage(0),
        { commentsAutoReply: false, messagesAutoReply: true },
      );
      expect(s.autoReplyOn).toBe(true);
      expect(s.coreSetupDone).toBe(true);
    });

    it('masters omitted ⇒ legacy page-level-only behavior', () => {
      const s = deriveSetupState([page({ knowledgeBase: LONG_KB, autoReplyEnabled: true })], usage(0));
      expect(s.autoReplyOn).toBe(true);
    });

    it('masters ON but page-level OFF ⇒ still false (both levels required)', () => {
      const s = deriveSetupState(
        [page({ knowledgeBase: LONG_KB, autoReplyEnabled: false })],
        usage(0),
        { commentsAutoReply: true, messagesAutoReply: true },
      );
      expect(s.autoReplyOn).toBe(false);
    });
  });

  // D-027: a configured Post Reply trigger = the quick path is live.
  describe('postReplyConfigured (D-027)', () => {
    it('true when any connected page has a trigger', () => {
      const s = deriveSetupState([page({ hasPostReplyTrigger: true })], usage(0));
      expect(s.postReplyConfigured).toBe(true);
    });

    it('ignores triggers on disconnected pages', () => {
      const s = deriveSetupState([page({ hasPostReplyTrigger: true, isConnected: false })], usage(0));
      expect(s.postReplyConfigured).toBe(false);
    });
  });
});

// The setup clock decides when the dashboard panel demotes from its full card to
// a one-line row. `now` is injectable, so none of this needs fake timers.
describe('resolveSetupClockStart', () => {
  const T0 = Date.parse('2026-08-13T12:00:00Z');
  const at = (ms: number) => new Date(T0 - ms).toISOString();
  const DAY = 24 * 60 * 60 * 1000;

  it('returns null when there is no anchor at all (brand-new merchant)', () => {
    expect(resolveSetupClockStart([], null)).toBeNull();
    expect(resolveSetupClockStart([], undefined)).toBeNull();
  });

  it('uses onboardingCompletedAt when there are no pages', () => {
    expect(resolveSetupClockStart([], at(5 * DAY))).toBe(T0 - 5 * DAY);
  });

  it('uses the oldest page createdAt when onboardingCompletedAt is null', () => {
    const pages = [page({ id: 'a', createdAt: at(2 * DAY) }), page({ id: 'b', createdAt: at(9 * DAY) })];
    expect(resolveSetupClockStart(pages, null)).toBe(T0 - 9 * DAY);
  });

  it('takes the EARLIEST of the two anchors', () => {
    const pages = [page({ createdAt: at(2 * DAY) })];
    expect(resolveSetupClockStart(pages, at(40 * DAY))).toBe(T0 - 40 * DAY);
  });

  // A revoked page still proves the merchant has been around, even though
  // deriveSetupState deliberately ignores it for progress.
  it('counts disconnected pages', () => {
    const pages = [page({ isConnected: false, createdAt: at(30 * DAY) })];
    expect(resolveSetupClockStart(pages, null)).toBe(T0 - 30 * DAY);
  });

  it('accepts Date objects as well as ISO strings', () => {
    expect(resolveSetupClockStart([], new Date(T0 - DAY))).toBe(T0 - DAY);
  });

  it('ignores unparseable and null timestamps rather than throwing', () => {
    const pages = [page({ createdAt: 'not-a-date' }), page({ id: 'b', createdAt: null })];
    expect(resolveSetupClockStart(pages, 'garbage')).toBeNull();
    expect(resolveSetupClockStart([...pages, page({ id: 'c', createdAt: at(DAY) })], null)).toBe(T0 - DAY);
  });
});

describe('isWithinSetupGrace', () => {
  const T0 = Date.parse('2026-08-13T12:00:00Z');
  const at = (ms: number) => new Date(T0 - ms).toISOString();

  it('is true with no anchor — only demote on positive evidence of age', () => {
    expect(isWithinSetupGrace([], null, T0)).toBe(true);
  });

  it('is true just inside the window and false just outside it', () => {
    expect(isWithinSetupGrace([], at(SETUP_CHECKLIST_GRACE_MS - 1000), T0)).toBe(true);
    expect(isWithinSetupGrace([], at(SETUP_CHECKLIST_GRACE_MS + 1000), T0)).toBe(false);
  });

  it('is false exactly at the boundary (window is exclusive)', () => {
    expect(isWithinSetupGrace([], at(SETUP_CHECKLIST_GRACE_MS), T0)).toBe(false);
  });
});

describe('countSetupStepsDone', () => {
  it('counts only the three actionable milestones', () => {
    expect(countSetupStepsDone(deriveSetupState([], usage(0)))).toBe(0);
    expect(countSetupStepsDone(deriveSetupState([page()], usage(0)))).toBe(1);
    expect(countSetupStepsDone(deriveSetupState([page({ knowledgeBase: LONG_KB })], usage(0)))).toBe(2);
    const allOn = deriveSetupState(
      [page({ knowledgeBase: LONG_KB, autoReplyEnabled: true })],
      usage(0),
      { commentsAutoReply: true, messagesAutoReply: true },
    );
    expect(countSetupStepsDone(allOn)).toBe(3);
  });

  // firstReplySent is passive and must not inflate the merchant's progress.
  it('ignores the passive firstReplySent milestone', () => {
    const s = deriveSetupState([page({ repliesCount: 12 })], usage(50));
    expect(s.firstReplySent).toBe(true);
    expect(countSetupStepsDone(s)).toBe(1);
  });
});
