import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { settingsApi } from '@/lib/api';

export type CommentReplyMode = 'public' | 'private' | 'dual';

interface CommentReplyConfig {
  /**
   * The workspace comment reply mode, or null while loading / on error / on an
   * unrecognized response so callers never show a wrong delivery claim. GET
   * /settings always returns a concrete mode (the backend coerces missing values
   * to 'public'), so anything other than the three known values means the
   * response isn't the settings payload (e.g. an auth error body) — treat it as
   * unknown, don't guess a mode.
   */
  mode: CommentReplyMode | null;
  /**
   * The merchant's static public comment for dual mode, keyed by language
   * (`dualReplyNudgeMulti` — the field the Settings editor reads/writes). This is
   * the SEPARATE public comment dual mode posts — NOT the Post Reply itself, which
   * is delivered as the private message. Resolved to the viewer's UI locale by
   * useDualReplyNudge.
   */
  dualNudgeByLang: Record<string, string>;
}

/**
 * Shared query for the workspace comment-reply configuration. Both public hooks
 * below read from this single query, so the /settings round-trip happens once
 * (react-query dedupes by key). Cached across the session.
 */
function useCommentReplyConfig() {
  return useQuery({
    queryKey: ['comment-reply-config'],
    queryFn: async (): Promise<CommentReplyConfig> => {
      const res = await settingsApi.get();
      const data = res.data;
      const raw = data?.commentReplyMode;
      const mode = raw === 'public' || raw === 'private' || raw === 'dual' ? raw : null;
      const multi = data?.dualReplyNudgeMulti;
      const dualNudgeByLang = multi && typeof multi === 'object' ? (multi as Record<string, string>) : {};
      return { mode, dualNudgeByLang };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** The workspace comment reply mode, or null until it resolves (never guessed). */
export function useCommentReplyMode(): CommentReplyMode | null {
  const { data } = useCommentReplyConfig();
  return data?.mode ?? null;
}

/**
 * The merchant's static public comment (dual mode) in the VIEWER'S current UI
 * language, or '' when they haven't authored one for it (callers fall back to a
 * localized default). Keyed by the UI locale — not the stored dashboard language —
 * so an Arabic UI never surfaces an English comment and vice versa. In dual mode
 * the Post Reply is sent as the private message and this separate static comment
 * is posted publicly (see reply/sender.ts).
 */
export function useDualReplyNudge(): string {
  const locale = useLocale();
  const { data } = useCommentReplyConfig();
  const value = data?.dualNudgeByLang?.[locale];
  return typeof value === 'string' ? value : '';
}
