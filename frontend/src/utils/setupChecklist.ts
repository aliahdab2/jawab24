import type { Page, UsageSummary } from '@jawab24/shared';
import { isKbFilled } from './kb';

/**
 * Workspace-level auto-reply masters (the switches the reply pipeline actually
 * obeys — D-026). Passed in from the dashboard's already-loaded settings query;
 * callers without them (legacy/tests) omit the param and get page-level-only
 * derivation.
 */
export interface AutoReplyMasters {
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
}

/**
 * The onboarding milestones, derived live from data the dashboard already
 * holds (no extra fetch). Single source of truth shared by SetupChecklistCard
 * (renders the two setup paths + decides when to hide) and PostReplyNudgeBanner
 * (shows once `coreSetupDone`), so the two can never disagree about progress.
 */
export interface SetupState {
  pageConnected: boolean;
  kbFilled: boolean;
  autoReplyOn: boolean;
  firstReplySent: boolean;
  /**
   * The merchant configured a Post Reply trigger on at least one post — the
   * "quick path" is live (Post Reply is always-on by design; configuration IS
   * activation, D-027).
   */
  postReplyConfigured: boolean;
  /**
   * The three merchant-actionable Smart-Reply milestones are done (page +
   * business info + auto-reply effectively ON). This is the point where active
   * setup is finished — the merchant has done everything they can;
   * `firstReplySent` is passive (it only flips when a real customer messages).
   * The checklist hides and the Post Reply nudge takes its slot here.
   */
  coreSetupDone: boolean;
  /** All milestones complete (incl. the passive first-reply-sent). */
  allDone: boolean;
}

export function deriveSetupState(
  pages: Page[],
  usage: UsageSummary | null,
  masters?: AutoReplyMasters | null,
): SetupState {
  // Disconnected pages (Facebook access revoked) don't count toward setup — mirror
  // the rest of the dashboard, which filters them out before deriving state.
  const connectedPages = pages.filter((p) => p.isConnected !== false);

  const pageConnected = connectedPages.length > 0;
  // "Business info" is satisfied by either a filled free-text KB or a native
  // catalog with at least one item — both give the AI something to answer from.
  const kbFilled = connectedPages.some((p) => isKbFilled(p) || (p.catalogItemsCount ?? 0) > 0);
  const pageLevelOn = connectedPages.some(
    (p) => p.autoReplyEnabled || p.instagramAutoReplyEnabled || p.whatsappAutoReplyEnabled,
  );
  // Effective state (D-026): the workspace master gates every AI reply, so a
  // page-level toggle alone must not count as "on" — that was exactly the lie
  // that let new signups complete the checklist with a pipeline that never
  // replies. OR-semantics across the two masters matches AutoReplyStatusCard.
  // Callers that don't have the masters loaded omit the param (legacy behavior).
  const autoReplyOn =
    pageLevelOn && (masters ? masters.commentsAutoReply || masters.messagesAutoReply : true);
  // A reply has been sent (per-page joined count), with monthly usage as a fallback.
  const firstReplySent =
    connectedPages.some((p) => (p.repliesCount ?? 0) > 0) || (usage?.aiReplies?.used ?? 0) > 0;
  // Quick path: a configured trigger means Post Reply is live (D-027 — it fires
  // regardless of the masters).
  const postReplyConfigured = connectedPages.some((p) => p.hasPostReplyTrigger === true);

  const coreSetupDone = pageConnected && kbFilled && autoReplyOn;

  return {
    pageConnected,
    kbFilled,
    autoReplyOn,
    firstReplySent,
    postReplyConfigured,
    coreSetupDone,
    allDone: coreSetupDone && firstReplySent,
  };
}
