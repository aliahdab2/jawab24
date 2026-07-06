import type { Page, UsageSummary } from '@jawab24/shared';
import { isKbFilled } from './kb';

/**
 * The four onboarding milestones, derived live from data the dashboard already
 * holds (no extra fetch). Single source of truth shared by SetupChecklistCard
 * (renders the steps) and PostReplyNudgeBanner (shows only once `allDone`), so the
 * two can never disagree about whether setup is finished.
 */
export interface SetupState {
  pageConnected: boolean;
  kbFilled: boolean;
  autoReplyOn: boolean;
  firstReplySent: boolean;
  /** All four milestones complete. */
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

  return {
    pageConnected,
    kbFilled,
    autoReplyOn,
    firstReplySent,
    allDone: pageConnected && kbFilled && autoReplyOn && firstReplySent,
  };
}
