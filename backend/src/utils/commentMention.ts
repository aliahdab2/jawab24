/**
 * Facebook comment @mentions (Post Reply "tag the commenter" option).
 *
 * Meta renders `@[PSID]` inside a comment's `message` as a real mention of that person,
 * and only for someone who commented on the page's post — exactly our case:
 * https://developers.facebook.com/docs/pages-api/comments-mentions/
 * The PSID is the comment's `from.id`, which the webhook already gives us.
 *
 * WHY THE TOKEN GOES FIRST, AND AFTER TRUNCATION
 * ----------------------------------------------
 * The nudge is capped at NUDGE_MAX_LENGTH and `pickNudgeVariation` slices to it. A mention
 * appended before that slice can be cut mid-token, and a MALFORMED token is the one shape
 * Meta does not clean up: a well-formed `@[id]` it cannot resolve is stripped silently
 * (measured 2026-08-07), but `@[1784` — no closing bracket — is not a mention at all and
 * survives as literal text on the merchant's page. So the caller truncates first and prefixes
 * second, and this module never returns a token embedded in text it did not measure.
 *
 * Leading position also degrades best: when Meta declines to render the tag (the page's
 * «Others Tagging this Page» setting is off — unreadable via any API, see
 * commentMentionGuard.ts) the token is removed and the reply still reads exactly as the
 * merchant wrote it, with a stray leading space rather than a gap inside a sentence.
 *
 * This module is deliberately Facebook-only. Instagram mentions are `@username` — a
 * different syntax, a different id space, and unverified on our side; adding it here would
 * invite a caller to pass an IG value into FB syntax.
 */

/** A Facebook PSID is a long decimal string. Anything else must never reach `message`. */
const PSID_PATTERN = /^\d{5,}$/;

/**
 * Build the mention token for a commenter, or null when the id is unusable.
 *
 * Returning null (rather than throwing) is the point: a missing/odd `from.id` must degrade
 * to an untagged reply, never to a failed send or to raw text in a public comment.
 */
export function buildFacebookMentionToken(psid: string | null | undefined): string | null {
    if (!psid) return null;
    const trimmed = psid.trim();
    if (!PSID_PATTERN.test(trimmed)) return null;
    return `@[${trimmed}]`;
}

/**
 * Prefix an already-final (already truncated) public comment with a mention.
 * No-ops when the token is null, so callers can pass an unresolved id straight through.
 */
export function prefixMention(token: string | null, text: string): string {
    if (!token) return text;
    const body = text.trim();
    return body ? `${token} ${body}` : token;
}

/**
 * Did Meta render a user mention in the comment we posted?
 *
 * Read back from `message_tags` (the same field the inbound user-tag skip rule reads); the
 * text alone cannot tell a rendered tag from a stripped one.
 *
 * PRESENCE, NOT ID EQUALITY — deliberately. An earlier version required
 * `tag.id === psid`, on the model of `hasOwnPageTag`. That is an unverified assumption
 * about a *user* tag: if Facebook echoes the tagged person under a differently-scoped id,
 * every SUCCESSFUL mention reads as failed, and the caller then rewrites the comment
 * (stripping a mention that worked), marks the page unsupported, and repeats that on every
 * page forever. The two errors are not symmetric, so this takes the safe side.
 *
 * Presence is sound here because we add exactly one mention to a comment we just created:
 * any `type: 'user'` tag in it is ours. The one way to be wrong — a merchant who typed
 * their own `@[id]` into the trigger reply — leaves a working mention in place, which is
 * the harmless direction.
 */
export function mentionRendered(
    tags: Array<{ id: string; type: string }> | null | undefined,
): boolean {
    if (!tags?.length) return false;
    return tags.some(tag => tag.type === 'user');
}

/**
 * The id Facebook reported for the rendered mention, when it differs from the one we sent.
 *
 * Pure diagnostic: it answers the open question above ("does Graph echo our PSID back?")
 * from production data instead of another probe. Null when there is nothing to report.
 */
export function renderedTagIdMismatch(
    tags: Array<{ id: string; type: string }> | null | undefined,
    psid: string,
): string | null {
    const userTag = tags?.find(tag => tag.type === 'user');
    if (!userTag || userTag.id === psid) return null;
    return userTag.id;
}
