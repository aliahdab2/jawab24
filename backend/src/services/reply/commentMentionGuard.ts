import { redis } from '../../lib/redis';
import { fbAxios } from '../../lib/fbAxios';
import { facebookService } from '../facebook';
import { config } from '../../config';
import { captureError } from '../../utils/sentryHelpers';
import { mentionRendered, renderedTagIdMismatch } from '../../utils/commentMention';
import { Logger, noopLogger } from '../../types';

const FACEBOOK_GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

/**
 * Safety net for the Post Reply "tag the commenter" option.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * Meta only renders `@[PSID]` as a real mention when the PAGE has «Others Tagging this Page»
 * enabled, and that setting is not readable through ANY API. Measured on production
 * 2026-08-07 against a real page: `GET /{page-id}/settings` returns 13 settings and none of
 * them is this one (the closest, USERS_CAN_TAG_PHOTOS, governs tagging people in the page's
 * photos); `GET /{page-id}?fields=are_tagging_others_allowed` is a nonexisting field; and
 * `?metadata=1` field introspection is disabled on v23.0. Page history is no help either —
 * across 902 comments on 3 live pages, zero were page-authored mentions.
 *
 * So the capability CANNOT be known before trying. It can only be learned by attempting.
 *
 * WHAT ATTEMPTING ACTUALLY COSTS (measured live on our own page, 2026-08-07)
 * -------------------------------------------------------------------------
 * An `@[id]` Meta cannot resolve is STRIPPED, silently: posting `@[<page-id>] probe1` and
 * `@[999999999999999] probe2` both returned HTTP 200 and read back as `" probe1"` / `" probe2"`
 * — no `message_tags`, no error, and NO literal `@[…]` left in the text. So the feared
 * failure (raw markup in front of customers) does not occur; what remains is a comment with
 * a stray leading space and no mention. That is a much smaller defect than assumed, and this
 * guard is what removes even that: the same read-back detects it and rewrites the comment.
 * The repair call itself is verified against real Graph — `POST /{comment-id}` with a new
 * `message` returned `{"success":true}` and the text changed.
 *
 * WHAT THIS DOES
 * --------------
 * 1. `mentionPlan` — skip on a page known to reject tags, TRUST a page that recently
 *    rendered one (no read-back), and VERIFY anything unproven.
 * 2. `verifyAndRepair` — read the comment we just posted back; if Meta did not render the
 *    mention, rewrite that comment to the clean text (Graph supports editing a comment we
 *    own) and remember the page as unsupported. On success it records the page as supported,
 *    so verification costs one read per page per week instead of one per reply.
 *
 * Blast radius is therefore ONE briefly-wrong comment per page rather than one per comment,
 * and it self-heals: the memo has a TTL, so a merchant who later enables the setting starts
 * getting mentions again without us touching anything.
 *
 * The memo is Redis, not a column: it is a cache of someone else's mutable setting, not a
 * fact about our data. A column would need a migration, a backfill story, and manual repair
 * when the merchant flips the switch back.
 */
/**
 * Both keys are scoped by the FACEBOOK page id (`platformPageId`), not the internal page
 * UUID — spelled out in the key so it cannot be confused with `comment:postreplycap:{uuid}`,
 * which keys the same-looking way on a different id space.
 */
const UNSUPPORTED_KEY_PREFIX = 'comment:mention:unsupported:fbpage:';
const SUPPORTED_KEY_PREFIX = 'comment:mention:supported:fbpage:';

/** 30 days — long enough that a forbidden page stops paying the verify cost on every send,
 *  short enough that enabling the Facebook setting takes effect without support intervention. */
const UNSUPPORTED_TTL_SECONDS = 30 * 24 * 60 * 60;
/** 7 days — deliberately SHORTER than the negative memo. A proven page skips verification
 *  (that is the point), but a merchant who later switches «Others Tagging» off must be
 *  re-detected in days, not a month, because until then every reply silently loses its
 *  mention and keeps the stray leading space. */
const SUPPORTED_TTL_SECONDS = 7 * 24 * 60 * 60;

/** What to do about a mention on this page. */
export type MentionPlan =
    | 'skip'    // page is known to reject mentions — post untagged
    | 'verify'  // unproven page — tag, then read back and repair if needed
    | 'trust';  // page has rendered a mention recently — tag without the extra read

function unsupportedKey(pageId: string): string { return `${UNSUPPORTED_KEY_PREFIX}${pageId}`; }
function supportedKey(pageId: string): string { return `${SUPPORTED_KEY_PREFIX}${pageId}`; }

/** Fire-and-forget outcome counters, in the style of aiMetrics: diagnostics must never
 *  delay or fail a reply. Without these, "is tagging working across the fleet?" is only
 *  answerable by reading Sentry warnings one page at a time. */
function countOutcome(redisClient: typeof redis, outcome: 'rendered' | 'stripped' | 'skipped' | 'unverified'): void {
    // try/catch AND .catch(): a rejected promise is not the only failure mode — a client
    // that throws synchronously would otherwise escape into the caller's catch block and
    // silently change the decision this counter is only supposed to observe.
    try {
        redisClient.incr(`metrics:mention:${outcome}`).catch(() => { /* diagnostic only */ });
    } catch { /* diagnostic only */ }
}

export class CommentMentionGuard {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * What should this page do about mentions — skip, tag-and-verify, or tag on trust?
     *
     * A page that has already rendered a mention returns 'trust', so verification costs ONE
     * extra Graph read per page per week rather than one per reply. That matters: Post Reply
     * already spends a DM send + a public post (+ an optional like) per comment against Meta's
     * ~4,800 calls/page/day ceiling, and an any-comment rule can fire 300 times in a day.
     *
     * Fail-OPEN to 'verify' on Redis errors, deliberately: the merchant armed this per post,
     * and verification is what bounds the damage. Failing closed would silently drop a feature
     * they switched on because an unrelated cache blipped.
     */
    async mentionPlan(pageId: string): Promise<MentionPlan> {
        try {
            const [unsupported, supported] = await Promise.all([
                redis.get(unsupportedKey(pageId)),
                redis.get(supportedKey(pageId)),
            ]);
            if (unsupported) {
                countOutcome(redis, 'skipped');
                return 'skip';
            }
            return supported ? 'trust' : 'verify';
        } catch (error) {
            this.logger.warn('[MentionGuard] Redis error on check — will tag and verify', { pageId, error });
            return 'verify';
        }
    }

    /**
     * Confirm Meta rendered the mention in the comment we just posted; repair it if not.
     *
     * Never throws: the reply itself has already been delivered by the time this runs, and a
     * verification problem must not turn a successful send into a failed job (which BullMQ
     * would retry, double-posting the comment).
     *
     * @param postedCommentId the id Graph returned for OUR comment
     * @param psid            the commenter we tried to mention
     * @param plainText       what the comment should say without the mention (the repair text)
     */
    async verifyAndRepair(opts: {
        postedCommentId: string;
        pageId: string;
        psid: string;
        plainText: string;
        accessToken: string;
    }): Promise<{ rendered: boolean }> {
        const { postedCommentId, pageId, psid, plainText, accessToken } = opts;
        try {
            const posted = await facebookService.getCommentWithTags(postedCommentId, accessToken);
            // A null read is inconclusive (network/permission), NOT proof of a broken tag.
            // Repairing on inconclusive evidence would strip a mention that rendered fine.
            if (!posted) {
                countOutcome(redis, 'unverified');
                this.logger.warn('[MentionGuard] Could not read back the posted comment — leaving it as is', {
                    pageId, postedCommentId,
                });
                return { rendered: true };
            }

            if (mentionRendered(posted.message_tags)) {
                // Answers the one question the pre-merge probes could not: does Graph echo
                // back the PSID we sent? Logged rather than acted on — see mentionRendered.
                const mismatch = renderedTagIdMismatch(posted.message_tags, psid);
                if (mismatch) {
                    this.logger.info('[MentionGuard] Mention rendered under a different id than we sent', {
                        pageId, sentPsid: psid, renderedId: mismatch,
                    });
                }
                countOutcome(redis, 'rendered');
                await this.rememberSupported(pageId);
                return { rendered: true };
            }

            // Not rendered → the page forbids tagging. Repair this comment, then stop tagging
            // on this page so the next comment never repeats it.
            await this.repair(postedCommentId, plainText, accessToken);
            await this.rememberUnsupported(pageId);
            countOutcome(redis, 'stripped');
            captureError(
                new Error('Facebook did not render a comment mention; reply repaired and tagging paused for this page'),
                'Post Reply mention not rendered',
                {
                    fingerprint: ['post-reply-mention-not-rendered'],
                    level: 'warning',
                    tags: { platform: 'facebook', component: 'comment-mention-guard' },
                    extra: { pageId, postedCommentId },
                },
            );
            return { rendered: false };
        } catch (error) {
            this.logger.error('[MentionGuard] Verification failed', { pageId, postedCommentId, error });
            return { rendered: true };
        }
    }

    /** Rewrite our own comment to the mention-free text. */
    private async repair(commentId: string, plainText: string, accessToken: string): Promise<void> {
        await fbAxios.post(
            `${FACEBOOK_GRAPH_API}/${encodeURIComponent(commentId)}`,
            { message: plainText },
            {
                // Replay-safe POST: this UPDATES our own existing comment to a fixed
                // text — replaying converges on the same final state, it cannot create
                // a second comment.
                semanticallyIdempotent: true,
                params: { access_token: accessToken },
            },
        );
    }

    /** Remember that this page rejects mentions, for UNSUPPORTED_TTL_SECONDS. */
    private async rememberUnsupported(pageId: string): Promise<void> {
        try {
            // Clear any stale positive memo in the same breath: a page that just failed must
            // not keep skipping verification because it succeeded last week.
            await redis.del(supportedKey(pageId));
            await redis.set(unsupportedKey(pageId), '1', 'EX', UNSUPPORTED_TTL_SECONDS);
        } catch (error) {
            this.logger.error('[MentionGuard] Redis error while recording unsupported page', { pageId, error });
        }
    }

    /** Remember that this page DOES render mentions, so later replies skip the read-back. */
    private async rememberSupported(pageId: string): Promise<void> {
        try {
            await redis.set(supportedKey(pageId), '1', 'EX', SUPPORTED_TTL_SECONDS);
        } catch (error) {
            this.logger.error('[MentionGuard] Redis error while recording supported page', { pageId, error });
        }
    }
}

export const commentMentionGuard = new CommentMentionGuard();
