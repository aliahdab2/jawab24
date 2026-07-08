import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api';

export type CommentReplyMode = 'public' | 'private' | 'dual';

/**
 * Returns the workspace's comment reply mode ('public' | 'private' | 'dual'),
 * or null while loading / on error / on an unrecognized response so callers
 * never show a wrong delivery claim. GET /settings always returns a concrete
 * mode (the backend coerces missing values to 'public'), so anything other
 * than the three known values means the response isn't the settings payload
 * (e.g. an auth error body) — treat it as unknown, don't guess a mode.
 * Cached across the session.
 */
export function useCommentReplyMode(): CommentReplyMode | null {
  const { data } = useQuery({
    queryKey: ['comment-reply-mode'],
    queryFn: async (): Promise<CommentReplyMode | null> => {
      const res = await settingsApi.get();
      const mode = res.data?.commentReplyMode;
      return mode === 'public' || mode === 'private' || mode === 'dual' ? mode : null;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? null;
}
