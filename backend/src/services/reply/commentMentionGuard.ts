import { redis } from '../../lib/redis';
import { fbAxios } from '../../lib/fbAxios';
import { facebookService } from '../facebook';
import { config } from '../../config';
import { captureError } from '../../utils/sentryHelpers';
import { mentionRendered } from '../../utils/commentMention';
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
 * 1. `shouldTag` — skip the mention entirely on a page already known to reject tags.
 * 2. `verifyAndRepair` — read the comment we just posted back; if Meta did not render the
 *    mention, rewrite that comment to the clean text (Graph supports editing a comment we
 *    own) and remember the page as unsupported.
 *
 * Blast radius is therefore ONE briefly-wrong comment per page rather than one per comment,
 * and it self-heals: the memo has a TTL, so a merchant who later enables the setting starts
 * getting mentions again without us touching anything.
 *
 * The memo is Redis, not a column: it is a cache of someone else's mutable setting, not a
 * fact about our data. A column would need a migration, a backfill story, and manual repair
 * when the merchant flips the switch back.
 */
const UNSUPPORTED_KEY_PREFIX = 'comment:mention:unsupported:';
/** 30 days — long enough that a forbidden page stops paying the verify cost on every send,
 *  short enough that enabling the Facebook setting takes effect without support intervention. */
const UNSUPPORTED_TTL_SECONDS = 30 * 24 * 60 * 60;

function buildKey(pageId: string): string {
    return `${UNSUPPORTED_KEY_PREFIX}${pageId}`;
}

export class CommentMentionGuard {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * May we attach a mention on this page? False once a tag has been proven not to render.
     *
     * Fail-OPEN on Redis errors, deliberately: the merchant armed this option per post, and
     * the verify step below is what actually bounds the damage. Failing closed would silently
     * drop a feature the merchant switched on because an unrelated cache blipped.
     */
    async shouldTag(pageId: string): Promise<boolean> {
        try {
            return !(await redis.get(buildKey(pageId)));
        } catch (error) {
            this.logger.warn('[MentionGuard] Redis error on check — attempting the mention', { pageId, error });
            return true;
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
                this.logger.warn('[MentionGuard] Could not read back the posted comment — leaving it as is', {
                    pageId, postedCommentId,
                });
                return { rendered: true };
            }

            if (mentionRendered(posted.message_tags, psid)) return { rendered: true };

            // Not rendered → the page forbids tagging. Repair this comment, then stop tagging
            // on this page so the next comment never repeats it.
            await this.repair(postedCommentId, plainText, accessToken);
            await this.rememberUnsupported(pageId);
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
            { params: { access_token: accessToken } },
        );
    }

    /** Remember that this page rejects mentions, for UNSUPPORTED_TTL_SECONDS. */
    private async rememberUnsupported(pageId: string): Promise<void> {
        try {
            await redis.set(buildKey(pageId), '1', 'EX', UNSUPPORTED_TTL_SECONDS);
        } catch (error) {
            this.logger.error('[MentionGuard] Redis error while recording unsupported page', { pageId, error });
        }
    }
}

export const commentMentionGuard = new CommentMentionGuard();
