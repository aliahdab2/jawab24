import { useCallback, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { Comment } from '@jawab24/shared';
import { postsApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

const PostTriggerModal = dynamic(
  () => import('@/components/comments/PostTriggerModal').then((m) => ({ default: m.PostTriggerModal })),
  { ssr: false },
);

interface PostReplyTarget {
  postId: string;
  source: 'facebook' | 'instagram';
  postMessage?: string | null;
  keyword: string | null;
  reply: string | null;
}

export interface PostReplySetup {
  /**
   * Open the Post Reply config for a comment's post. Fetches the post's existing
   * trigger first, so an already-configured post opens in Edit mode and is never
   * blank-overwritten. Returns false if the comment has no post or the fetch failed.
   */
  open: (comment: Comment) => Promise<boolean>;
  /** Close the config modal (e.g. before opening a comment on top of it). */
  close: () => void;
  /** The config modal element — render once in the page. */
  modal: ReactNode;
}

/**
 * Shared Post Reply setup flow for any comment-listing surface (the Comments page
 * and the dashboard's Recent Comments). Owns the config-modal state + render and the
 * safe open flow, so the wiring lives in one place instead of being copy-pasted per
 * page. Post Reply is post-scoped: surfaces open it for a comment's post, the hook
 * loads that post's current trigger and renders the shared PostTriggerModal.
 */
export function usePostReplySetup(): PostReplySetup {
  const queryClient = useQueryClient();
  const tc = useTranslations('common');
  const [target, setTarget] = useState<PostReplyTarget | null>(null);

  const open = useCallback(async (comment: Comment): Promise<boolean> => {
    if (!comment.postId) return false;
    try {
      const post = await queryClient.fetchQuery({
        queryKey: ['post-trigger', comment.postId],
        queryFn: () =>
          postsApi
            .getById(comment.postId!)
            .then((r) => r.data as { triggerKeyword?: string | null; triggerReply?: string | null }),
      });
      setTarget({
        postId: comment.postId,
        source: comment.source ?? 'facebook',
        postMessage: comment.postMessage,
        keyword: post?.triggerKeyword ?? null,
        reply: post?.triggerReply ?? null,
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

  const modal = target ? (
    <PostTriggerModal
      postId={target.postId}
      source={target.source}
      postMessage={target.postMessage}
      triggerKeyword={target.keyword}
      triggerReply={target.reply}
      isOpen
      onClose={close}
      onSaved={onSaved}
    />
  ) : null;

  return { open, close, modal };
}
