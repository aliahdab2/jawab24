import { useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import clsx from 'clsx';
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Rocket, X, Zap, Sparkles } from 'lucide-react';
import type { Page, UsageSummary } from '@jawab24/shared';
import { Card, Button } from '@/components/ui';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import {
  countSetupStepsDone,
  deriveSetupState,
  isWithinSetupGrace,
  SETUP_CHECKLIST_TOTAL_STEPS,
  type AutoReplyMasters,
} from '@/utils/setupChecklist';
import { KB_DEEP_LINK } from '@/utils/kb';
import { isRTLLocale } from '@/utils/locale';

interface SetupChecklistCardProps {
  pages: Page[];
  usage: UsageSummary | null;
  /** Workspace auto-reply masters (already loaded on the dashboard — D-026). */
  masters?: AutoReplyMasters | null;
  /** Opens the Post Reply post picker (usePostReplySetup on the dashboard). */
  onTryPostReply?: () => void;
  /** Settings' `onboardingCompletedAt` — one of the two setup-clock anchors. */
  onboardingCompletedAt?: string | Date | null;
  /**
   * Optional lifted "render expanded" state — the dashboard shares it with its
   * AutoReplyStatusCard suppression rule (that warning must resume the moment
   * this panel stops owning the "not enabled yet" message). Omitted → the card
   * derives it itself (standalone/tests).
   */
  expanded?: boolean;
  /** Persist the collapse (merchant pressed the collapse control). */
  onCollapse?: () => void;
}

// Persisted collapse. 365 days, matching the other long-lived dashboard nudges —
// with the grace window doing the automatic demotion, this only has to outlive
// the first few days, after which the window collapses the panel anyway.
//
// ⚠️ The storage STRING is deliberately the old `...DismissedAt` name: every
// merchant who already pressed the old dismiss button has that key set, and
// "collapsed" is exactly what they asked for. Renaming the string would replay
// the expanded card at them.
export const SETUP_CHECKLIST_COLLAPSE_KEY = 'setupChecklistDismissedAt';
export const SETUP_CHECKLIST_COLLAPSE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * "Start replying automatically" — the first-onboarding panel. Shows a brand-new
 * merchant the two ways to go live, easiest first (owner directive, D-026/D-027):
 *
 *   ⚡ Post Reply — pick a post, write your own reply. Works instantly, no
 *      Business Info, no AI, no switch (always-on by design, D-027).
 *   ✨ Smart Replies — add Business Info, turn the (truthful) master on.
 *
 * Derived live from data the dashboard already holds (no extra fetch). Hides
 * once EITHER path is live (`coreSetupDone || postReplyConfigured`) — the Post
 * Reply discovery nudge takes this slot for smart-path merchants (see
 * PostReplyNudgeBanner). Before any page is connected it collapses to the
 * single "connect your page" step.
 *
 * Two presentations, never a third "gone" state while setup is unfinished:
 *
 *   EXPANDED     the full panel, for the first `SETUP_CHECKLIST_GRACE_MS` of the
 *                merchant's setup clock, or until they collapse it.
 *   COLLAPSED    one row — icon, label, `n/3` progress, chevron — that expands
 *                on tap. This is where the panel lands afterwards.
 *
 * Collapsing rather than deleting is the point: this panel is the dashboard's
 * only activation path, so the merchant who has ignored it for days is precisely
 * the one who still needs it reachable.
 */
export function SetupChecklistCard({
  pages,
  usage,
  masters,
  onTryPostReply,
  onboardingCompletedAt,
  expanded: expandedProp,
  onCollapse,
}: SetupChecklistCardProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);

  // Internal fallback — used only when the host doesn't lift the expanded state
  // (hooks must run unconditionally).
  const internalCollapse = useTimedDismiss({
    key: SETUP_CHECKLIST_COLLAPSE_KEY,
    durationMs: SETUP_CHECKLIST_COLLAPSE_MS,
  });
  const collapse = onCollapse ?? internalCollapse.dismiss;

  // Tapping the collapsed row expands it for the rest of the session.
  // Deliberately NOT persisted and NOT lifted to the dashboard: re-expanding
  // must not shove the AutoReplyStatusCard around above it.
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);

  // Shared source of truth so this panel and the Post Reply nudge banner never
  // disagree about whether setup is finished.
  const setup = deriveSetupState(pages, usage, masters);

  // Hide ONLY when a path is live — collapsing never hides. `firstReplySent` is
  // passive and never keeps the panel alive.
  if (setup.coreSetupDone || setup.postReplyConfigured) return null;

  const defaultExpanded =
    expandedProp ??
    (isWithinSetupGrace(pages, onboardingCompletedAt) && !internalCollapse.dismissed);
  const expanded = manualExpanded ?? defaultExpanded;

  if (!expanded) {
    const stepsDone = countSetupStepsDone(setup);
    // Keeps `.card`'s border, unlike the expanded panel: a single row needs the
    // outline to read as a distinct element rather than floating text.
    return (
      <Card className="bg-card" padding="none">
        <button
          type="button"
          onClick={() => setManualExpanded(true)}
          aria-expanded={false}
          className="w-full flex items-center gap-3 p-3 sm:px-4 text-start rounded-[1.5rem] hover:bg-muted/50 transition-colors"
        >
          <span
            className="icon-bg-brand w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
          >
            <Rocket className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0 text-sm font-semibold text-foreground truncate">
            {t('setupChecklist.collapsedTitle')}
          </span>
          {/* Digits stay LTR in both locales — a bare "1/3" must not be reordered. */}
          <span
            dir="ltr"
            className="text-xs font-bold text-brand-600 dark:text-brand-400 flex-shrink-0 tabular-nums"
          >
            {stepsDone}/{SETUP_CHECKLIST_TOTAL_STEPS}
          </span>
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </Card>
    );
  }

  const handleCollapse = () => {
    setManualExpanded(false);
    collapse();
  };

  const chevron = (
    <ChevronRight
      className={clsx(
        'w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors',
        isRTL && 'rotate-180',
      )}
      aria-hidden="true"
    />
  );

  return (
    <Card className="border-none shadow-2xl shadow-brand-500/10 bg-card" padding="none">
      {/* Header */}
      <div className="p-4 sm:p-5 flex items-start justify-between gap-4 border-b border-theme-border bg-background/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="icon-bg-brand w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
            <Rocket className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-display font-bold text-foreground tracking-tight">
              {t('setupChecklist.pathsTitle')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {setup.pageConnected ? t('setupChecklist.pathsSubtitle') : t('setupChecklist.subtitle')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCollapse}
          aria-expanded={true}
          aria-label={t('setupChecklist.collapse')}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {!setup.pageConnected ? (
        /* No page yet — everything starts with connecting one. */
        <div className="p-3 sm:p-4">
          <Link
            href="/pages"
            className="group flex items-center gap-3 px-3 py-2.5 rounded-xl ring-1 ring-brand-500/30 bg-brand-50/40 dark:bg-brand-500/5 hover:bg-brand-50/70 dark:hover:bg-brand-500/10 transition-colors"
          >
            <Circle className="w-5 h-5 flex-shrink-0 text-icon-muted" aria-hidden="true" />
            <span className="flex-1 text-sm font-semibold text-foreground">
              {t('setupChecklist.stepConnect')}
            </span>
            {chevron}
          </Link>
        </div>
      ) : (
        <div className="p-3 sm:p-4 space-y-3">
          {/* ⚡ Quick path — Post Reply (always-on, zero Business Info, D-027) */}
          <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/30 p-3.5">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-sky-500 text-white flex items-center justify-center flex-shrink-0" aria-hidden="true">
                <Zap className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-sky-900 dark:text-sky-200">
                {t('setupChecklist.quickTitle')}
              </h3>
            </div>
            <p className="text-xs mt-1.5 text-sky-800/80 dark:text-sky-300/80">
              {t('setupChecklist.quickDesc')}
            </p>
            {onTryPostReply && (
              <Button size="sm" variant="primary" className="mt-2.5 text-xs" onClick={onTryPostReply}>
                {t('setupChecklist.quickCta')}
              </Button>
            )}
          </div>

          {/* ✨ Smart path — AI replies from Business Info */}
          <div className="rounded-xl border border-theme-border p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="icon-bg-brand w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" aria-hidden="true">
                <Sparkles className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-foreground">
                {t('setupChecklist.smartTitle')}
              </h3>
            </div>
            <ul className="space-y-1">
              {/* Step 1 — Business Info (what replies are generated from) */}
              {setup.kbFilled ? (
                <li className="flex items-center gap-3 px-2 py-2 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  <span className="text-sm font-medium text-muted-foreground line-through decoration-1">
                    {t('setupChecklist.stepKb')}
                  </span>
                  <span className="ms-auto text-[11px] font-semibold text-brand-600 dark:text-brand-400">
                    {t('setupChecklist.done')}
                  </span>
                </li>
              ) : (
                <li>
                  <Link
                    href={KB_DEEP_LINK}
                    className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/60 transition-colors"
                  >
                    <Circle className="w-5 h-5 flex-shrink-0 text-icon-muted" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{t('setupChecklist.stepKb')}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full status-brand flex-shrink-0">
                          {t('setupChecklist.stepKbBadge')}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{t('setupChecklist.stepKbHint')}</p>
                    </div>
                    {chevron}
                  </Link>
                </li>
              )}
              {/* Step 2 — turn the (truthful, D-026) master on */}
              {setup.autoReplyOn ? (
                <li className="flex items-center gap-3 px-2 py-2 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  <span className="text-sm font-medium text-muted-foreground line-through decoration-1">
                    {t('setupChecklist.stepEnable')}
                  </span>
                  <span className="ms-auto text-[11px] font-semibold text-brand-600 dark:text-brand-400">
                    {t('setupChecklist.done')}
                  </span>
                </li>
              ) : (
                <li>
                  <Link
                    href="/settings"
                    className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/60 transition-colors"
                  >
                    <Circle className="w-5 h-5 flex-shrink-0 text-icon-muted" aria-hidden="true" />
                    <span className="flex-1 text-sm font-semibold text-foreground">
                      {t('setupChecklist.stepEnable')}
                    </span>
                    {chevron}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
