import { useLocale } from 'next-intl';
import { useSettingsQuery } from './useSettingsQuery';

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
  /**
   * Server capability: whether Post Reply image attachments are available (object
   * storage is configured backend-side). The image picker is gated on this — when
   * false, the feature is hidden entirely.
   */
  imagesEnabled: boolean;
}

/**
 * Comment-reply configuration, derived from the shared `/settings` query.
 *
 * Both public hooks below read this, and it costs no request of its own — the
 * whole app now shares ONE `/settings` round-trip via useSettingsQuery. (This
 * hook already deduped its own two consumers; the shared query extends the same
 * idea across the five keys that used to fetch the identical response.)
 */
function useCommentReplyConfig(): { data: CommentReplyConfig } {
  const { data } = useSettingsQuery();
  const raw = data?.commentReplyMode;
  const mode = raw === 'public' || raw === 'private' || raw === 'dual' ? raw : null;
  const multi = data?.dualReplyNudgeMulti;
  const dualNudgeByLang = multi && typeof multi === 'object' ? (multi as Record<string, string>) : {};
  return { data: { mode, dualNudgeByLang, imagesEnabled: data?.triggerImagesEnabled === true } };
}

/** The workspace comment reply mode, or null until it resolves (never guessed). */
export function useCommentReplyMode(): CommentReplyMode | null {
  const { data } = useCommentReplyConfig();
  return data?.mode ?? null;
}

/** Whether Post Reply image attachments are available (object storage configured). */
export function useTriggerImagesEnabled(): boolean {
  const { data } = useCommentReplyConfig();
  return data?.imagesEnabled ?? false;
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
