import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { AlignLeft, CalendarClock, ImageOff, Loader2 } from 'lucide-react';
import type { Page, PublishedPost, PublishedPostsResponse } from '@jawab24/shared';
import { Modal, Button, Select, FacebookIcon, InstagramIcon } from '@/components/ui';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';
import { postsApi } from '@/lib/api';
import { isPageAutoReplyEnabled } from '@/utils/page';
import { useLanguage } from '@/i18n/hooks';
import { formatMessageTime, formatScheduledTime } from '@/utils/dateUtils';

type Source = 'facebook' | 'instagram';

/** Remembers the last page the merchant picked, so reopening the sheet doesn't
 *  reset to the first page every time. The sheet is unmounted on close
 *  (usePostReplySetup gates it behind `pickerOpen`), so the restore happens in
 *  the useState initializer on remount. */
const PICKER_PAGE_STORAGE_KEY = 'post-reply-picker-page';

export interface PickedPost {
  pageId: string;
  source: Source;
  platformPostId: string;
  postMessage: string | null;
  /** True when the merchant picked a post from the scheduled edge — i.e. not live yet.
   *  Independent of `scheduledPublishTime` because Graph can report a pending post with
   *  no time, and "no time" must not read as "already published". */
  isScheduled?: boolean;
  /** ISO publish time when the merchant picked a still-scheduled post; null otherwise.
   *  Carried so the trigger modal can say the reply will wait for the post to go live
   *  without a second round-trip. The server re-reads it from Graph regardless — this
   *  value is for copy, never for persistence. */
  scheduledPublishTime?: string | null;
}

interface PostPickerSheetProps {
  /** Connected pages (FB/IG). WhatsApp-only pages are filtered out — Post Reply is
   *  a comment feature. */
  pages: Page[];
  isOpen: boolean;
  onClose: () => void;
  /** Called when the merchant taps a post; the parent runs ensure-post + opens the
   *  trigger modal (see usePostReplySetup). */
  onPick: (post: PickedPost) => void;
}

/** Pages that can host a Post Reply: connected, auto-reply ON, with a FB page or an
 *  IG account. Auto-reply must be on because the comment pipeline hard-gates on it
 *  (commentProcessor step 1 returns early when `autoReplyEnabled` is false), so a
 *  trigger configured on a paused page would silently never fire — showing such a
 *  page in the picker is misleading. WhatsApp-only pages have neither channel id and
 *  are excluded (Post Reply is a comment feature). */
export function pickablePages(pages: Page[]): Page[] {
  return pages.filter(
    (p) => p.isConnected !== false && isPageAutoReplyEnabled(p) && (p.facebookPageId || p.instagramAccountId),
  );
}

function readStoredPageId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(PICKER_PAGE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The last-picked page if it's still pickable, else the first candidate. */
export function initialPage(candidates: Page[]): Page | undefined {
  const stored = readStoredPageId();
  return candidates.find((p) => p.id === stored) ?? candidates[0];
}

export function PostPickerSheet({ pages, isOpen, onClose, onPick }: PostPickerSheetProps) {
  const t = useTranslations('comments');
  const { dateLocale } = useLanguage();

  const candidates = useMemo(() => pickablePages(pages), [pages]);
  const [pageId, setPageId] = useState<string>(() => initialPage(candidates)?.id ?? '');
  const selectedPage = candidates.find((p) => p.id === pageId) ?? candidates[0];
  const hasBoth = !!(selectedPage?.facebookPageId && selectedPage?.instagramAccountId);
  const [source, setSource] = useState<Source>(() =>
    initialPage(candidates)?.facebookPageId ? 'facebook' : 'instagram',
  );
  // Resolve the effective source for the selected page (a FB-only page can't show IG).
  const effectiveSource: Source = selectedPage?.facebookPageId
    ? (hasBoth ? source : 'facebook')
    : 'instagram';

  const query = useInfiniteQuery({
    queryKey: ['published-posts', pageId, effectiveSource],
    enabled: isOpen && !!pageId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data } = await postsApi.getPublishedPosts(pageId, {
        source: effectiveSource,
        after: pageParam,
        // This build renders scheduled posts, so it opts in. The flag exists for older
        // shipped app bundles that don't — see the server-side comment on the param.
        includeScheduled: true,
      });
      return data as PublishedPostsResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const posts: PublishedPost[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.posts) ?? [],
    [query.data],
  );

  // A Graph read failed, or the scheduled edge hit its ceiling: the list is knowingly
  // incomplete. Say so — a token problem silently rendering as "you have no posts" is
  // how a merchant concludes the feature is broken.
  const isPartial = query.data?.pages.some((p) => p.partial) ?? false;

  function handleSelectPage(id: string) {
    setPageId(id);
    const p = candidates.find((c) => c.id === id);
    setSource(p?.facebookPageId ? 'facebook' : 'instagram');
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(PICKER_PAGE_STORAGE_KEY, id);
      } catch {
        // localStorage unavailable (e.g. private mode) — selection just won't persist.
      }
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('postPickerTitle')}
      titleIcon={<PostReplyIcon className={clsx('w-5 h-5', postReplyIconClass)} aria-hidden="true" />}
      size="md"
      mobilePresentation="sheet"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground leading-relaxed">{t('postPickerSubtitle')}</p>

        {/* Page selector — only when the merchant has more than one connected page.
            The shared Select, NOT a native <select>: a native select's open list
            is OS-drawn, so in dark mode it popped up WHITE (the UA ignores our
            CSS there), and native selects misbehave inside modals on iOS — the
            two problems the shared component exists to solve. */}
        {candidates.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span id="post-picker-page-label" className="text-xs font-semibold text-muted-foreground">{t('postPickerPageLabel')}</span>
            <Select
              value={pageId}
              onChange={handleSelectPage}
              options={candidates.map((p) => ({ value: p.id, label: p.name }))}
              aria-labelledby="post-picker-page-label"
            />
          </div>
        )}

        {/* Source toggle — only when the selected page has both FB and IG. */}
        {hasBoth && (
          <div role="radiogroup" aria-label={t('postPickerSourceLabel')} className="grid grid-cols-2 gap-2">
            {(['facebook', 'instagram'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={effectiveSource === s}
                onClick={() => setSource(s)}
                className={clsx(
                  'inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  effectiveSource === s
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                    : 'border-surface-200 dark:border-surface-700 text-muted-foreground hover:bg-surface-50 dark:hover:bg-surface-800',
                )}
              >
                {s === 'facebook'
                  ? <FacebookIcon className="w-4 h-4" aria-hidden="true" />
                  : <InstagramIcon className="w-4 h-4" aria-hidden="true" />}
                {s === 'facebook' ? t('postPickerSourceFacebook') : t('postPickerSourceInstagram')}
              </button>
            ))}
          </div>
        )}

        {/* Post list */}
        {candidates.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t('postPickerNoActivePages')}</div>
        ) : query.isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          </div>
        ) : query.isError ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <p>{t('postPickerError')}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => query.refetch()}>
              {t('postPickerRetry')}
            </Button>
          </div>
        ) : posts.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <p>{t('postPickerEmpty')}</p>
            {/* An empty list that is also incomplete is the dangerous case: without this
                a failed Graph read is indistinguishable from "this page has no posts". */}
            {isPartial && <p className="mt-2">{t('postPickerPartial')}</p>}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {posts.map((post) => (
              <li key={`${post.source}:${post.platformPostId}`}>
                <button
                  type="button"
                  onClick={() => onPick({
                    pageId,
                    source: post.source,
                    platformPostId: post.platformPostId,
                    postMessage: post.message,
                    isScheduled: !!post.isScheduled,
                    scheduledPublishTime: post.scheduledPublishTime ?? null,
                  })}
                  className="w-full flex items-center gap-3 rounded-xl border border-theme-border p-2.5 text-start hover:bg-muted/60 transition-colors"
                >
                  <PostThumb imageUrl={post.imageUrl} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate" dir="auto">
                      {post.message?.trim() || t('postPickerNoText')}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-subtle">
                      {/* A scheduled post has no publish date or comments yet, so it shows
                          when it WILL go live instead of the published post's metadata.
                          Keyed off `isScheduled` (which edge it came from), NOT off the
                          timestamp: Graph can hand back a pending post with no
                          scheduled_publish_time, and that must still read as "not live"
                          rather than silently rendering as a published post. */}
                      {post.isScheduled ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded status-warning font-medium">
                          <CalendarClock className="w-3 h-3" aria-hidden="true" />
                          {post.scheduledPublishTime
                            ? t('postPickerScheduledFor', {
                                time: formatScheduledTime(post.scheduledPublishTime, dateLocale),
                              })
                            : t('postPickerScheduledUnknownTime')}
                        </span>
                      ) : (
                        <>
                          {post.createdTime && <span>{formatMessageTime(post.createdTime, dateLocale)}</span>}
                          {post.commentsCount != null && post.commentsCount > 0 && (
                            <span>{t('postPickerCommentCount', { count: post.commentsCount })}</span>
                          )}
                        </>
                      )}
                    </span>
                  </span>
                  {post.hasTrigger ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 whitespace-nowrap">
                      <PostReplyIcon className="w-3 h-3" aria-hidden="true" />
                      {t('postPickerActive')}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface-100 dark:bg-surface-200 text-muted-foreground whitespace-nowrap">
                      {t('postPickerSetup')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Non-empty but incomplete — a Graph read failed, or there are more pending posts
            than the scheduled edge returns. Never let a capped list read as the whole list. */}
        {isPartial && posts.length > 0 && (
          <p className="text-xs text-muted-foreground text-center" role="status">{t('postPickerPartial')}</p>
        )}

        {query.hasNextPage && (
          <Button
            size="sm"
            variant="secondary"
            className="self-center"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : t('postPickerLoadMore')}
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** Square thumbnail with a glyph fallback. Facebook/Instagram CDN URLs are signed and
 *  rotate hosts, so a plain lazy <img> with an error fallback is more robust here than
 *  next/image remote patterns; it's a small thumbnail, not LCP.
 *
 *  Two distinct no-image states, deliberately not the platform logo (which carries no
 *  recognition value — the list is already scoped to one source):
 *   - no `full_picture` → genuinely text-only post → a text glyph.
 *   - image present but load errored → an "image unavailable" glyph, so a transient CDN
 *     blip doesn't masquerade as a text-only post. */
function PostThumb({ imageUrl }: { imageUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) {
    const Glyph = imageUrl ? ImageOff : AlignLeft;
    return (
      <span className="w-12 h-12 rounded-lg bg-surface-100 dark:bg-surface-200 flex items-center justify-center flex-shrink-0 text-icon-muted">
        <Glyph className="w-5 h-5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={imageUrl}
      alt=""
      loading="lazy"
      width={48}
      height={48}
      onError={() => setFailed(true)}
      className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
    />
  );
}
