import type { Page, UsageSummary } from '@jawab24/shared';
import { isKbFilled } from './kb';

/**
 * The four onboarding milestones, derived live from data the dashboard already
 * holds (no extra fetch). Single source of truth shared by SetupChecklistCard
 * (renders the steps + decides when to hide) and PostReplyNudgeBanner (shows
 * once `coreSetupDone`), so the two can never disagree about setup progress.
 */
export interface SetupState {
  pageConnected: boolean;
  kbFilled: boolean;
  autoReplyOn: boolean;
  firstReplySent: boolean;
  /**
   * The three merchant-actionable milestones are done (page + business info +
   * auto-reply ON). This is the point where active setup is finished — the
   * merchant has done everything they can; `firstReplySent` is passive (it only
   * flips when a real customer messages). The checklist hides and the Post Reply
   * nudge takes its slot here, so a brand-new merchant discovers Post Reply the
   * moment they finish onboarding instead of waiting for their first reply.
   */
  coreSetupDone: boolean;
  /** All four milestones complete (incl. the passive first-reply-sent). */
  allDone: boolean;
}

export function deriveSetupState(pages: Page[], usage: UsageSummary | null): SetupState {
  // Disconnected pages (Facebook access revoked) don't count toward setup — mirror
  // the rest of the dashboard, which filters them out before deriving state.
  const connectedPages = pages.filter((p) => p.isConnected !== false);

  const pageConnected = connectedPages.length > 0;
  // "Business info" is satisfied by either a filled free-text KB or a native
  // catalog with at least one item — both give the AI something to answer from.
  const kbFilled = connectedPages.some((p) => isKbFilled(p) || (p.catalogItemsCount ?? 0) > 0);
  const autoReplyOn = connectedPages.some(
    (p) => p.autoReplyEnabled || p.instagramAutoReplyEnabled || p.whatsappAutoReplyEnabled,
  );
  // A reply has been sent (per-page joined count), with monthly usage as a fallback.
  const firstReplySent =
    connectedPages.some((p) => (p.repliesCount ?? 0) > 0) || (usage?.aiReplies?.used ?? 0) > 0;

  const coreSetupDone = pageConnected && kbFilled && autoReplyOn;

  return {
    pageConnected,
    kbFilled,
    autoReplyOn,
    firstReplySent,
    coreSetupDone,
    allDone: coreSetupDone && firstReplySent,
  };
}
