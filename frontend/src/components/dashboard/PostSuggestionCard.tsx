import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Sparkles, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui';
import { postSuggestionsApi, type PostSuggestionResponse } from '@/lib/api';
import { isPostSuggestionsVisible } from '@/lib/featureFlags';
import { useAuthStore } from '@/lib/store';
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import { POST_SUGGESTION_POLL_MS } from '@/components/post-suggestions/polling';
import { mergePostSuggestionResponse } from '@/components/post-suggestions/mergeResponse';
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
 * renders null unless BOTH the build-time allowlist names this workspace AND
 * the backend confirms (a 404 from the dark-feature routes hides the card —
 * deep links and stale builds fail closed).
 *
 * Page eligibility (owner ruling 2026-08-09): CONNECTED pages only — a
 * disconnected page can't be posted to, so offering it is a dead end; a
 * connected page with auto-reply OFF still shows (posting has nothing to do
 * with the reply master). Multiple eligible pages get a switcher.
 *
 * Shows the REAL post — thumbnail, angle, and the opening lines — rather than
 * a generic "you have a post" banner: the card sits above the inbox, and in
 * that slot the content itself is what earns the click.
 */
export function PostSuggestionCard({ pages }: { pages: Page[] }) {
  const t = useTranslations('postSuggestions');
  const { isAdmin } = useWorkspaceRole();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The URL that failed to load — NOT a boolean. A regenerate writes a new
  // suggestion (new imageUrl) straight into the query cache, and a sticky
  // boolean would keep hiding the good new image until remount.
  const [failedThumbUrl, setFailedThumbUrl] = useState<string | null>(null);

  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const eligiblePages = useMemo(() => {
    if (!isPostSuggestionsVisible(activeWorkspaceId)) return [];
    return pages.filter((p) => p.isConnected);
  }, [pages, activeWorkspaceId]);

  const selectedPage = eligiblePages.find((p) => p.id === selectedId) ?? eligiblePages[0] ?? null;
  const pageId = selectedPage?.id ?? null;

  const { data, isError } = useQuery({
    queryKey: ['post-suggestion-current', pageId],
    queryFn: async () => {
      const res = await postSuggestionsApi.getCurrent(pageId as string);
      return res.data;
    },
    enabled: Boolean(pageId),
    staleTime: 60_000,
    retry: false, // a 404 means "pilot off here" — retrying can't change that
    // Generation runs ~35s in a worker, so a row can be pending when this
    // renders — a merchant who started one and closed the sheet must still see
    // it land. Polled ONLY while the sheet is closed: the open sheet runs the
    // foreground poll and writes through to this same cache entry, and two
    // pollers on one key would race each other's writes for no benefit.
    refetchInterval: (query) =>
      (!open && query.state.data?.inFlight?.status === 'pending' ? POST_SUGGESTION_POLL_MS : false),
  });

  if (!pageId || isError) return null;

  // React-query cache is the SINGLE source of truth: generation results are
  // written through to it (below), so day rollover and other admins' refetches
  // win naturally — no shadow copy that outlives the server state.
  const current = data ?? null;
  // `suggestion` is the page's POST; a row still being written — or one that
  // ended in failure — is `inFlight` and never a post to preview (its text is
  // empty by design, since a placeholder sentence would be copied by any client
  // that ignores `status`). The card announces the work instead, and a FAILED
  // attempt leaves the previous post on the card rather than replacing it with
  // an empty preview line that no longer clears (the day scope used to clear
  // it; on-demand nothing does).
  const suggestion = current?.suggestion ?? null;
  const pending = current?.inFlight?.status === 'pending';
  const hasPost = Boolean(suggestion);
  // Nothing to show and nothing this member may do about it → no card.
  if (!hasPost && !pending && !isAdmin) return null;

  // A text-only post (image degraded / cleaned up) keeps the brand tile rather
  // than a broken frame — same for a thumbnail whose URL fails to load. Any
  // OTHER url (regenerate, page switch) is tried again on its own merits.
  const imageUrl = suggestion?.imageUrl ?? null;
  const thumbUrl = imageUrl && imageUrl !== failedThumbUrl ? imageUrl : null;

  return (
    <>
      {/* Owns its own bottom margin: the dashboard renders this unwrapped, so a
          null return (every non-pilot workspace) must leave NO stray gap. */}
      <div className="mb-8 p-4 sm:p-5 rounded-2xl border bg-brand-50/60 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800">
        {/* Wraps on narrow screens: the action drops to its own full-width row
            instead of squeezing the preview. One DOM, responsive — never a
            duplicated mobile/desktop copy. */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {thumbUrl ? (
            <img
              // Generated media on object storage; not a build-time asset and the
              // host is outside next.config remotePatterns, so next/image can't
              // serve it (same call the sheet makes).
              src={thumbUrl}
              alt={t('postImageAlt')}
              loading="lazy"
              onError={() => setFailedThumbUrl(thumbUrl)}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover flex-shrink-0 border border-brand-200 dark:border-brand-800"
            />
          ) : (
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-brand-500 text-white flex items-center justify-center flex-shrink-0"
              aria-hidden="true"
            >
              {/* Same tile, spinning: the slot the image will occupy is already
                  reserved, so nothing shifts when it lands (CLS). */}
              {pending
                ? <RefreshCw className="w-7 h-7 sm:w-8 sm:h-8 animate-spin motion-reduce:animate-none" />
                : <Sparkles className="w-7 h-7 sm:w-8 sm:h-8" />}
            </div>
          )}

          <div className="flex-1 min-w-[10rem]">
            <div className="flex items-center gap-2 flex-wrap">
              {/* h2: this is now a top-level dashboard section, peer to the
                  inbox headings — h1 is the PageHeader, so no level is skipped. */}
              <h2 className="text-sm sm:text-base font-semibold text-brand-900 dark:text-brand-200">
                {t('cardTitle')}
              </h2>
              {hasPost && suggestion && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-brand-500/10 dark:bg-brand-400/15 text-brand-800 dark:text-brand-400">
                  {t(`type_${suggestion.postType}`)}
                </span>
              )}
            </div>
            <p
              dir="auto"
              aria-live={pending ? 'polite' : undefined}
              aria-busy={pending || undefined}
              className={clsx(
                'mt-1 text-xs sm:text-sm leading-relaxed',
                hasPost
                  ? 'text-foreground/80 line-clamp-2'
                  : 'text-brand-800/80 dark:text-brand-400/80',
              )}
            >
              {pending ? t('generating') : hasPost && suggestion ? suggestion.text : t('cardDesc')}
            </p>
          </div>

          <Button
            size="sm"
            onClick={() => setOpen(true)}
            className="w-full sm:w-auto flex-shrink-0"
            // Opening a pending row shows the same "writing…" state the card
            // already shows, so the action waits until there is a post to open.
            disabled={pending}
          >
            {/* "View" while pending, not "Suggest a post": a post IS coming,
                and a disabled CTA to start one reads as "you may not do this"
                rather than "this is nearly ready". */}
            {hasPost || pending ? t('cardOpen') : t('cardCta')}
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
          // MERGED, not replaced — see mergePostSuggestionResponse: the
          // generate route deliberately carries no `history`, and writing its
          // response wholesale blanked the strip in the cache.
          onChanged={(latest) => queryClient.setQueryData<PostSuggestionResponse>(
            ['post-suggestion-current', pageId],
            (prev) => mergePostSuggestionResponse(prev, latest),
          )}
        />
      )}
    </>
  );
}
