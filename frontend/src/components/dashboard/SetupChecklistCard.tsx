import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import clsx from 'clsx';
import { CheckCircle2, Circle, ChevronRight, Rocket, X } from 'lucide-react';
import type { Page, UsageSummary } from '@jawab24/shared';
import { Card } from '@/components/ui';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';
import { isKbFilled } from '@/utils/kb';
import { isRTLLocale } from '@/utils/locale';

interface SetupChecklistCardProps {
  pages: Page[];
  usage: UsageSummary | null;
}

interface ChecklistStep {
  key: string;
  /** i18n key under setupChecklist for the step label */
  labelKey: string;
  done: boolean;
  href: string;
}

// 14 days: a dismissed-but-unfinished checklist gently re-surfaces. Once all four
// steps are done the card hides regardless of dismissal (see `allDone` below), so
// a finished merchant never sees it again. No `count` param — we don't want
// completing a step to un-dismiss the card mid-session.
const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * "Finish your setup" activation checklist. Renders the four onboarding
 * milestones (connect → business info → auto-reply → first reply) with a
 * progress bar, derived live from data the dashboard already holds (no extra
 * fetch). Hides itself once every step is complete, and is manually dismissible.
 */
export function SetupChecklistCard({ pages, usage }: SetupChecklistCardProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);

  const { dismissed, dismiss } = useTimedDismiss({
    key: 'setupChecklistDismissedAt',
    durationMs: DISMISS_DURATION_MS,
  });

  // Disconnected pages (Facebook access revoked) don't count toward setup — mirror
  // the rest of the dashboard, which filters them out before deriving state.
  const connectedPages = pages.filter((p) => p.isConnected !== false);

  const pageConnected = connectedPages.length > 0;
  const kbFilled = connectedPages.some(isKbFilled);
  const autoReplyOn = connectedPages.some((p) => p.autoReplyEnabled || p.instagramAutoReplyEnabled);
  // A reply has been sent (per-page joined count), with monthly usage as a fallback.
  const firstReplySent =
    connectedPages.some((p) => (p.repliesCount ?? 0) > 0) || (usage?.aiReplies?.used ?? 0) > 0;

  const steps: ChecklistStep[] = [
    { key: 'connect', labelKey: 'stepConnect', done: pageConnected, href: '/pages' },
    { key: 'kb', labelKey: 'stepKb', done: kbFilled, href: '/pages?openKb=true' },
    { key: 'enable', labelKey: 'stepEnable', done: autoReplyOn, href: '/settings' },
    { key: 'firstReply', labelKey: 'stepFirstReply', done: firstReplySent, href: '/comments' },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = doneCount === total;

  // Hide when finished (don't show a completed checklist) or when dismissed.
  if (allDone || dismissed) return null;

  const progressPct = Math.round((doneCount / total) * 100);

  return (
    <Card className="border-none shadow-2xl shadow-brand-500/10 bg-card" padding="none">
      <div className="p-4 sm:p-5 flex items-start justify-between gap-4 border-b border-theme-border bg-background/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="icon-bg-brand w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
            <Rocket className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-display font-bold text-foreground tracking-tight">
              {t('setupChecklist.titleWithProgress', { done: doneCount, total })}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('setupChecklist.subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('setupChecklist.dismiss')}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-4 sm:px-5 pt-4">
        <div
          className="w-full h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={doneCount}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <ul className="p-3 sm:p-4 space-y-1">
        {steps.map((step) => {
          const label = t(`setupChecklist.${step.labelKey}` as Parameters<typeof t>[0]);
          if (step.done) {
            return (
              <li
                key={step.key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              >
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                <span className="text-sm font-medium text-muted-foreground line-through decoration-1">
                  {label}
                </span>
                <span className="ms-auto text-[11px] font-semibold text-brand-600 dark:text-brand-400">
                  {t('setupChecklist.done')}
                </span>
              </li>
            );
          }
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/60 transition-colors"
              >
                <Circle className="w-5 h-5 flex-shrink-0 text-icon-muted" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground">{label}</span>
                <ChevronRight
                  className={clsx(
                    'ms-auto w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors',
                    isRTL && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
