import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Card } from '@/components/ui';
import { TitleWithInfo } from './TitleWithInfo';
import { pagesApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { Page } from '@jawab24/shared';
import { resolveEffectiveReplyMode, type ReplyMode } from '@jawab24/shared';
import type { SettingsCardProps } from './types';

/** Per-page override choice: inherit the workspace default, or pin a mode. */
type PageChoice = 'inherit' | ReplyMode;

/**
 * «وضع الرد» — Reply mode: sales assistant (asks purchase-intent customers for
 * name/phone, lead capture active) vs information desk (answers only, routes the
 * customer to the business's own channels, never asks / never promises follow-up).
 *
 * Workspace default saves through the normal settings diff-PUT (setSettings);
 * per-page overrides save immediately per row via PATCH /pages/:id/reply-mode
 * (the leadStages per-page pattern — null reverts to inherit). The card renders
 * only for allowlisted workspaces (isReplyModeVisible) while the feature pilots.
 */
export function ReplyModeCard({ settings, setSettings }: SettingsCardProps) {
  const t = useTranslations('settings');
  const [pages, setPages] = useState<Page[]>([]);
  // Row-level save state so a failed PATCH restores the row instead of lying.
  const [savingPageId, setSavingPageId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    // Same tolerant accessor as ReplyStyleCard: backend returns Page[] directly,
    // some legacy paths wrap as { data: Page[] }.
    pagesApi.getAll().then((response) => {
      const list = Array.isArray(response.data) ? response.data : response.data?.data;
      if (Array.isArray(list)) setPages(list.filter((p: Page) => p.isConnected !== false));
    }).catch(() => { /* card degrades to workspace-default-only */ });
  }, []);

  const modeOptions: Array<{ value: ReplyMode; label: string; recommended?: boolean }> = [
    { value: 'sales', label: t('replyMode.sales'), recommended: true },
    { value: 'info', label: t('replyMode.infoDesk') },
  ];

  const workspaceMode: ReplyMode = settings.replyMode === 'info' ? 'info' : 'sales';

  const pageChoice = (p: Page): PageChoice =>
    p.replyMode === 'sales' || p.replyMode === 'info' ? p.replyMode : 'inherit';

  const savePageChoice = async (page: Page, choice: PageChoice) => {
    const previous = page.replyMode ?? null;
    const next = choice === 'inherit' ? null : choice;
    if (previous === next) return;
    setRowError(null);
    setSavingPageId(page.id);
    // Optimistic row update, rolled back on failure (pages.tsx toggle pattern).
    setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, replyMode: next } : p)));
    try {
      await pagesApi.updateReplyMode(page.id, next);
    } catch (error) {
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, replyMode: previous } : p)));
      setRowError(t('replyMode.pageUpdateError'));
      captureError(error, 'Reply mode page override save failed', { extra: { pageId: page.id } });
    } finally {
      setSavingPageId(null);
    }
  };

  return (
    <Card padding="none" className="border-none shadow-md shadow-theme-border/30 p-5 landscape:p-3">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl shrink-0">
          <Landmark className="w-6 h-6 landscape:w-5 landscape:h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 text-start min-w-0">
          <TitleWithInfo info={t('replyMode.info')} infoLabel={t('replyMode.title')}>
            <h3 id="reply-mode-label" className="font-bold text-foreground text-base landscape:text-sm">
              {t('replyMode.title')}
            </h3>
          </TitleWithInfo>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">{t('replyMode.desc')}</p>

          <div
            role="radiogroup"
            aria-labelledby="reply-mode-label"
            className="inline-flex rounded-xl border border-theme-border overflow-hidden"
          >
            {modeOptions.map((opt) => (
              <label
                key={opt.value}
                className={clsx(
                  'relative cursor-pointer select-none px-4 py-2.5 text-sm font-medium min-h-[44px] flex items-center gap-1.5',
                  'border-s border-theme-border first:border-s-0 transition-colors',
                  // Keyboard focus must be visible (WCAG 2.4.7): the radio itself is
                  // sr-only, so surface its focus on the label.
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 has-[:focus-visible]:z-10',
                  workspaceMode === opt.value
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-bold'
                    : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                {/* Native radio: correct semantics + arrow-key navigation for free. */}
                <input
                  type="radio"
                  name="replyMode"
                  value={opt.value}
                  checked={workspaceMode === opt.value}
                  onChange={() => setSettings({ ...settings, replyMode: opt.value })}
                  className="sr-only"
                />
                {opt.label}
                {opt.recommended && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full status-brand">
                    {t('recommended')}
                  </span>
                )}
              </label>
            ))}
          </div>

          {/* Dynamic one-liner per mode */}
          <p className="mt-2 text-sm text-muted-foreground animate-in fade-in text-start">
            {workspaceMode === 'sales' ? t('replyMode.salesDesc') : t('replyMode.infoDeskDesc')}
          </p>

          {/* Per-page overrides — only meaningful with several connected pages
              (the agency case this feature exists for). Rows save immediately. */}
          {pages.length > 1 && (
            <div className="mt-4 border-t border-theme-border pt-3">
              <p className="text-xs font-bold text-muted-foreground mb-2">{t('replyMode.perPageTitle')}</p>
              <ul className="space-y-2">
                {pages.map((page) => {
                  const choice = pageChoice(page);
                  const effective = resolveEffectiveReplyMode(page.replyMode, workspaceMode);
                  return (
                    <li key={page.id} className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-sm text-foreground truncate min-w-0" dir="auto">{page.name}</span>
                      <div
                        role="radiogroup"
                        aria-label={t('replyMode.pageRowLabel', { page: page.name ?? '' })}
                        className={clsx(
                          'inline-flex rounded-lg border border-theme-border overflow-hidden',
                          savingPageId === page.id && 'opacity-60 pointer-events-none',
                        )}
                      >
                        {(['inherit', 'sales', 'info'] as PageChoice[]).map((opt) => (
                          <label
                            key={opt}
                            className={clsx(
                              'cursor-pointer select-none px-2.5 py-1.5 text-xs font-medium min-h-[36px] flex items-center',
                              'border-s border-theme-border first:border-s-0 transition-colors',
                              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 has-[:focus-visible]:z-10',
                              choice === opt
                                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-bold'
                                : 'text-muted-foreground hover:bg-muted/60',
                            )}
                          >
                            <input
                              type="radio"
                              name={`replyMode-${page.id}`}
                              value={opt}
                              checked={choice === opt}
                              onChange={() => savePageChoice(page, opt)}
                              className="sr-only"
                            />
                            {opt === 'inherit'
                              ? t('replyMode.inherit', { mode: effectiveLabel(t, choice === 'inherit' ? effective : workspaceMode) })
                              : opt === 'sales' ? t('replyMode.sales') : t('replyMode.infoDesk')}
                          </label>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {rowError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{rowError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Localized label of a mode, for the «inherit (…)» chip. */
function effectiveLabel(t: ReturnType<typeof useTranslations<'settings'>>, mode: ReplyMode): string {
  return mode === 'info' ? t('replyMode.infoDesk') : t('replyMode.sales');
}
