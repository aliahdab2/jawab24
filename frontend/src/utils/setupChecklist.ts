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
 * Where the "turn on auto-reply" surfaces send a merchant who still has no
 * active channel. Mirrors the two off-states the reply pipeline can be in (D-026):
 *  - masters OFF → the workspace master is what's missing → `/settings`
 *  - masters ON  → the per-channel page toggle is what's missing → `/pages`
 *
 * Instagram and WhatsApp pages arrive with their page toggle OFF — only Facebook
 * arrives enabled — so a merchant whose masters are already on but whose channel
 * is still silent is one page-level switch away from live, and that switch lives
 * on `/pages`, never `/settings`. The setup checklist and the AutoReplyStatusCard
 * both call this, so the two can never point at different screens for the same
 * state (the exact drift that left a WhatsApp merchant hunting `/settings` while
 * the switch he needed sat on `/pages`).
 */
export function autoReplyEnableDestination(
  masters: AutoReplyMasters | null | undefined,
): '/pages' | '/settings' {
  return masters && (masters.commentsAutoReply || masters.messagesAutoReply)
    ? '/pages'
    : '/settings';
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

/**
 * How long the setup panel keeps the dashboard's hero slot. After this it demotes
 * to a one-line row (still one tap from the steps) instead of holding the top of
 * the dashboard forever for a merchant who never finished and never dismissed it.
 *
 * Deliberately a DURATION, not an impression count: a localStorage view-counter
 * is per-device (phone + desktop = two independent counts), resets when site data
 * is cleared, and — worst — would delete the only activation path on the dashboard
 * for exactly the merchants who haven't activated. Demote, never remove.
 */
export const SETUP_CHECKLIST_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** The three merchant-actionable Smart-Reply milestones, for "1/3"-style progress. */
export const SETUP_CHECKLIST_TOTAL_STEPS = 3;

/** How many of the three actionable milestones are done. */
export function countSetupStepsDone(setup: SetupState): number {
  return [setup.pageConnected, setup.kbFilled, setup.autoReplyOn].filter(Boolean).length;
}

function toMillis(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When this merchant's setup clock started — the earliest evidence we have that
 * the panel has been in front of them. Two complementary anchors, both already
 * loaded on the dashboard, so this needs no new column, no impression counter,
 * and behaves identically on every device:
 *
 *  - `onboardingCompletedAt` (settings) — written when the welcome wizard is
 *    finished or skipped. Covers the merchant with no page yet, since the wizard
 *    only runs while `pages.length === 0`.
 *  - the oldest page's `createdAt` — the moment the Business-Info and auto-reply
 *    steps became actionable at all. Covers legacy accounts whose
 *    `onboardingCompletedAt` was never backfilled (that backfill also only runs
 *    while `pages.length === 0`, so an old account WITH pages keeps a null).
 *
 * Disconnected pages count here, unlike in `deriveSetupState`: a revoked page is
 * still proof the merchant has been around, even though it contributes nothing to
 * progress. The two functions answer different questions.
 *
 * Returns null when neither anchor exists — a genuinely brand-new merchant, who
 * should get the expanded panel.
 */
export function resolveSetupClockStart(
  pages: Page[],
  onboardingCompletedAt?: string | Date | null,
): number | null {
  const candidates = [
    toMillis(onboardingCompletedAt),
    ...pages.map((p) => toMillis(p.createdAt)),
  ].filter((ms): ms is number => ms !== null);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * True while the panel should still render expanded. No anchor (brand-new
 * merchant) also counts as within the window — we only demote on positive
 * evidence that the account is old.
 */
export function isWithinSetupGrace(
  pages: Page[],
  onboardingCompletedAt?: string | Date | null,
  now: number = Date.now(),
): boolean {
  const start = resolveSetupClockStart(pages, onboardingCompletedAt);
  return start === null || now - start < SETUP_CHECKLIST_GRACE_MS;
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
