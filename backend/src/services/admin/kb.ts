import type { FastifyBaseLogger } from 'fastify';
import { db } from '../../db';
import { pages, kbChunks, kbGaps, users } from '../../db/schema';
import { eq, desc, and, sql, isNotNull } from 'drizzle-orm';
import { getIngestionService } from '../pages';
import { replyGenerator } from '../reply/generator';
import { buildPlaygroundContext, PLAYGROUND_PAGE_COLUMNS } from '../reply/playgroundContext';
import { NotFoundError, ValidationError, ExternalServiceError } from '../../utils/errors';
import type { PlaygroundRequestBody } from '../../types/admin';

/**
 * Admin KB / AI-playground service.
 *
 * Wraps the existing ingestion + reply-generator + playground-context services.
 * Behaviour-preserving: KB update fires ingestion fire-and-forget; re-ingest is
 * still synchronous (NOT backgrounded — out of scope for the refactor).
 */

export interface KbStatus {
    pageId: string;
    pageName: string | null;
    kbText: string;
    kbLength: number;
    kbVersion: number | null;
    kbActiveVersion: number | null;
    kbUpdatedAt: Date | null;
    chunksCount: number;
    gapsCount: number;
}

export interface KbUpdateResult {
    pageId: string;
    kbVersion: number | null;
    kbLength: number;
}

export interface ReIngestResult {
    reIngested: number;
    total?: number;
    message?: string;
    results?: { pageId: string; name: string | null; status: string; newVersion: number }[];
}

export interface PlaygroundResult {
    reply: Awaited<ReturnType<typeof replyGenerator.generateForPlayground>>;
    latencyMs: number;
    commentReplyMode: 'public' | 'private' | 'dual' | null;
    nudgeText: string | null;
}

class AdminKbService {
    /** All pages with KB version info + owning user's email — for the playground dropdown. */
    async listPagesForPlayground() {
        return db
            .select({
                id: pages.id,
                name: pages.name,
                kbVersion: pages.kbVersion,
                kbActiveVersion: pages.kbActiveVersion,
                userId: pages.userId,
                userEmail: users.email,
            })
            .from(pages)
            .leftJoin(users, eq(pages.userId, users.id))
            .orderBy(pages.name);
    }

    /** KB status (text, version, chunk + unresolved-gap counts) for a page. Null = page not found. */
    async getStatus(pageId: string): Promise<KbStatus | null> {
        const [page] = await db
            .select({
                id: pages.id,
                name: pages.name,
                knowledgeBase: pages.knowledgeBase,
                kbVersion: pages.kbVersion,
                kbActiveVersion: pages.kbActiveVersion,
                kbUpdatedAt: pages.kbUpdatedAt,
            })
            .from(pages)
            .where(eq(pages.id, pageId))
            .limit(1);

        if (!page) return null;

        const [chunkCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(kbChunks)
            .where(
                and(
                    eq(kbChunks.pageId, pageId),
                    page.kbActiveVersion !== null
                        ? eq(kbChunks.kbVersion, page.kbActiveVersion)
                        : sql`false`,
                ),
            );

        const [gapCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(kbGaps)
            .where(and(eq(kbGaps.pageId, pageId), eq(kbGaps.resolved, false)));

        return {
            pageId: page.id,
            pageName: page.name,
            kbText: page.knowledgeBase || '',
            kbLength: page.knowledgeBase?.length || 0,
            kbVersion: page.kbVersion,
            kbActiveVersion: page.kbActiveVersion,
            kbUpdatedAt: page.kbUpdatedAt,
            chunksCount: chunkCount?.count || 0,
            gapsCount: gapCount?.count || 0,
        };
    }

    /** List KB gaps for a page, most-frequent first. */
    async listGaps(pageId: string) {
        return db
            .select({
                id: kbGaps.id,
                queryText: kbGaps.queryText,
                detectedIntent: kbGaps.detectedIntent,
                occurrenceCount: kbGaps.occurrenceCount,
                firstSeenAt: kbGaps.firstSeenAt,
                lastSeenAt: kbGaps.lastSeenAt,
                resolved: kbGaps.resolved,
            })
            .from(kbGaps)
            .where(eq(kbGaps.pageId, pageId))
            .orderBy(desc(kbGaps.occurrenceCount));
    }

    /**
     * Update KB text for a page, bump version, and fire-and-forget ingestion.
     * Throws ValidationError (400) if knowledgeBase isn't a string, NotFoundError
     * (404) if the page is missing.
     */
    async updateKb(pageId: string, knowledgeBase: string, log: FastifyBaseLogger): Promise<KbUpdateResult> {
        if (typeof knowledgeBase !== 'string') {
            throw new ValidationError('knowledgeBase (string) is required');
        }

        const [page] = await db
            .select({ id: pages.id, kbVersion: pages.kbVersion })
            .from(pages)
            .where(eq(pages.id, pageId))
            .limit(1);

        if (!page) {
            throw new NotFoundError('Page not found');
        }

        const newVersion = (page.kbVersion ?? 0) + 1;
        const [updated] = await db
            .update(pages)
            .set({
                knowledgeBase,
                kbVersion: newVersion,
                kbUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(pages.id, pageId))
            .returning();

        // Fire-and-forget: trigger KB ingestion
        if (knowledgeBase.trim() && updated?.kbVersion) {
            const ingestion = getIngestionService();
            if (ingestion) {
                ingestion.ingestKnowledgeBase(pageId, knowledgeBase, updated.kbVersion)
                    .catch(err => log.error(err, 'Admin KB ingestion failed'));
            }
        }

        return { pageId: updated.id, kbVersion: updated.kbVersion, kbLength: knowledgeBase.length };
    }

    /**
     * Re-ingest KB chunks for all pages (or a single page). Synchronous per the
     * original — awaits each page's ingestion before the next. Throws
     * ExternalServiceError (503) when no ingestion service (no OpenAI key).
     */
    async reIngest(pageId: string | undefined, log: FastifyBaseLogger): Promise<ReIngestResult> {
        const ingestion = getIngestionService();
        if (!ingestion) {
            throw new ExternalServiceError('Ingestion', 'Ingestion service unavailable (no OpenAI key)');
        }

        const condition = pageId
            ? and(eq(pages.id, pageId), isNotNull(pages.knowledgeBase))
            : isNotNull(pages.knowledgeBase);

        const pagesWithKB = await db
            .select({ id: pages.id, name: pages.name, knowledgeBase: pages.knowledgeBase, kbVersion: pages.kbVersion })
            .from(pages)
            .where(condition);

        if (pagesWithKB.length === 0) {
            return { reIngested: 0, message: 'No pages with KB content found' };
        }

        const results: { pageId: string; name: string | null; status: string; newVersion: number }[] = [];

        for (const p of pagesWithKB) {
            try {
                const newVersion = (p.kbVersion ?? 0) + 1;

                await db.update(pages).set({
                    kbVersion: newVersion,
                    kbUpdatedAt: new Date(),
                    updatedAt: new Date(),
                }).where(eq(pages.id, p.id));

                await ingestion.ingestKnowledgeBase(p.id, p.knowledgeBase ?? '', newVersion);

                results.push({ pageId: p.id, name: p.name, status: 'ok', newVersion });
                log.info({ pageId: p.id, newVersion }, 'KB re-ingested');
            } catch (err) {
                log.error(err, `KB re-ingestion failed for page ${p.id}`);
                results.push({ pageId: p.id, name: p.name, status: 'error', newVersion: p.kbVersion ?? 0 });
            }
        }

        return {
            reIngested: results.filter(r => r.status === 'ok').length,
            total: pagesWithKB.length,
            results,
        };
    }

    /**
     * Run the AI playground for a page. Throws ValidationError (400) for missing
     * pageId/question, NotFoundError (404) for a missing page.
     */
    async runPlayground(body: PlaygroundRequestBody, log: FastifyBaseLogger): Promise<PlaygroundResult> {
        const {
            pageId, question, channel, postMessage, messageTags, ourFacebookPageId,
            conversationHistory, replyStyle, brandVoiceNotes, customerContext, senderName, minutesSinceLastMessage, model, source,
        } = body;
        const startTime = Date.now();

        if (!pageId || !question?.trim()) {
            throw new ValidationError('pageId and question are required');
        }

        const [page] = await db
            // The shared prompt-column subset (incl. the D-084 page persona) —
            // hand-listing columns here is how a preview drifts from production
            // (wrong reply AND wrong `bv:` cache key), so the list lives in ONE
            // place both this select and warm-reply-cache spread.
            .select({ ...PLAYGROUND_PAGE_COLUMNS })
            .from(pages)
            .where(eq(pages.id, pageId))
            .limit(1);

        if (!page) {
            throw new NotFoundError('Page not found');
        }

        const { playgroundInput, commentReplyMode, nudgeText } = await buildPlaygroundContext({
            page, question, channel, postMessage, messageTags, ourFacebookPageId,
            conversationHistory, replyStyle, brandVoiceNotes, customerContext, senderName, minutesSinceLastMessage, model, source,
        });

        replyGenerator.setLogger(log);
        const result = await replyGenerator.generateForPlayground(playgroundInput);

        return {
            reply: result,
            latencyMs: Date.now() - startTime,
            commentReplyMode: channel === 'comment' ? commentReplyMode : null,
            nudgeText: channel === 'comment' ? nudgeText : null,
        };
    }
}

export const adminKbService = new AdminKbService();
