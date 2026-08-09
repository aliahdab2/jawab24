import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui';
import { postSuggestionsApi } from '@/lib/api';
import { isPostSuggestionsVisible } from '@/lib/featureFlags';
import { useAuthStore } from '@/lib/store';
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import type { Page } from '@jawab24/shared';

// Lazy: the sheet is founder-only during the pilot and renders only when
// opened — the fleet-wide dashboard chunk must not carry it (ssr off: the
// dashboard is auth-gated, nothing here is server-rendered).
const PostSuggestionSheet = dynamic(
  () => import('@/components/post-suggestions/PostSuggestionSheet').then((m) => ({ default: m.PostSuggestionSheet })),
  { ssr: false },
);

/**
 * «بوست اليوم» dashboard card (pilot). Self-gating like PostReplyNudgeBanner:
 * renders null unless BOTH the build-time allowlist names one of this
 * workspace's pages AND the backend confirms (a 404 from the dark-feature
 * routes hides the card — deep links and stale builds fail closed).
 *
 * Page eligibility (owner ruling 2026-08-09): CONNECTED pages only — a
 * disconnected page can't be posted to, so offering it is a dead end; a
 * connected page with auto-reply OFF still shows (posting has nothing to do
 * with the reply master). Multiple eligible pages get a switcher.
 */
export function PostSuggestionCard({ pages }: { pages: Page[] }) {
  const t = useTranslations('postSuggestions');
  const { isAdmin } = useWorkspaceRole();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const eligiblePages = useMemo(() => {
    if (!isPostSuggestionsVisible(activeWorkspaceId)) return [];
    return pages.filter((p) => p.isConnected);
  }, [pages, activeWorkspaceId]);

  const selectedPage = eligiblePages.find((p) => p.id === selectedId) ?? eligiblePages[0] ?? null;
  const pageId = selectedPage?.id ?? null;

  const { data, isError } = useQuery({
    queryKey: ['post-suggestion-today', pageId],
    queryFn: async () => {
      const res = await postSuggestionsApi.getToday(pageId as string);
      return res.data;
    },
    enabled: Boolean(pageId),
    staleTime: 60_000,
    retry: false, // a 404 means "pilot off here" — retrying can't change that
  });

  if (!pageId || isError) return null;

  // React-query cache is the SINGLE source of truth: generation results are
  // written through to it (below), so day rollover and other admins' refetches
  // win naturally — no shadow copy that outlives the server state.
  const current = data ?? null;
  const hasPost = Boolean(current?.suggestion);
  // Nothing to show and nothing this member may do about it → no card.
  if (!hasPost && !isAdmin) return null;

  return (
    <>
      <div className="p-4 rounded-2xl border bg-brand-50/60 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800 transition-all">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500 text-white flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-200">{t('cardTitle')}</p>
            <p className="text-xs text-brand-800/80 dark:text-brand-300/80 mt-0.5">{t('cardDesc')}</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            {hasPost ? t('cardOpen') : t('cardCta')}
          </Button>
        </div>

        {eligiblePages.length > 1 && (
          <div role="tablist" aria-label={t('pageSwitcher')} className="flex flex-wrap gap-1.5 mt-3">
            {eligiblePages.map((p) => {
              const active = p.id === pageId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedId(p.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors max-w-[12rem] truncate',
                    active
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-card text-muted-foreground border-theme-border hover:border-brand-300',
                  )}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <PostSuggestionSheet
          key={pageId /* full reset when the page changes — no cross-page state bleed */}
          pageId={pageId}
          initial={current}
          canGenerate={isAdmin}
          onClose={() => setOpen(false)}
          onChanged={(latest) => queryClient.setQueryData(['post-suggestion-today', pageId], latest)}
        />
      )}
    </>
  );
}
