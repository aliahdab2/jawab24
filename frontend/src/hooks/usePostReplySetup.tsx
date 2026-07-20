import { useCallback, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { Comment, Page } from '@jawab24/shared';
import type { PickedPost } from '@/components/comments/PostPickerSheet';
import { postsApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

const PostTriggerModal = dynamic(
  () => import('@/components/comments/PostTriggerModal').then((m) => ({ default: m.PostTriggerModal })),
  { ssr: false },
);

const PostPickerSheet = dynamic(
  () => import('@/components/comments/PostPickerSheet').then((m) => ({ default: m.PostPickerSheet })),
  { ssr: false },
);

interface PostReplyTarget {
  postId: string;
  source: 'facebook' | 'instagram';
  postMessage?: string | null;
  keyword: string | null;
  reply: string | null;
  type: string | null;
  imageUrl: string | null;
  likeComment: boolean;
}

/** Trigger state as the posts API returns it (`ensurePost` / `getById`). One shape,
 *  cast in both fetch paths — extend HERE when a trigger field is added, so the two
 *  paths can't drift. */
interface ApiTriggerState {
  triggerKeyword?: string | null;
  triggerReply?: string | null;
  triggerType?: string | null;
  triggerImageUrl?: string | null;
  likeComment?: boolean;
}

/** Normalize API trigger state into the modal-facing target fields (single place
 *  that owns the `?? null` / `?? false` defaults for both open paths). */
function toTriggerFields(post: ApiTriggerState | null | undefined): Pick<PostReplyTarget, 'keyword' | 'reply' | 'type' | 'imageUrl' | 'likeComment'> {
  return {
    keyword: post?.triggerKeyword ?? null,
    reply: post?.triggerReply ?? null,
    type: post?.triggerType ?? null,
    imageUrl: post?.triggerImageUrl ?? null,
    likeComment: post?.likeComment ?? false,
  };
}

export interface PostReplySetup {
  /**
   * Open the Post Reply config for a comment's post. Fetches the post's existing
   * trigger first, so an already-configured post opens in Edit mode and is never
   * blank-overwritten. Returns false if the comment has no post or the fetch failed.
   */
  open: (comment: Comment) => Promise<boolean>;
  /** Open the post picker — lets a merchant choose any recent published post
   *  (including one with no comments yet) to configure Post Reply on. Requires the
   *  hook to have been given `pages`. */
  openPicker: () => void;
  /** Close the config modal (e.g. before opening a comment on top of it). */
  close: () => void;
  /** The config modal + picker sheet elements — render once in the page. */
  modal: ReactNode;
}

/**
 * Shared Post Reply setup flow for any comment-listing surface (the Comments page
 * and the dashboard's Recent Comments). Owns the config-modal state + render and the
 * safe open flow, so the wiring lives in one place instead of being copy-pasted per
 * page. Post Reply is post-scoped: surfaces open it for a comment's post, the hook
 * loads that post's current trigger and renders the shared PostTriggerModal.
 */
export function usePostReplySetup(pages: Page[] = []): PostReplySetup {
  const queryClient = useQueryClient();
  const tc = useTranslations('common');
  const [target, setTarget] = useState<PostReplyTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openPicker = useCallback(() => setPickerOpen(true), []);

  // From the picker: ensure the internal row exists (find-or-create — works even for a
  // post with no comments yet), then open the shared config modal on it. Reuses the
  // same modal + onSaved flow as the comment path.
  const openForPublishedPost = useCallback(async (picked: PickedPost): Promise<void> => {
    try {
      const { data } = await postsApi.ensurePost(picked.pageId, picked.source, picked.platformPostId);
      const content = data as { id: string } & ApiTriggerState;
      setPickerOpen(false);
      setTarget({
        postId: content.id,
        source: picked.source,
        postMessage: picked.postMessage,
        ...toTriggerFields(content),
      });
    } catch (err) {
      captureError(err, 'usePostReplySetup.openForPublishedPost', { tags: { action: 'post-reply-setup' } });
      toast.error(tc('error'));
    }
  }, [tc]);

  const open = useCallback(async (comment: Comment): Promise<boolean> => {
    if (!comment.postId) return false;
    try {
      const post = await queryClient.fetchQuery({
        queryKey: ['post-trigger', comment.postId],
        queryFn: () =>
          postsApi
            .getById(comment.postId!)
            .then((r) => r.data as ApiTriggerState),
      });
      setTarget({
        postId: comment.postId,
        source: comment.source ?? 'facebook',
        postMessage: comment.postMessage,
        ...toTriggerFields(post),
      });
      return true;
    } catch (err) {
      captureError(err, 'usePostReplySetup.open', { tags: { action: 'post-reply-setup' } });
      toast.error(tc('error'));
      return false;
    }
  }, [queryClient, tc]);

  const close = useCallback(() => setTarget(null), []);

  // A save/clear can change trigger state seen by both the bulk posts map (Comments
  // page card state) and the per-post cache (dashboard), so refresh both.
  const onSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['posts'] });
    queryClient.invalidateQueries({ queryKey: ['post-trigger'] });
  }, [queryClient]);

  // Null when neither surface is open, so hosts can render `{modal}` inertly.
  const modal = (pickerOpen || target) ? (
    <>
      {pickerOpen && (
        <PostPickerSheet
          pages={pages}
          isOpen
          onClose={() => setPickerOpen(false)}
          onPick={openForPublishedPost}
        />
      )}
      {target && (
        <PostTriggerModal
          postId={target.postId}
          source={target.source}
          postMessage={target.postMessage}
          triggerKeyword={target.keyword}
          triggerReply={target.reply}
          triggerType={target.type}
          triggerImageUrl={target.imageUrl}
          likeComment={target.likeComment}
          isOpen
          onClose={close}
          onSaved={onSaved}
        />
      )}
    </>
  ) : null;

  return { open, openPicker, close, modal };
}
