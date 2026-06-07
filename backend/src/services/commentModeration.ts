/**
 * Comment Moderation Service (Facebook-only)
 *
 * Self-contained module for hiding, un-hiding, deleting, and blocking the author of
 * Facebook comments. Kept deliberately separate from the large `comments` service and
 * `facebook` service so the moderation feature has a small, isolated blast radius:
 * nothing here touches the shared comment-processing pipeline or existing CRUD paths.
 *
 * Scope notes:
 *   - Facebook only. Instagram comments are intentionally not moderated here (IG has no
 *     author-blocking Graph API, and IG support is deferred). An IG comment id resolves
 *     to `unsupported_platform`.
 *   - Hiding is reversible and invisible to everyone except the comment's author — the
 *     industry-standard safe action. Delete is permanent. Block bans the author from the
 *     page (requires pages_manage_metadata).
 *   - Demo pages/comments (the `demo_` id prefix) skip the real Graph call but still
 *     update the stored row, so the demo workspace can exercise the UI safely.
 */
import axios from 'axios';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { comments, instagramComments, pages, posts } from '../db/schema';
import { fbAxios, GRAPH_API_BASE } from '../lib/fbAxios';
import { FacebookApiError } from '../utils/fbGraphErrors';
import { captureError } from '../utils/sentryHelpers';
import { auditLog } from './auditLog';
import { maybeDecryptToken } from './facebookCrypto';
import type { ModerationSettings } from '@jawab24/shared';

export type ModerationStatus = 'ok' | 'not_found' | 'unsupported_platform' | 'no_identity';

export interface ModerationResult {
    status: ModerationStatus;
}

export interface BlockResult extends ModerationResult {
    blockedUserId?: string;
    platformPageId?: string;
}

/** Resolved Facebook moderation target: the platform ids + decrypted page token. */
interface FbModerationTarget {
    rowId: string;
    facebookCommentId: string;
    fromId: string | null;
    facebookPageId: string;
    accessToken: string;
    isDemo: boolean;
}

class CommentModerationService {
    /**
     * Resolve a Facebook comment (by our row id, scoped to the workspace) to its
     * platform comment id, commenter id, page id, and decrypted page token. Returns
     * null when the row isn't a Facebook comment owned by this workspace.
     */
    private async resolveFbTarget(commentId: string, workspaceId: string): Promise<FbModerationTarget | null> {
        const rows = await db
            .select({
                facebookCommentId: comments.facebookCommentId,
                fromId: comments.fromId,
                facebookPageId: pages.facebookPageId,
                accessToken: pages.accessToken,
            })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(comments.id, commentId), eq(comments.workspaceId, workspaceId)))
            .limit(1);

        const row = rows[0];
        if (!row || !row.facebookPageId) return null;

        return {
            rowId: commentId,
            facebookCommentId: row.facebookCommentId,
            fromId: row.fromId,
            facebookPageId: row.facebookPageId,
            accessToken: maybeDecryptToken(row.accessToken),
            isDemo: row.facebookPageId.startsWith('demo_'),
        };
    }

    /** True when the id belongs to an Instagram comment in this workspace (read-only check). */
    private async isInstagramComment(commentId: string, workspaceId: string): Promise<boolean> {
        const rows = await db
            .select({ id: instagramComments.id })
            .from(instagramComments)
            .where(and(eq(instagramComments.id, commentId), eq(instagramComments.workspaceId, workspaceId)))
            .limit(1);
        return rows.length > 0;
    }

    /** Distinguish "not a Facebook comment" into a precise status for the caller. */
    private async classifyMiss(commentId: string, workspaceId: string): Promise<ModerationStatus> {
        return (await this.isInstagramComment(commentId, workspaceId)) ? 'unsupported_platform' : 'not_found';
    }

    // ── Graph API calls (throw FacebookApiError on failure) ──────────────────

    private async fbSetHidden(facebookCommentId: string, hidden: boolean, accessToken: string): Promise<void> {
        try {
            await fbAxios.post(`${GRAPH_API_BASE}/${facebookCommentId}`, null, {
                params: { is_hidden: hidden, access_token: accessToken },
            });
        } catch (error) {
            if (axios.isAxiosError(error)) throw FacebookApiError.fromAxios(error, 'Facebook API error');
            throw error;
        }
    }

    private async fbDelete(facebookCommentId: string, accessToken: string): Promise<void> {
        try {
            await fbAxios.delete(`${GRAPH_API_BASE}/${facebookCommentId}`, {
                params: { access_token: accessToken },
            });
        } catch (error) {
            if (axios.isAxiosError(error)) throw FacebookApiError.fromAxios(error, 'Facebook API error');
            throw error;
        }
    }

    private async fbBlock(facebookPageId: string, userId: string, accessToken: string): Promise<void> {
        try {
            await fbAxios.post(`${GRAPH_API_BASE}/${facebookPageId}/blocked`, null, {
                params: { psid: userId, access_token: accessToken },
            });
        } catch (error) {
            if (axios.isAxiosError(error)) throw FacebookApiError.fromAxios(error, 'Facebook API error');
            throw error;
        }
    }

    // ── Stored-row updates (FB comments table) ───────────────────────────────

    private async markRowHidden(rowId: string, action: 'hide' | 'delete', moderatedBy: string): Promise<void> {
        await db
            .update(comments)
            .set({ hiddenAt: new Date(), moderationAction: action, moderatedBy, updatedAt: new Date() })
            .where(eq(comments.id, rowId));
    }

    private async markRowUnhidden(rowId: string): Promise<void> {
        await db
            .update(comments)
            .set({ hiddenAt: null, moderationAction: null, moderatedBy: null, updatedAt: new Date() })
            .where(eq(comments.id, rowId));
    }

    private async deleteRow(rowId: string): Promise<void> {
        await db.delete(comments).where(eq(comments.id, rowId));
    }

    // ── Public operations ────────────────────────────────────────────────────

    /**
     * Hide a Facebook comment. `moderatedBy` is 'auto' for automation or the acting
     * user id for manual actions. Throws on Graph API failure.
     */
    async hide(commentId: string, workspaceId: string, moderatedBy: string): Promise<ModerationResult> {
        const target = await this.resolveFbTarget(commentId, workspaceId);
        if (!target) return { status: await this.classifyMiss(commentId, workspaceId) };

        if (!target.isDemo) await this.fbSetHidden(target.facebookCommentId, true, target.accessToken);
        await this.markRowHidden(target.rowId, 'hide', moderatedBy);
        return { status: 'ok' };
    }

    /** Un-hide a previously hidden Facebook comment. Throws on Graph API failure. */
    async unhide(commentId: string, workspaceId: string): Promise<ModerationResult> {
        const target = await this.resolveFbTarget(commentId, workspaceId);
        if (!target) return { status: await this.classifyMiss(commentId, workspaceId) };

        if (!target.isDemo) await this.fbSetHidden(target.facebookCommentId, false, target.accessToken);
        await this.markRowUnhidden(target.rowId);
        return { status: 'ok' };
    }

    /**
     * Delete a Facebook comment on the platform, then remove the stored row.
     * Irreversible. Throws on Graph API failure (the row is kept so the action can retry).
     */
    async remove(commentId: string, workspaceId: string, moderatedBy: string): Promise<ModerationResult> {
        const target = await this.resolveFbTarget(commentId, workspaceId);
        if (!target) return { status: await this.classifyMiss(commentId, workspaceId) };

        if (!target.isDemo) await this.fbDelete(target.facebookCommentId, target.accessToken);
        await this.deleteRow(target.rowId);
        // moderatedBy is captured by the caller's audit log; the row no longer exists.
        void moderatedBy;
        return { status: 'ok' };
    }

    /**
     * Block the comment's author from the page (Facebook only). Returns `no_identity`
     * when the commenter id is unknown. Throws on Graph API failure.
     */
    async blockAuthor(commentId: string, workspaceId: string): Promise<BlockResult> {
        const target = await this.resolveFbTarget(commentId, workspaceId);
        if (!target) return { status: await this.classifyMiss(commentId, workspaceId) };
        if (!target.fromId) return { status: 'no_identity' };

        if (!target.isDemo) await this.fbBlock(target.facebookPageId, target.fromId, target.accessToken);
        return { status: 'ok', blockedUserId: target.fromId, platformPageId: target.facebookPageId };
    }

    /**
     * Auto-moderate an AI-flagged offensive/abusive Facebook comment, per the workspace's
     * moderation settings: block the author (if configured), then hide or delete the comment.
     *
     * FAIL-SAFE: fully wrapped in try/catch — a moderation failure NEVER propagates into the
     * comment-processing pipeline. Returns `true` when the comment was actioned (caller should
     * stop processing it), `false` on any failure (caller falls back to its normal flag flow).
     *
     * Block runs BEFORE delete because deleting removes the row that the author lookup reads.
     */
    async autoModerateOffensive(
        commentId: string,
        workspaceId: string,
        actorUserId: string,
        opts: Pick<ModerationSettings, 'action' | 'blockAuthor'>,
    ): Promise<boolean> {
        try {
            let blockedUserId: string | undefined;
            if (opts.blockAuthor) {
                const blockResult = await this.blockAuthor(commentId, workspaceId);
                if (blockResult.status === 'unsupported_platform' || blockResult.status === 'not_found') {
                    return false; // not a moderatable FB comment — let the caller flag it normally
                }
                blockedUserId = blockResult.blockedUserId;
            }

            const actionResult = opts.action === 'delete'
                ? await this.remove(commentId, workspaceId, 'auto')
                : await this.hide(commentId, workspaceId, 'auto');
            if (actionResult.status !== 'ok') return false;

            void auditLog({
                userId: actorUserId,
                workspaceId,
                action: 'moderation.auto_hide',
                entityType: 'comment',
                entityId: commentId,
                metadata: { trigger: 'offensive', auto: true, action: opts.action, blocked: !!blockedUserId },
            });
            return true;
        } catch (error) {
            // Never break the pipeline — log and let the caller fall back to flagging.
            captureError(error, 'Auto-moderation failed', {
                tags: { service: 'comment-moderation', action: 'auto-moderate' },
                extra: { commentId, workspaceId, moderationAction: opts.action },
            });
            return false;
        }
    }
}

export const commentModeration = new CommentModerationService();
