import { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { posts, instagramMedia } from '../db/schema';
import { POST_REPLY_IMAGE_ROUTE } from '../services/reply/postReplyImageLink';
import { UUIDSchema } from '../utils/validation';
import { t } from '../utils/i18n';

/**
 * PUBLIC resolver for the Post Reply image tap-through.
 *
 * A Post Reply image card sits in a customer's Messenger thread forever, but the storage
 * object behind it does not: replacing or clearing the rule deletes the old key (see
 * services/posts.ts), which turned every already-delivered card into a raw `NoSuchKey` XML
 * page from our bucket. The card therefore points here, and we redirect to whatever image
 * that Post Reply holds RIGHT NOW.
 *
 * No auth: the link is handed to customers by design, and it exposes nothing the merchant
 * hasn't already sent them. It only ever reveals the current Post Reply image of a post the
 * recipient was messaged about, and it is a bare uuid — not enumerable.
 */
export default async function postReplyImageRoutes(fastify: FastifyInstance) {
    fastify.get<{ Params: { source: string; id: string } }>(POST_REPLY_IMAGE_ROUTE, {
        schema: {
            tags: ['Posts'],
            summary: 'Redirect to a Post Reply\'s current image (stable link embedded in sent DMs)',
        },
    }, async (request, reply) => {
        const { source, id } = request.params;
        // A bad source or a malformed id never reaches Postgres — an invalid uuid cast is a 500.
        const unknownContent = (source !== 'facebook' && source !== 'instagram')
            || !UUIDSchema.safeParse(id).success;
        if (unknownContent) return unavailable(reply, 404);

        const table = source === 'instagram' ? instagramMedia : posts;
        const [row] = await db
            .select({ imageUrl: table.triggerImageUrl })
            .from(table)
            .where(eq(table.id, id))
            .limit(1);

        // Row gone (post deleted) → 404. Rule cleared or image removed → 410: the image is
        // deliberately gone, not missing by accident. Either way the customer gets an honest
        // notice in our own words, never the bucket's XML error page.
        if (!row) return unavailable(reply, 404);
        if (!row.imageUrl) return unavailable(reply, 410);

        // 302, never 301: the target changes whenever the merchant swaps the image, so this
        // redirect must not be cached by the in-app browser.
        return reply.code(302).header('cache-control', 'no-store').redirect(row.imageUrl);
    });
}

/** The single "no image here" response — one place so status codes and the page can't drift. */
function unavailable(reply: FastifyReply, code: 404 | 410) {
    return reply.code(code).type('text/html; charset=utf-8').send(gonePage());
}

/** Minimal bilingual notice — the customer's language is unknown at tap time, so show both. */
function gonePage(): string {
    const ar = t('postReplyImageUnavailable', 'ar');
    const en = t('postReplyImageUnavailable', 'en');
    return `<!doctype html><html><head><meta charset="utf-8">`
        + `<meta name="viewport" content="width=device-width,initial-scale=1">`
        + `<title>${en}</title></head>`
        + `<body style="font-family:system-ui,sans-serif;display:flex;flex-direction:column;`
        + `align-items:center;justify-content:center;min-height:100vh;margin:0;color:#334155;text-align:center">`
        + `<p dir="rtl" lang="ar" style="margin:0 0 .5rem">${ar}</p>`
        + `<p dir="ltr" lang="en" style="margin:0;color:#64748b">${en}</p>`
        + `</body></html>`;
}
