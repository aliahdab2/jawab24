/**
 * Post-deploy reply-cache warm job.
 *
 * Replays the most frequent AI-replied COMMENTS of the last 7 days through the
 * playground pipeline (replyGenerator.generateForPlayground): the full
 * production path — preprocessing, RAG, AI call, cache writes — with NO
 * customer sends and no quota consumption. Replaying an already-cached message
 * is an exact-cache HIT (no OpenAI call), so this is cheap and idempotent on
 * every deploy; after a PROMPT_VERSION bump (which retires every old key) it
 * rebuilds the hot set before traffic switches to the new environment.
 *
 * Comments only, and only public-comment-mode pages: DM cache keys are
 * name/gender-bucketed and history-dependent, and dual/private pages flatten
 * comments into DM keys — neither can be warmed from here without producing
 * keys production never reads. Reply style and brand voice are cache-key
 * segments; buildPlaygroundContext resolves both from the page's WORKSPACE
 * settings — the same store production reads — so this script must NOT pass its
 * own values, or it writes keys under a persona production never resolves.
 *
 * Budget guards (env-tunable):
 *   WARM_CACHE_TOP_N          candidates to consider (default 300)
 *   WARM_CACHE_CONCURRENCY    parallel generations (default 4)
 *   WARM_CACHE_MAX_GENERATIONS stop after this many real generations (default 300)
 *   WARM_CACHE_DEADLINE_MS    wall-clock cap, exits 0 with partial warm (default 600000)
 *   WARM_REPLY_CACHE_DISABLED=1  skip entirely (deploy-time kill switch)
 *
 * Exit codes: 0 on success/partial/disabled; 1 only when setup itself failed
 * (DB/Redis unreachable) — the deploy hook treats any failure as non-fatal.
 *
 * Usage (prod, inside backend container): npm run cache:warm-replies
 * Usage (dev):                            npm run cache:warm-replies:dev
 */
import dotenv from 'dotenv';

dotenv.config();

import { and, eq, gte, desc, ne, inArray } from 'drizzle-orm';
import { db } from '../db';
import { comments, posts, instagramComments, instagramMedia, pages } from '../db/schema';
import { redis } from '../lib/redis';
import { settingsService } from '../services/settings';
import { buildPlaygroundContext, PLAYGROUND_PAGE_COLUMNS, type PlaygroundPageData } from '../services/reply/playgroundContext';
import { replyGenerator } from '../services/reply/generator';
import { rankWarmCandidates, type WarmCandidateRow } from '../services/cacheWarming';

const TOP_N = parseInt(process.env.WARM_CACHE_TOP_N || '300', 10);
const CONCURRENCY = parseInt(process.env.WARM_CACHE_CONCURRENCY || '4', 10);
const MAX_GENERATIONS = parseInt(process.env.WARM_CACHE_MAX_GENERATIONS || '300', 10);
const DEADLINE_MS = parseInt(process.env.WARM_CACHE_DEADLINE_MS || '600000', 10);
const WINDOW_DAYS = 7;
const SCAN_LIMIT = 20000;

interface PageWarmContext {
    page: PlaygroundPageData & { facebookPageId: string | null };
}

async function loadCandidateRows(since: Date): Promise<WarmCandidateRow[]> {
    // Only comments production actually AI-replied (excludes spam/skips,
    // post-trigger replies, templates, manual) on pages still auto-replying.
    const fbRows = await db
        .select({
            message: comments.message,
            pageId: posts.pageId,
            postMessage: posts.message,
            messageTags: comments.messageTags,
        })
        .from(comments)
        .innerJoin(posts, eq(comments.postId, posts.id))
        .innerJoin(pages, eq(posts.pageId, pages.id))
        .where(and(
            eq(comments.replyMethod, 'ai'),
            gte(comments.createdAt, since),
            eq(pages.autoReplyEnabled, true),
            ne(pages.accessToken, ''),
        ))
        .orderBy(desc(comments.createdAt))
        .limit(SCAN_LIMIT);

    const igRows = await db
        .select({
            message: instagramComments.message,
            pageId: instagramMedia.pageId,
            postMessage: instagramMedia.caption,
        })
        .from(instagramComments)
        .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
        .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
        .where(and(
            eq(instagramComments.replyMethod, 'ai'),
            gte(instagramComments.createdAt, since),
            eq(pages.instagramAutoReplyEnabled, true),
        ))
        .orderBy(desc(instagramComments.createdAt))
        .limit(SCAN_LIMIT);

    const rows: WarmCandidateRow[] = [];
    for (const r of fbRows) {
        if (r.pageId) rows.push({ message: r.message, pageId: r.pageId, postMessage: r.postMessage, platform: 'facebook', messageTags: r.messageTags ?? null });
    }
    for (const r of igRows) {
        if (r.pageId) rows.push({ message: r.message, pageId: r.pageId, postMessage: r.postMessage, platform: 'instagram', messageTags: null });
    }
    return rows;
}

async function loadPages(pageIds: string[]): Promise<Map<string, PageWarmContext | null>> {
    const contexts = new Map<string, PageWarmContext | null>();
    if (pageIds.length === 0) return contexts;

    const pageRows = await db
        // The shared prompt-column subset (incl. the D-084 page persona — a
        // `bv:` cache-key segment — and the reply mode, an `rm:` segment;
        // warming an override page without them writes keys production never
        // reads). One definition, spread by both this select and the admin
        // playground preview.
        .select({ ...PLAYGROUND_PAGE_COLUMNS, facebookPageId: pages.facebookPageId })
        .from(pages)
        .where(inArray(pages.id, pageIds));

    for (const page of pageRows) {
        if (!page.userId) { contexts.set(page.id, null); continue; }
        try {
            const ownerSettings = await settingsService.getSettings(page.userId);
            // Dual/private pages flatten comments to DM keys (senderName-bucketed)
            // in production — a warm through the comment path would write keys
            // production never reads. Skip them entirely.
            if ((ownerSettings.commentReplyMode || 'public') !== 'public') {
                contexts.set(page.id, null);
                continue;
            }
            contexts.set(page.id, { page });
        } catch {
            contexts.set(page.id, null);
        }
    }
    return contexts;
}

async function run() {
    if (process.env.WARM_REPLY_CACHE_DISABLED === '1' || process.env.WARM_REPLY_CACHE_DISABLED === 'true') {
        console.log('⏭️  WARM_REPLY_CACHE_DISABLED set — skipping reply-cache warm.');
        return;
    }

    const startedAt = Date.now();
    const deadline = startedAt + DEADLINE_MS;
    const since = new Date(startedAt - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    console.log(`🔍 Collecting AI-replied comments since ${since.toISOString()}...`);
    const rows = await loadCandidateRows(since);

    // Resolve page eligibility BEFORE ranking: rows from dual/private-mode or
    // ownerless pages must not consume top-N slots they can never warm (a
    // high-volume dual-mode merchant would otherwise silently crowd out the
    // whole run).
    const pageContexts = await loadPages([...new Set(rows.map(r => r.pageId))]);
    const pagesSkipped = [...pageContexts.values()].filter(v => v === null).length;
    const eligibleRows = rows.filter(r => pageContexts.get(r.pageId));

    const candidates = rankWarmCandidates(eligibleRows, TOP_N);
    console.log(`   ${rows.length} rows (${eligibleRows.length} on eligible pages) → ${candidates.length} candidates (top ${TOP_N})`);

    let hits = 0;
    let generated = 0;
    let skipped = 0;
    let errors = 0;
    let deadlineReached = false;

    let cursor = 0;
    let inFlight = 0;
    async function worker(): Promise<void> {
        for (;;) {
            const i = cursor++;
            if (i >= candidates.length) return;
            // Pessimistic budget reservation: count in-flight replays as
            // generations so N workers can't collectively overshoot the cap.
            // A replay that turns out to be a cache hit releases its slot.
            if (generated + inFlight >= MAX_GENERATIONS) return;
            if (Date.now() > deadline) { deadlineReached = true; return; }

            const candidate = candidates[i];
            const ctx = pageContexts.get(candidate.pageId);
            if (!ctx) { skipped++; continue; }

            inFlight++;
            try {
                const { playgroundInput } = await buildPlaygroundContext({
                    page: ctx.page,
                    question: candidate.message,
                    channel: 'comment',
                    postMessage: candidate.postMessage ?? undefined,
                    messageTags: candidate.messageTags ?? undefined,
                    ourFacebookPageId: ctx.page.facebookPageId ?? undefined,
                    // replyStyle / brandVoiceNotes deliberately NOT passed — see the file
                    // header: buildPlaygroundContext resolves both from the page's workspace
                    // settings, which is the store production reads.
                });
                // Tag the usage rows so warm cost is queryable and never blends
                // into prod reply pipelines (REPLY_PIPELINES excludes cache_warm).
                playgroundInput.pipeline = 'cache_warm';

                const result = await replyGenerator.generateForPlayground(playgroundInput);
                if (result.cached) hits++;
                else if (result.replyMethod === 'skipped') skipped++;
                else generated++;
            } catch (err) {
                errors++;
                console.warn(`   ⚠️  candidate ${i} (page ${candidate.pageId}) failed: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                inFlight--;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));

    const summary = {
        scanned: rows.length,
        candidates: candidates.length,
        pagesSkippedNonPublicOrOwnerless: pagesSkipped,
        hits,
        generated,
        skipped,
        errors,
        deadlineReached,
        elapsedMs: Date.now() - startedAt,
    };
    console.log(`✅ Reply-cache warm done: ${JSON.stringify(summary)}`);

    try {
        await redis.set('metrics:cache:warm:last_run', JSON.stringify({ ...summary, at: new Date(startedAt).toISOString() }));
        await redis.incrby('metrics:cache:warm:generated_total', generated);
        await redis.incrby('metrics:cache:warm:hits_total', hits);
    } catch {
        // Metrics are best-effort — never fail the warm for them.
    }
}

run()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Reply-cache warm failed during setup:', err);
        process.exit(1);
    });
