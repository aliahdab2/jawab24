import axios from 'axios';
import { and, eq } from 'drizzle-orm';
import { MAX_CATALOG_IMPORT_CHARS } from '@jawab24/shared';
import { db } from '../db';
import { pages } from '../db/schema';
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
 * must not silently swallow a window of posts.
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

        const { posts } = await facebookService.getPagePosts(page.facebookPageId, page.accessToken, {
            limit: MAX_SCAN_POSTS,
            fullImages: true,
        });

        const since = page.catalogScanLastPostTime;
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

    private async advanceBookmark(pageId: string, newestCreatedTime: string | null): Promise<void> {
        if (!newestCreatedTime) return;
        await db
            .update(pages)
            .set({ catalogScanLastPostTime: new Date(newestCreatedTime), updatedAt: new Date() })
            .where(eq(pages.id, pageId));
    }
}

export const catalogScanService = new CatalogScanService();
