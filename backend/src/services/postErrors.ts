/**
 * Post-lookup errors, in their own module so a consumer can catch them without
 * importing the posts service.
 *
 * `commentProcessor` needs exactly this class and nothing else from `services/posts`;
 * pulling the whole service in for an error type would drag `db`, `facebook`,
 * `imageStorage`, and `notifications` into the comment pipeline's import graph (and into
 * every test that touches it).
 */

/**
 * A find-or-create resolved to a post row owned by a DIFFERENT page.
 *
 * `posts.facebook_post_id` is globally unique, so a page-scoped miss followed by a
 * unique-violation on insert means the row exists under another page — either a
 * cross-tenant probe on the ensure endpoint, or legacy data. Rows with `page_id IS NULL`
 * are adopted rather than rejected; see `postsService.findOrCreateFromWebhook`.
 *
 * No content row can be created for such an id, so a comment on it cannot be ingested at
 * all. Deterministic — never retry it.
 */
export class PostNotOwnedError extends Error {
    constructor(facebookPostId: string) {
        super(`Post ${facebookPostId} belongs to a different page`);
        this.name = 'PostNotOwnedError';
    }
}
