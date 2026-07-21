import { config } from '../../config';

/** Backend-relative path of the resolver — the ONE literal the route and the link share, so a
 *  rename can never leave already-sent cards pointing at a path the server no longer serves. */
const POST_REPLY_IMAGE_PATH = '/post-reply-image';

/** Route that resolves a Post Reply's CURRENT image and redirects to it. */
export const POST_REPLY_IMAGE_ROUTE = `${POST_REPLY_IMAGE_PATH}/:source/:id`;

/**
 * The stable, permanent link a sent Post Reply card points its tap-through at.
 *
 * A Messenger message lives forever; the storage key behind it does NOT — replacing or
 * clearing a Post Reply deletes the old object (see services/posts.ts), which used to turn
 * every already-delivered card into a raw `NoSuchKey` XML page when the customer tapped it.
 * So the card carries THIS indirection instead of the bucket URL, and the route resolves the
 * image at tap time. (`image_url` on the card can stay direct — Meta fetches it once at send
 * time and serves its own cached copy afterwards.)
 */
export function buildPostReplyImageUrl(source: 'facebook' | 'instagram', postId: string): string {
    return `${config.publicApiBaseUrl.replace(/\/$/, '')}${POST_REPLY_IMAGE_PATH}/${source}/${postId}`;
}
