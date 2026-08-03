import axios from 'axios';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { MAX_CATALOG_IMPORT_CHARS, postsScanEligibility, type PostsScanBlocker } from '@jawab24/shared';
import { db } from '../db';
import { pages, catalogItems, posts, instagramMedia } from '../db/schema';
import { facebookService } from './facebook';
import { extractFromImage } from './kb/file-extractor';
import { catalogExtractor, type CatalogExtractionResult } from './catalogExtractor';
import { CatalogStoreConflictError, resolveCatalogVertical } from './catalog';
import { safeDecryptToken } from './facebookCrypto';
import { captureError } from '../utils/sentryHelpers';
import type { StoredBusinessProfile } from '@jawab24/shared';

/**
 * Catalog page-scan — the zero-effort entry to the catalog: ONE scan that reads
 * everything the merchant's page already says about what they sell, and hands
 * PROPOSED items to the same review sheet as the paste import. Nothing is
 * persisted here (merchant-in-the-loop, same contract as catalogExtractor).
 *
 * Two sources, merged (D-059 — replaces the separate Post Reply scan):
 *
 *  1. Recent Facebook posts (Graph, text + images). Posts deliberately OMIT the
 *     price ("comment and we'll DM you") — so post-only proposals arrive
 *     priceless and the review sheet turns that into a private price-completion
 *     step. That asymmetry is the product: the post drives comments, Jawab24
 *     holds the private price list.
 *  2. The merchant's configured Post Reply auto-replies (our own DB, BOTH
 *     channels — `posts.trigger_reply` and `instagram_media.trigger_reply`).
 *     The reply is where the withheld price actually lives, so a recent post
 *     paired with its reply is a COMPLETE item: name from the post, price from
 *     the reply. Replies are read on every scan regardless of age or bookmark —
 *     they are free (no Graph, no Vision), few, merchant-edited (offers
 *     rotate), and the review sheet's reconcile absorbs re-proposals.
 *
 * Because source 2 needs no token, a page whose posts CANNOT be read
 * (disconnected / WhatsApp-only / a transient Graph failure) still scans its
 * replies; `postsUnavailable` tells the caller which honest message to show.
 * Only a page with neither source is a dead end (CatalogScanUnavailableError).
 *
 * Re-scan idempotence (posts only): pages.catalog_scan_last_post_time bookmarks
 * the newest post consumed; the next scan only proposes NEWER posts' items. The
 * bookmark only advances when the posts were actually read AND extraction
 * succeeded — a Graph failure or a transient AI failure must not silently
 * swallow a window of posts. The bookmark is IGNORED while the catalog is empty
 * (see scanPage): "up to date" is meaningless with zero items, and a first scan
 * that proposed nothing must never lock the page out of re-scanning.
 */

/** Newest posts read per scan. One Graph call; bounds vision spend with
 *  MAX_SCAN_IMAGES rather than post count alone. */
export const MAX_SCAN_POSTS = 25;
/** Total images OCR'd per scan (each is one Vision call ≈ the cost of the
 *  extract call itself). Newest posts win the budget — and a post whose
 *  configured reply already names the price spends none of it (see scanPage). */
export const MAX_SCAN_IMAGES = 10;
/** Images per single post — an album's 15th photo rarely adds new offerings. */
export const MAX_IMAGES_PER_POST = 4;

/** Thrown when the page has NOTHING to scan — no readable Facebook posts AND no
 *  configured Post Reply. Distinct from "not found" so the controller can say why. */
export class CatalogScanUnavailableError extends Error {
    constructor() {
        super('This page has no readable posts and no Post Reply to scan');
        this.name = 'CatalogScanUnavailableError';
    }
}

/** Why the page's POSTS were not read in this scan (its configured replies may
 *  still have been). 'noFacebook' / 'disconnected' are page-level (the shared
 *  eligibility rule); 'graph_error' is a transient Graph API failure. */
export type PostsUnavailableReason = PostsScanBlocker | 'graph_error';

export interface CatalogScanResult extends CatalogExtractionResult {
    /** Posts consumed by this scan. */
    postsScanned: number;
    /** Configured Post Reply rows that actually REACHED the extractor — not the
     *  rows fetched. The two differ when the char cap drops blocks: the count is
     *  shown to the merchant as «قرأنا … M ردّ بوست», and claiming a reply was
     *  read after truncation dropped it would be the masking bug in a new coat. */
    repliesScanned: number;
    /** Posts were readable and nothing new existed anywhere — an honest no-op.
     *  NEVER true when the posts could not be read (that's postsUnavailable). */
    upToDate: boolean;
    /** null when the posts were read normally. */
    postsUnavailable: PostsUnavailableReason | null;
    /** True when this scan reached a paid call (Vision and/or extraction). The
     *  controller charges the daily cap off THIS, not off the scanned counts —
     *  a window of reels/plain links has postsScanned > 0 yet costs nothing. */
    paidCall: boolean;
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

/** When the newest post block that no longer fits the char cap can still get
 *  at least this much room, its head is included rather than dropping the block
 *  whole — a 20k-char price-list post should contribute its first chunk, the
 *  way the old mid-string slice did. Below this, a fragment adds noise. */
const MIN_SALVAGE_CHARS = 400;

/** One block of extractor input, with how many configured replies it carries —
 *  so the reported repliesScanned can count what actually survived the cap. */
interface ScanBlock {
    text: string;
    replyCount: number;
}

/** One configured Post Reply, either channel. `facebookPostId` lets a reply be
 *  merged into its own post's block when that post is in the scanned window
 *  (IG rows have none — IG media aren't in the Graph posts feed). */
interface PostReplyRow {
    facebookPostId: string | null;
    /** The post's own copy (FB message / IG caption) — names the product. */
    text: string | null;
    triggerReply: string | null;
    createdTime: Date | null;
}

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
     * Scan the page — recent posts + configured Post Replies — into proposed
     * catalog items. Returns null when the page isn't in the workspace (404);
     * throws CatalogStoreConflictError (store pages get their catalog from the
     * sync) and CatalogScanUnavailableError (nothing scannable at all).
     */
    async scanPage(workspaceId: string, pageId: string, ctx: { userId: string }): Promise<CatalogScanResult | null> {
        const [page] = await db
            .select({
                id: pages.id,
                facebookPageId: pages.facebookPageId,
                // Named for what the column actually holds: AES ciphertext (the
                // Graph API cannot use it). Decrypted below before any use — the
                // original `accessToken` name let ciphertext be passed straight
                // to Graph, which is why no scan ever succeeded in production.
                encryptedAccessToken: pages.accessToken,
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

        // Every Graph consumer decrypts at the point of use — via pagesService or
        // explicitly (resubscribe-messaging-postbacks.ts, whatsappTokenHealth.ts).
        // `safeDecryptToken` yields '' for an absent OR undecryptable token, which
        // is exactly "no usable token": both must block the posts read, not reach Graph.
        const accessToken = safeDecryptToken(page.encryptedAccessToken, { entity: 'page', id: page.id });
        // Same rule the client gates the button with (@jawab24/shared), so what the
        // UI offers and what this service accepts cannot drift apart. The eligible
        // branch carries the non-null page id straight to the Graph call.
        const eligibility = postsScanEligibility({
            facebookPageId: page.facebookPageId,
            hasUsableToken: !!accessToken,
        });

        // Configured replies come from our own DB — readable even when the posts
        // are not (dead token). They decide whether an ineligible page degrades
        // to a replies-only scan or is a genuine dead end.
        const replyRows = await this.fetchPostReplies(pageId);
        if (!eligibility.eligible && replyRows.length === 0) throw new CatalogScanUnavailableError();

        let fresh: Awaited<ReturnType<typeof facebookService.getPagePosts>>['posts'] = [];
        let postsUnavailable: PostsUnavailableReason | null = null;
        let postsRead = false;
        if (eligibility.eligible) {
            const { posts: fetched, failed } = await facebookService.getPagePosts(eligibility.facebookPageId, accessToken, {
                limit: MAX_SCAN_POSTS,
                fullImages: true,
            });
            if (failed) {
                // A Graph failure must NEVER masquerade as "up to date" — that
                // told merchants "nothing new, post something" while their token
                // was the thing that broke (the fail-soft masking bug). The
                // merchant sees the degraded notice; this makes the SAME event
                // visible to ops — "how often do scans degrade" must be
                // answerable server-side before the widen-gate call.
                postsUnavailable = 'graph_error';
                captureError(new Error('Catalog page-scan: Graph posts read failed, degrading to replies-only'),
                    'Catalog page-scan degraded (graph_error)', {
                        level: 'warning', tags: { service: 'catalog-scan' },
                        extra: { pageId, replies: replyRows.length },
                    });
            } else {
                postsRead = true;
                // The re-scan bookmark means "skip posts I've already reviewed" —
                // it only makes sense once a catalog EXISTS. With zero items there
                // is nothing to be "up to date" against, and a first scan that
                // proposed nothing (an announcements-only window, image-less
                // posts, or a merchant who dismissed every proposal) still
                // advances the bookmark — which would otherwise lock an empty
                // page into "all up to date" forever, with no items and no way to
                // re-scan. So an empty catalog always scans the full recent window.
                const [existingItem] = await db
                    .select({ id: catalogItems.id })
                    .from(catalogItems)
                    .where(eq(catalogItems.pageId, pageId))
                    .limit(1);
                const since = existingItem !== undefined ? page.catalogScanLastPostTime : null;
                fresh = fetched.filter((p) => {
                    if (!p.createdTime) return false;
                    return !since || new Date(p.createdTime) > since;
                });
            }
        } else {
            postsUnavailable = eligibility.blocker;
        }

        const base = { postsScanned: fresh.length, postsUnavailable };
        if (fresh.length === 0 && replyRows.length === 0) {
            // "Up to date" is a claim about the posts — only an ACTUAL read may
            // make it. An unreadable page with no replies never reaches here
            // (thrown above); a graph_error one reports the failure instead.
            return {
                items: [], dropped: 0, truncated: false, failed: false,
                ...base, repliesScanned: 0, upToDate: postsRead, paidCall: false,
            };
        }

        // A fresh post whose configured reply is attached becomes ONE complete
        // block — name from the post, price from the reply — and (when the post
        // has its own text) spends NO image budget: the budget belongs to the
        // posts that still need OCR to be identified at all.
        const replyByFbPostId = new Map<string, PostReplyRow>();
        for (const row of replyRows) {
            if (row.facebookPostId) replyByFbPostId.set(row.facebookPostId, row);
        }
        const mergedReplies = new Set<PostReplyRow>();

        // Newest-first (Graph order): the freshest offerings win the image budget.
        let imageBudget = MAX_SCAN_IMAGES;
        // Vision dispatches, counted where the budget is spent. Over-counts the
        // never-costing skips inside readImage (non-CDN URL, failed download) —
        // acceptable: an over-count charges the cap conservatively, never frees it.
        let visionCalls = 0;
        const postBlocks: ScanBlock[] = [];
        for (const post of fresh) {
            const parts: string[] = [];
            if (post.message?.trim()) parts.push(post.message.trim());

            const reply = replyByFbPostId.get(post.id);
            const replyText = reply?.triggerReply?.trim() ?? '';
            if (reply && replyText) {
                mergedReplies.add(reply);
                parts.push(`CONFIGURED REPLY: ${replyText}`);
            }
            // A replied post with its own text is already complete (name + price)
            // — no OCR. Text-less posts keep their images even with a reply: the
            // product's NAME may only exist in the photo (spec cards, schedules).
            if (!replyText || !post.message?.trim()) {
                for (const url of post.imageUrls.slice(0, MAX_IMAGES_PER_POST)) {
                    if (imageBudget <= 0) break;
                    imageBudget -= 1;
                    visionCalls += 1;
                    const text = await this.readImage(url, ctx.userId, pageId);
                    if (text) parts.push(text);
                }
            }

            if (parts.length === 0) continue;
            const date = post.createdTime ? post.createdTime.slice(0, 10) : 'unknown date';
            postBlocks.push({ text: `POST (${date}):\n${parts.join('\n')}`, replyCount: reply && replyText ? 1 : 0 });
        }

        // The rest of the configured replies — older FB posts and ALL Instagram
        // rows — as standalone blocks, newest first. Ageless on purpose: the
        // window/bookmark govern the Graph read, not our own DB.
        const replyBlocks: ScanBlock[] = [];
        for (const row of replyRows) {
            if (mergedReplies.has(row)) continue;
            if (!row.triggerReply?.trim()) continue;
            const date = row.createdTime ? row.createdTime.toISOString().slice(0, 10) : 'unknown date';
            const postText = row.text?.trim();
            const postLine = postText ? `\nPOST: ${postText.slice(0, POST_CONTEXT_MAX_CHARS)}` : '';
            replyBlocks.push({ text: `POST REPLY (${date}):${postLine}\nREPLY: ${row.triggerReply.trim()}`, replyCount: 1 });
        }

        if (postBlocks.length === 0 && replyBlocks.length === 0) {
            // Only image-less/empty posts in the window (reels, plain links) and
            // no replies. Nothing was extractable, nothing was lost — safe to bookmark.
            if (postsRead && fresh.length > 0) await this.advanceBookmark(pageId, fresh[0].createdTime);
            return {
                items: [], dropped: 0, truncated: false, failed: false,
                ...base, repliesScanned: 0, upToDate: false, paidCall: visionCalls > 0,
            };
        }

        const { combined, repliesIncluded, inputTruncated } = this.assembleInput(replyBlocks, postBlocks);
        const vertical = resolveCatalogVertical(page.catalogVertical, page.businessProfile as StoredBusinessProfile);
        const result = await catalogExtractor.extract(combined, {
            userId: ctx.userId,
            pageId,
            vertical: vertical.effective,
            source: 'page',
        });

        // A failed AI call must not advance the bookmark — the merchant retries
        // and the same posts are re-proposed instead of silently vanishing.
        if (postsRead && fresh.length > 0 && !result.failed) await this.advanceBookmark(pageId, fresh[0].createdTime);

        return {
            ...result,
            ...base,
            repliesScanned: repliesIncluded,
            upToDate: false,
            // The extractor's flag covers OUTPUT truncation (finish_reason). The
            // input cap dropping blocks is the same honesty problem on the way
            // in — either way the merchant must see "some content didn't fit".
            truncated: result.truncated || inputTruncated,
            paidCall: visionCalls > 0 || combined.trim().length > 0,
        };
    }

    /**
     * Assemble the extractor input under MAX_CATALOG_IMPORT_CHARS, whole blocks
     * only, in value order (D-059): standalone reply blocks FIRST — they carry
     * the merchant-authored prices the whole merge exists to recover, they are
     * small, and appending them last let a heavy OCR window silently push every
     * one of them past the cap on exactly the flagship page shape. Post blocks
     * follow newest-first, so old posts are still the first to degrade. The one
     * mid-block slice: the first post block that no longer fits contributes its
     * head when meaningful room remains (a 20k-char price-list post must not
     * vanish whole). Reports how many replies actually made it in, and whether
     * anything was dropped — silent input truncation is what let this bug hide.
     */
    private assembleInput(replyBlocks: ScanBlock[], postBlocks: ScanBlock[]): {
        combined: string; repliesIncluded: number; inputTruncated: boolean;
    } {
        const SEP = '\n\n---\n\n';
        const included: string[] = [];
        let used = 0;
        let repliesIncluded = 0;
        let inputTruncated = false;

        const fits = (text: string) => used + (included.length > 0 ? SEP.length : 0) + text.length <= MAX_CATALOG_IMPORT_CHARS;
        const push = (text: string) => {
            used += (included.length > 0 ? SEP.length : 0) + text.length;
            included.push(text);
        };

        // Replies: sizes vary (a one-line offer vs a full course sheet), so a
        // non-fitting one is skipped and later smaller ones still get their shot.
        for (const block of replyBlocks) {
            if (!fits(block.text)) {
                inputTruncated = true;
                continue;
            }
            push(block.text);
            repliesIncluded += block.replyCount;
        }

        // Posts: strictly newest-first — once one doesn't fit, everything after
        // it is older and lower-value, so stop rather than cherry-pick. Salvage
        // the head of the boundary block when there's meaningful room; its
        // merged reply is NOT counted as read (the slice may have cut it).
        for (const block of postBlocks) {
            if (fits(block.text)) {
                push(block.text);
                repliesIncluded += block.replyCount;
                continue;
            }
            inputTruncated = true;
            const room = MAX_CATALOG_IMPORT_CHARS - used - (included.length > 0 ? SEP.length : 0);
            if (room >= MIN_SALVAGE_CHARS) push(block.text.slice(0, room));
            break;
        }

        return { combined: included.join(SEP), repliesIncluded, inputTruncated };
    }

    /** Both channels, each newest-first + capped, then merged and re-capped —
     *  so neither channel alone can exceed the fetch bound. */
    private async fetchPostReplies(pageId: string): Promise<PostReplyRow[]> {
        const [fbRows, igRows] = await Promise.all([
            db.select({
                facebookPostId: posts.facebookPostId,
                text: posts.message,
                triggerReply: posts.triggerReply,
                createdTime: posts.createdTime,
            })
                .from(posts)
                .where(and(
                    eq(posts.pageId, pageId),
                    isNotNull(posts.triggerReply),
                    sql`length(trim(${posts.triggerReply})) > 0`,
                ))
                .orderBy(sql`${posts.createdTime} DESC NULLS LAST`)
                .limit(MAX_POST_REPLIES_SCAN),
            db.select({
                text: instagramMedia.caption,
                triggerReply: instagramMedia.triggerReply,
                createdTime: instagramMedia.createdTime,
            })
                .from(instagramMedia)
                .where(and(
                    eq(instagramMedia.pageId, pageId),
                    isNotNull(instagramMedia.triggerReply),
                    sql`length(trim(${instagramMedia.triggerReply})) > 0`,
                ))
                .orderBy(sql`${instagramMedia.createdTime} DESC NULLS LAST`)
                .limit(MAX_POST_REPLIES_SCAN),
        ]);

        return [
            ...fbRows,
            ...igRows.map((r) => ({ ...r, facebookPostId: null })),
        ]
            .sort((a, b) => (b.createdTime?.getTime() ?? -Infinity) - (a.createdTime?.getTime() ?? -Infinity))
            .slice(0, MAX_POST_REPLIES_SCAN);
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
            captureError(err, 'Catalog page-scan image read failed', {
                level: 'warning', tags: { service: 'catalog-scan' }, extra: { pageId },
            });
            return null;
        }
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
