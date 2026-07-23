import axios from 'axios';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { MAX_CATALOG_IMPORT_CHARS } from '@jawab24/shared';
import { db } from '../db';
import { pages, catalogItems, posts, instagramMedia } from '../db/schema';
import { facebookService } from './facebook';
import { extractFromImage } from './kb/file-extractor';
import { catalogExtractor, type CatalogExtractionResult } from './catalogExtractor';
import { CatalogStoreConflictError, resolveCatalogVertical } from './catalog';
import { captureError } from '../utils/sentryHelpers';
import type { StoredBusinessProfile } from '@jawab24/shared';

/**
 * Catalog posts-scan — the zero-effort entry to the catalog: read the page's
 * own recent Facebook posts (text + images), extract PROPOSED items, and hand
 * them to the same review sheet as the paste import. Nothing is persisted here
 * (merchant-in-the-loop, same contract as catalogExtractor).
 *
 * Why posts: merchants already publish what they sell — spec cards, schedule
 * images, car listings. What posts deliberately OMIT is the price ("comment
 * and we'll DM you") — so proposals routinely arrive priceless and the review
 * sheet turns that into a private price-completion step. That asymmetry is the
 * product: the post drives comments, Jawab24 holds the private price list.
 *
 * Re-scan idempotence: pages.catalog_scan_last_post_time bookmarks the newest
 * post consumed; the next scan only proposes NEWER posts' items. The bookmark
 * only advances when extraction actually succeeded — a transient AI failure
 * must not silently swallow a window of posts. The bookmark is IGNORED while the
 * catalog is empty (see scanPosts): "up to date" is meaningless with zero items,
 * and a first scan that proposed nothing must never lock the page out of re-scanning.
 */

/** Newest posts read per scan. One Graph call; bounds vision spend with
 *  MAX_SCAN_IMAGES rather than post count alone. */
export const MAX_SCAN_POSTS = 25;
/** Total images OCR'd per scan (each is one Vision call ≈ the cost of the
 *  extract call itself). Newest posts win the budget. */
export const MAX_SCAN_IMAGES = 10;
/** Images per single post — an album's 15th photo rarely adds new offerings. */
export const MAX_IMAGES_PER_POST = 4;

/** Thrown when the page cannot be scanned (disconnected / no FB identity) —
 *  distinct from "not found" so the controller can say why. */
export class CatalogScanUnavailableError extends Error {
    constructor() {
        super('This page has no usable Facebook connection to scan');
        this.name = 'CatalogScanUnavailableError';
    }
}

export interface CatalogScanResult extends CatalogExtractionResult {
    /** Posts consumed by this scan (0 → upToDate). */
    postsScanned: number;
    /** No posts newer than the last scan's bookmark. */
    upToDate: boolean;
}

export interface CatalogPostReplyScanResult extends CatalogExtractionResult {
    /** Post Reply configs fed to the extractor. */
    repliesScanned: number;
    /** The page has NO Post Reply configured — the presence gate is closed, so
     *  the caller should not surface the "import from your post replies" action. */
    noPostReplies: boolean;
}

/** Cap on how much of a post's own text we prepend as context for its reply —
 *  the offering+price lives in the REPLY; the post is only there to name the
 *  product. Keeps the combined input focused (and under MAX_CATALOG_IMPORT_CHARS). */
const POST_CONTEXT_MAX_CHARS = 400;

/** Upper bound on Post Reply rows fetched per scan. Newest-first + the 16k char
 *  cap already mean only the freshest ~40-80 replies reach the model; this
 *  bounds the DB fetch itself so a page with thousands of posts can't load them
 *  all into memory to use a fraction. */
const MAX_POST_REPLIES_SCAN = 200;

/** Only fetch images from Meta's CDNs — the URLs come from the Graph API, but
 *  a compromised/odd payload must not turn this into a generic URL fetcher. */
function isMetaCdnUrl(url: string): boolean {
    try {
        const { protocol, hostname } = new URL(url);
        return protocol === 'https:' && (
            hostname === 'fbcdn.net' || hostname.endsWith('.fbcdn.net')
            || hostname === 'cdninstagram.com' || hostname.endsWith('.cdninstagram.com')
        );
    } catch {
        return false;
    }
}

const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // extractFromImage enforces the same cap

export class CatalogScanService {
    /**
     * Scan the page's recent posts into proposed catalog items.
     * Returns null when the page isn't in the workspace (404); throws
     * CatalogStoreConflictError (store pages get their catalog from the sync)
     * and CatalogScanUnavailableError (disconnected page).
     */
    async scanPosts(workspaceId: string, pageId: string, ctx: { userId: string }): Promise<CatalogScanResult | null> {
        const [page] = await db
            .select({
                id: pages.id,
                facebookPageId: pages.facebookPageId,
                accessToken: pages.accessToken,
                ecommerceStoreId: pages.ecommerceStoreId,
                catalogVertical: pages.catalogVertical,
                catalogScanLastPostTime: pages.catalogScanLastPostTime,
                businessProfile: pages.businessProfile,
            })
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);
        if (!page) return null;
        if (page.ecommerceStoreId) throw new CatalogStoreConflictError();
        if (!page.facebookPageId || !page.accessToken) throw new CatalogScanUnavailableError();

        // The re-scan bookmark means "skip posts I've already reviewed" — it only
        // makes sense once a catalog EXISTS. With zero items there is nothing to be
        // "up to date" against, and a first scan that proposed nothing (an
        // announcements-only window, image-less posts, or a merchant who dismissed
        // every proposal) still advances the bookmark — which would otherwise lock
        // an empty page into "all up to date" forever, with no items and no way to
        // re-scan. So an empty catalog always scans the full recent window.
        const [existingItem] = await db
            .select({ id: catalogItems.id })
            .from(catalogItems)
            .where(eq(catalogItems.pageId, pageId))
            .limit(1);
        const hasCatalog = existingItem !== undefined;

        const { posts } = await facebookService.getPagePosts(page.facebookPageId, page.accessToken, {
            limit: MAX_SCAN_POSTS,
            fullImages: true,
        });

        const since = hasCatalog ? page.catalogScanLastPostTime : null;
        const fresh = posts.filter((p) => {
            if (!p.createdTime) return false;
            return !since || new Date(p.createdTime) > since;
        });
        if (fresh.length === 0) {
            return { items: [], dropped: 0, truncated: false, failed: false, postsScanned: 0, upToDate: true };
        }

        // Newest-first (Graph order): the freshest offerings win the image budget
        // and survive the char cap — old posts are the first to degrade.
        let imageBudget = MAX_SCAN_IMAGES;
        const blocks: string[] = [];
        for (const post of fresh) {
            const parts: string[] = [];
            if (post.message?.trim()) parts.push(post.message.trim());

            for (const url of post.imageUrls.slice(0, MAX_IMAGES_PER_POST)) {
                if (imageBudget <= 0) break;
                imageBudget -= 1;
                const text = await this.readImage(url, ctx.userId, pageId);
                if (text) parts.push(text);
            }

            if (parts.length === 0) continue;
            const date = post.createdTime ? post.createdTime.slice(0, 10) : 'unknown date';
            blocks.push(`POST (${date}):\n${parts.join('\n')}`);
        }

        if (blocks.length === 0) {
            // Only image-less/empty posts in the window (reels, plain links).
            // Nothing was extractable, nothing was lost — safe to bookmark.
            await this.advanceBookmark(pageId, fresh[0].createdTime);
            return { items: [], dropped: 0, truncated: false, failed: false, postsScanned: fresh.length, upToDate: false };
        }

        const combined = blocks.join('\n\n---\n\n').slice(0, MAX_CATALOG_IMPORT_CHARS);
        const vertical = resolveCatalogVertical(page.catalogVertical, page.businessProfile as StoredBusinessProfile);
        const result = await catalogExtractor.extract(combined, {
            userId: ctx.userId,
            pageId,
            vertical: vertical.effective,
            source: 'posts',
        });

        // A failed AI call must not advance the bookmark — the merchant retries
        // and the same posts are re-proposed instead of silently vanishing.
        if (!result.failed) await this.advanceBookmark(pageId, fresh[0].createdTime);

        return { ...result, postsScanned: fresh.length, upToDate: false };
    }

    /** Vision-OCR one post image. Fail-soft per image: a broken CDN URL or an
     *  oversized photo skips that image, never the scan. */
    private async readImage(url: string, userId: string, pageId: string): Promise<string | null> {
        if (!isMetaCdnUrl(url)) return null;
        try {
            const response = await axios.get<ArrayBuffer>(url, {
                responseType: 'arraybuffer',
                timeout: IMAGE_DOWNLOAD_TIMEOUT_MS,
                maxContentLength: MAX_IMAGE_BYTES,
            });
            const buffer = Buffer.from(response.data);
            const mime = String(response.headers['content-type'] ?? 'image/jpeg').split(';')[0];
            const extracted = await extractFromImage(buffer, mime, {
                userId,
                pageId,
                pipeline: 'catalog_extraction',
            });
            return extracted.text.trim() || null;
        } catch (err) {
            captureError(err, 'Catalog posts-scan image read failed', {
                level: 'warning', tags: { service: 'catalog-scan' }, extra: { pageId },
            });
            return null;
        }
    }

    /**
     * Scan the page's configured Post Reply auto-replies into proposed catalog
     * items — across BOTH channels: Facebook (`posts.trigger_reply` + post
     * `message`) and Instagram (`instagram_media.trigger_reply` + `caption`).
     * Unlike scanPosts this needs NO Graph call — the reply text lives in our own
     * DB, so it works even for a page whose token has since expired. Nothing is
     * persisted (same merchant-in-the-loop contract as scanPosts / catalogExtractor).
     *
     * Presence-gated by design (owner decision 2026-07-24): post-reply richness
     * is concentrated in a few merchants (courses/training vertical). A page with
     * no Post Reply on EITHER channel returns noPostReplies:true so the caller
     * hides the action (an IG-only merchant must not be mis-signalled as empty).
     *
     * No re-scan bookmark: post-replies are few and the merchant edits them
     * (offers rotate), so a full re-scan each time is cheap and correct — the
     * review sheet is where the merchant reconciles against the existing catalog.
     */
    async scanPostReplies(
        workspaceId: string,
        pageId: string,
        ctx: { userId: string },
    ): Promise<CatalogPostReplyScanResult | null> {
        const [page] = await db
            .select({
                id: pages.id,
                ecommerceStoreId: pages.ecommerceStoreId,
                catalogVertical: pages.catalogVertical,
                businessProfile: pages.businessProfile,
            })
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);
        if (!page) return null;
        if (page.ecommerceStoreId) throw new CatalogStoreConflictError();

        // Both channels, each newest-first + capped, then merged and re-capped —
        // so neither channel alone can exceed the fetch bound. `text` is the post's
        // own copy (FB message / IG caption) that names the product; the price
        // lives in the reply.
        const [fbRows, igRows] = await Promise.all([
            db.select({ text: posts.message, triggerReply: posts.triggerReply, createdTime: posts.createdTime })
                .from(posts)
                .where(and(
                    eq(posts.pageId, pageId),
                    isNotNull(posts.triggerReply),
                    sql`length(trim(${posts.triggerReply})) > 0`,
                ))
                .orderBy(sql`${posts.createdTime} DESC NULLS LAST`)
                .limit(MAX_POST_REPLIES_SCAN),
            db.select({ text: instagramMedia.caption, triggerReply: instagramMedia.triggerReply, createdTime: instagramMedia.createdTime })
                .from(instagramMedia)
                .where(and(
                    eq(instagramMedia.pageId, pageId),
                    isNotNull(instagramMedia.triggerReply),
                    sql`length(trim(${instagramMedia.triggerReply})) > 0`,
                ))
                .orderBy(sql`${instagramMedia.createdTime} DESC NULLS LAST`)
                .limit(MAX_POST_REPLIES_SCAN),
        ]);

        // Merge FB + IG, newest-first (undated rows last), re-cap the combined set.
        const rows = [...fbRows, ...igRows]
            .sort((a, b) => (b.createdTime?.getTime() ?? -Infinity) - (a.createdTime?.getTime() ?? -Infinity))
            .slice(0, MAX_POST_REPLIES_SCAN);

        if (rows.length === 0) {
            return { items: [], dropped: 0, truncated: false, failed: false, repliesScanned: 0, noPostReplies: true };
        }

        // Pair each reply with its post text (product name) so the extractor can
        // map "الكلفة 25 ألف" to "كورس المكياج". The price lives in the REPLY.
        const blocks = rows.map((r) => {
            const date = r.createdTime ? r.createdTime.toISOString().slice(0, 10) : 'unknown date';
            const post = r.text?.trim();
            const postLine = post ? `\nPOST: ${post.slice(0, POST_CONTEXT_MAX_CHARS)}` : '';
            // triggerReply is non-null + non-blank by the query filter; `?? ''` only
            // satisfies the type-narrower without a forbidden non-null assertion.
            return `POST REPLY (${date}):${postLine}\nREPLY: ${(r.triggerReply ?? '').trim()}`;
        });
        const combined = blocks.join('\n\n---\n\n').slice(0, MAX_CATALOG_IMPORT_CHARS);

        const vertical = resolveCatalogVertical(page.catalogVertical, page.businessProfile as StoredBusinessProfile);
        const result = await catalogExtractor.extract(combined, {
            userId: ctx.userId,
            pageId,
            vertical: vertical.effective,
            source: 'post_reply',
        });

        return { ...result, repliesScanned: rows.length, noPostReplies: false };
    }

    private async advanceBookmark(pageId: string, newestCreatedTime: string | null): Promise<void> {
        if (!newestCreatedTime) return;
        await db
            .update(pages)
            .set({ catalogScanLastPostTime: new Date(newestCreatedTime), updatedAt: new Date() })
            .where(eq(pages.id, pageId));
    }
}

export const catalogScanService = new CatalogScanService();
