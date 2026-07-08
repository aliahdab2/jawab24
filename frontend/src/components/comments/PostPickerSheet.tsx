import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import type { Page, PublishedPost, PublishedPostsResponse } from '@jawab24/shared';
import { Modal, Button, FacebookIcon, InstagramIcon } from '@/components/ui';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';
import { postsApi } from '@/lib/api';
import { useLanguage } from '@/i18n/hooks';
import { formatMessageTime } from '@/utils/dateUtils';

type Source = 'facebook' | 'instagram';

export interface PickedPost {
  pageId: string;
  source: Source;
  platformPostId: string;
  postMessage: string | null;
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

/** Pages that can host a Post Reply: connected, with a FB page or an IG account. */
function pickablePages(pages: Page[]): Page[] {
  return pages.filter((p) => p.isConnected !== false && (p.facebookPageId || p.instagramAccountId));
}

export function PostPickerSheet({ pages, isOpen, onClose, onPick }: PostPickerSheetProps) {
  const t = useTranslations('comments');
  const { dateLocale } = useLanguage();

  const candidates = useMemo(() => pickablePages(pages), [pages]);
  const [pageId, setPageId] = useState<string>(() => candidates[0]?.id ?? '');
  const selectedPage = candidates.find((p) => p.id === pageId) ?? candidates[0];
  const hasBoth = !!(selectedPage?.facebookPageId && selectedPage?.instagramAccountId);
  const [source, setSource] = useState<Source>(() =>
    candidates[0]?.facebookPageId ? 'facebook' : 'instagram',
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
      const { data } = await postsApi.getPublishedPosts(pageId, { source: effectiveSource, after: pageParam });
      return data as PublishedPostsResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const posts: PublishedPost[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.posts) ?? [],
    [query.data],
  );

  function handleSelectPage(id: string) {
    setPageId(id);
    const p = candidates.find((c) => c.id === id);
    setSource(p?.facebookPageId ? 'facebook' : 'instagram');
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

        {/* Page selector — only when the merchant has more than one connected page. */}
        {candidates.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{t('postPickerPageLabel')}</span>
            <select
              value={pageId}
              onChange={(e) => handleSelectPage(e.target.value)}
              className="rounded-lg border border-surface-200 dark:border-surface-700 bg-card px-3 py-2 text-sm"
              dir="auto"
            >
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
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
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
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
        {query.isLoading ? (
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
          <div className="py-8 text-center text-sm text-muted-foreground">{t('postPickerEmpty')}</div>
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
                  })}
                  className="w-full flex items-center gap-3 rounded-xl border border-theme-border p-2.5 text-start hover:bg-muted/60 transition-colors"
                >
                  <PostThumb imageUrl={post.imageUrl} source={post.source} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate" dir="auto">
                      {post.message?.trim() || t('postPickerNoText')}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-subtle">
                      {post.createdTime && <span>{formatMessageTime(post.createdTime, dateLocale)}</span>}
                      {post.commentsCount != null && post.commentsCount > 0 && (
                        <span>{t('postPickerCommentCount', { count: post.commentsCount })}</span>
                      )}
                    </span>
                  </span>
                  {post.hasTrigger ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 whitespace-nowrap">
                      <PostReplyIcon className="w-3 h-3" aria-hidden="true" />
                      {t('postPickerActive')}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface-100 dark:bg-surface-800 text-muted-foreground whitespace-nowrap">
                      {t('postPickerSetup')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
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

/** Square thumbnail with a source-tinted placeholder fallback. Facebook/Instagram CDN
 *  URLs are signed and rotate hosts, so a plain lazy <img> with an error fallback is
 *  more robust here than next/image remote patterns; it's a small thumbnail, not LCP. */
function PostThumb({ imageUrl, source }: { imageUrl: string | null; source: Source }) {
  const [failed, setFailed] = useState(false);
  const Icon = source === 'facebook' ? FacebookIcon : InstagramIcon;
  if (!imageUrl || failed) {
    return (
      <span className="w-12 h-12 rounded-lg bg-surface-100 dark:bg-surface-800 flex items-center justify-center flex-shrink-0 text-icon-muted">
        <Icon className="w-5 h-5" aria-hidden="true" />
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
