import type { PostSuggestionResponse } from '@/lib/api';

/**
 * Fold a post-suggestion response into the one already cached.
 *
 * The envelope distinguishes ABSENT from EMPTY: `history: []` means "this page
 * has no earlier posts", while no `history` key at all means "this response
 * does not carry them". Only the READ route sends the list — generate answers
 * with a row that is still pending, so a list built there would be one behind
 * by construction.
 *
 * Writing a generate response into the cache wholesale therefore erased the
 * strip, which is the same "absent ≠ empty" rule the response type states,
 * broken one layer below the component that honours it. A merchant who created
 * another post and reopened the sheet lost their earlier posts from view until
 * the next background fetch happened to restore them.
 *
 * Lives here, named and exported, rather than inline in the card's
 * `setQueryData` callback: a rule this easy to re-break is worth a test that
 * addresses it directly.
 */
export function mergePostSuggestionResponse(
    prev: PostSuggestionResponse | undefined,
    latest: PostSuggestionResponse,
): PostSuggestionResponse {
    return { ...latest, history: latest.history ?? prev?.history };
}
