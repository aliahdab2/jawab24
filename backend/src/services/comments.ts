import { db } from '../db';
import { comments, posts, pages, logs, instagramComments, instagramMedia } from '../db/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
import { CreateCommentDTO, UpdateCommentDTO } from '../types';
import { detectLanguageCode } from '../utils/language';

export class CommentsService {
    /**
     * Create a new comment
     */
    async createComment(data: CreateCommentDTO) {
        const lang = data.message ? detectLanguageCode(data.message) : 'unknown';
        const [newComment] = await db
            .insert(comments)
            .values({
                postId: data.postId,
                facebookCommentId: data.facebookCommentId,
                message: data.message,
                fromId: data.fromId,
                fromName: data.fromName,
                createdTime: data.createdTime,
                detectedLanguage: lang !== 'unknown' ? lang : null,
            })
            .returning();

        return newComment;
    }

    /**
     * Get all comments for a post
     */
    async getCommentsByPost(postId: string) {
        return db
            .select()
            .from(comments)
            .where(eq(comments.postId, postId))
            .orderBy(desc(comments.createdAt));
    }

    /**
     * Get all comments for a user (across all their pages/posts)
     * Supports cursor-based pagination for efficient infinite scroll
     * Supports server-side filtering for efficient paginated filtering
     */
    async getCommentsByWorkspace(workspaceId: string, options?: {
        replied?: boolean;
        replyMethod?: 'ai' | 'template' | 'manual';  // Filter by reply method
        needsAttention?: boolean;  // Filter by needsAttention flag
        resolved?: boolean;  // Filter by resolved status
        actionRequired?: boolean;  // Composite: (unreplied & unresolved) OR (needsAttention & unresolved)
        limit?: number;
        cursor?: string;  // Comment ID to start after (for pagination)
    }) {
        const limit = options?.limit || 50;

        // Resolve cursor timestamp once (could be FB or IG comment)
        // Both are fast PK lookups — run in parallel for lowest latency
        let cursorDate: Date | null = null;
        if (options?.cursor) {
            const [fbCursor, igCursor] = await Promise.all([
                db.select({ createdAt: comments.createdAt })
                    .from(comments).where(eq(comments.id, options.cursor)).limit(1),
                db.select({ createdAt: instagramComments.createdAt })
                    .from(instagramComments).where(eq(instagramComments.id, options.cursor)).limit(1),
            ]);
            cursorDate = fbCursor[0]?.createdAt ?? igCursor[0]?.createdAt ?? null;
        }

        // --- Facebook comments query ---
        const fbConditions = [eq(pages.workspaceId, workspaceId), eq(pages.autoReplyEnabled, true)];
        if (options?.actionRequired) {
            fbConditions.push(eq(comments.resolved, false));
            fbConditions.push(sql`(${comments.replied} = false OR ${comments.needsAttention} = true)`);
        } else {
            if (options?.replied !== undefined) fbConditions.push(eq(comments.replied, options.replied));
            if (options?.replyMethod) fbConditions.push(eq(comments.replyMethod, options.replyMethod));
            if (options?.needsAttention !== undefined) fbConditions.push(eq(comments.needsAttention, options.needsAttention));
            if (options?.resolved !== undefined) fbConditions.push(eq(comments.resolved, options.resolved));
        }
        if (cursorDate) fbConditions.push(sql`${comments.createdAt} < ${cursorDate}`);

        const fbQuery = db.select({
            id: comments.id,
            postId: comments.postId,
            facebookCommentId: comments.facebookCommentId,
            message: comments.message,
            fromId: comments.fromId,
            fromName: comments.fromName,
            replied: comments.replied,
            replyText: comments.replyText,
            replyMethod: comments.replyMethod,
            detectedLanguage: comments.detectedLanguage,
            createdTime: comments.createdTime,
            repliedAt: comments.repliedAt,
            createdAt: comments.createdAt,
            postMessage: posts.message,
            postPermalink: posts.facebookPostId,
            pageId: pages.id,
            pageName: pages.name,
            needsAttention: comments.needsAttention,
            flagReason: comments.flagReason,
            aiIntent: comments.aiIntent,
            aiOriginalReply: comments.aiOriginalReply,
            resolved: comments.resolved,
            source: sql<string>`'facebook'`.as('source'),
        })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(...fbConditions))
            .orderBy(desc(comments.createdAt))
            .limit(limit + 1);

        // --- Instagram comments query ---
        const igConditions = [eq(pages.workspaceId, workspaceId), eq(pages.instagramAutoReplyEnabled, true)];
        if (options?.actionRequired) {
            igConditions.push(eq(instagramComments.resolved, false));
            igConditions.push(sql`(${instagramComments.replied} = false OR ${instagramComments.needsAttention} = true)`);
        } else {
            if (options?.replied !== undefined) igConditions.push(eq(instagramComments.replied, options.replied));
            if (options?.replyMethod) igConditions.push(eq(instagramComments.replyMethod, options.replyMethod));
            if (options?.needsAttention !== undefined) igConditions.push(eq(instagramComments.needsAttention, options.needsAttention));
            if (options?.resolved !== undefined) igConditions.push(eq(instagramComments.resolved, options.resolved));
        }
        if (cursorDate) igConditions.push(sql`${instagramComments.createdAt} < ${cursorDate}`);

        const igQuery = db.select({
            id: instagramComments.id,
            postId: instagramMedia.id,
            facebookCommentId: instagramComments.instagramCommentId,
            message: instagramComments.message,
            fromId: instagramComments.fromId,
            fromName: instagramComments.fromUsername,
            replied: instagramComments.replied,
            replyText: instagramComments.replyText,
            replyMethod: instagramComments.replyMethod,
            detectedLanguage: instagramComments.detectedLanguage,
            createdTime: instagramComments.createdTime,
            repliedAt: instagramComments.repliedAt,
            createdAt: instagramComments.createdAt,
            postMessage: instagramMedia.caption,
            postPermalink: instagramMedia.permalink,
            pageId: pages.id,
            pageName: pages.name,
            needsAttention: instagramComments.needsAttention,
            flagReason: instagramComments.flagReason,
            aiIntent: instagramComments.aiIntent,
            aiOriginalReply: instagramComments.aiOriginalReply,
            resolved: instagramComments.resolved,
            source: sql<string>`'instagram'`.as('source'),
        })
            .from(instagramComments)
            .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
            .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
            .where(and(...igConditions))
            .orderBy(desc(instagramComments.createdAt))
            .limit(limit + 1);

        // Run both queries in parallel
        const [fbData, igData] = await Promise.all([fbQuery, igQuery]);

        // Merge, sort by createdAt desc, take limit+1
        const merged = [...fbData, ...igData]
            .sort((a, b) => {
                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return dateB - dateA;
            });

        const hasMore = merged.length > limit;
        const results = merged.slice(0, limit);
        const nextCursor = hasMore && results.length > 0 ? results[results.length - 1].id : null;

        return {
            data: results,
            pagination: {
                hasMore,
                nextCursor,
                limit,
            }
        };
    }

    /**
     * Get all comments for a user without pagination (for backwards compatibility)
     * @deprecated Use getCommentsByUser with pagination instead
     */
    async getAllCommentsByWorkspace(workspaceId: string, options?: { replied?: boolean }) {
        const conditions = [eq(pages.workspaceId, workspaceId)];

        if (options?.replied !== undefined) {
            conditions.push(eq(comments.replied, options.replied));
        }

        return db
            .select({
                id: comments.id,
                postId: comments.postId,
                facebookCommentId: comments.facebookCommentId,
                message: comments.message,
                fromId: comments.fromId,
                fromName: comments.fromName,
                replied: comments.replied,
                replyText: comments.replyText,
                replyMethod: comments.replyMethod,
                detectedLanguage: comments.detectedLanguage,
                createdTime: comments.createdTime,
                repliedAt: comments.repliedAt,
                createdAt: comments.createdAt,
                postMessage: posts.message,
                postPermalink: posts.facebookPostId,
                pageId: pages.id,
                pageName: pages.name,
                needsAttention: comments.needsAttention,
                flagReason: comments.flagReason,
                aiIntent: comments.aiIntent,
            })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(...conditions))
            .orderBy(desc(comments.createdAt));
    }

    /**
     * Get unreplied comments for a user
     * Returns array directly for backwards compatibility
     */
    async getUnrepliedComments(workspaceId: string, limit?: number) {
        const result = await this.getCommentsByWorkspace(workspaceId, { replied: false, limit });
        return result.data;
    }

    /**
     * Get a single comment by ID
     */
    async getComment(commentId: string) {
        const result = await db
            .select()
            .from(comments)
            .where(eq(comments.id, commentId));

        return result[0] || null;
    }

    /**
     * Get a comment (Facebook or Instagram), verifying it belongs to the given workspace.
     * Used to enforce workspace isolation on single-comment endpoints.
     * Returns null if the comment does not exist or belongs to a different workspace.
     */
    async getCommentForWorkspace(commentId: string, workspaceId: string) {
        // Try Facebook comments first (comments → posts → pages)
        const fbResult = await db
            .select({ comment: comments })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(comments.id, commentId), eq(pages.workspaceId, workspaceId)));

        if (fbResult[0]) return fbResult[0].comment;

        // Try Instagram comments (instagramComments → instagramMedia → pages)
        const igResult = await db
            .select({ comment: instagramComments })
            .from(instagramComments)
            .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
            .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
            .where(and(eq(instagramComments.id, commentId), eq(pages.workspaceId, workspaceId)));

        return igResult[0]?.comment || null;
    }

    /**
     * Get comment by Facebook Comment ID
     */
    async getCommentByFacebookId(facebookCommentId: string) {
        const result = await db
            .select()
            .from(comments)
            .where(eq(comments.facebookCommentId, facebookCommentId));
        
        return result[0] || null;
    }

    /**
     * Update a comment
     */
    async updateComment(commentId: string, data: UpdateCommentDTO) {
        const [updatedComment] = await db
            .update(comments)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(comments.id, commentId))
            .returning();
        
        return updatedComment;
    }

    /**
     * Mark comment as replied
     */
    async markAsReplied(
        commentId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        templateId?: string,
        replyLanguage?: string,
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
    ) {
        const [updatedComment] = await db
            .update(comments)
            .set({
                replied: true,
                replyText,
                replyMethod,
                templateId,
                replyLanguage,
                needsAttention: needsAttention ?? false,
                flagReason: flagReason ?? null,
                aiIntent: aiIntent ?? null,
                aiOriginalReply: aiOriginalReply ?? null,
                repliedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(comments.id, commentId))
            .returning();

        return updatedComment;
    }

    /**
     * Resolve a comment (mark as handled without replying).
     * Tries Facebook comments first, then Instagram comments.
     */
    async resolveComment(commentId: string) {
        const [fbUpdated] = await db
            .update(comments)
            .set({ resolved: true, updatedAt: new Date() })
            .where(eq(comments.id, commentId))
            .returning();
        if (fbUpdated) return fbUpdated;

        const [igUpdated] = await db
            .update(instagramComments)
            .set({ resolved: true, updatedAt: new Date() })
            .where(eq(instagramComments.id, commentId))
            .returning();
        return igUpdated;
    }

    /**
     * Unresolve a comment (reopen for action).
     * Tries Facebook comments first, then Instagram comments.
     */
    async unresolveComment(commentId: string) {
        const [fbUpdated] = await db
            .update(comments)
            .set({ resolved: false, updatedAt: new Date() })
            .where(eq(comments.id, commentId))
            .returning();
        if (fbUpdated) return fbUpdated;

        const [igUpdated] = await db
            .update(instagramComments)
            .set({ resolved: false, updatedAt: new Date() })
            .where(eq(instagramComments.id, commentId))
            .returning();
        return igUpdated;
    }

    /**
     * Delete a comment
     */
    async deleteComment(commentId: string) {
        await db
            .delete(comments)
            .where(eq(comments.id, commentId));
    }

    /**
     * Find or create comment from Facebook webhook
     */
    async findOrCreateFromWebhook(postId: string, facebookCommentId: string, message: string, fromId?: string, fromName?: string) {
        const existing = await this.getCommentByFacebookId(facebookCommentId);
        
        if (existing) {
            return { comment: existing, isNew: false };
        }

        const newComment = await this.createComment({
            postId,
            facebookCommentId,
            message,
            fromId,
            fromName,
        });

        return { comment: newComment, isNew: true };
    }

    /**
     * Get comment statistics for a user
     * Uses PostgreSQL FILTER (WHERE ...) to get all counts in a single query per table
     */
    async getStats(workspaceId: string) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 2 queries (FB + IG) instead of 10, run in parallel
        const [fbStats, igStats] = await Promise.all([
            // Facebook comments — single query with FILTER
            db.select({
                total:          sql<number>`count(*)`,
                replied:        sql<number>`count(*) FILTER (WHERE ${comments.replied} = true)`,
                needsAttention: sql<number>`count(*) FILTER (WHERE ${comments.needsAttention} = true AND ${comments.resolved} = false)`,
                resolved:       sql<number>`count(*) FILTER (WHERE ${comments.resolved} = true)`,
                actionRequired: sql<number>`count(*) FILTER (WHERE ${comments.resolved} = false AND (${comments.replied} = false OR ${comments.needsAttention} = true))`,
                repliedToday:   sql<number>`count(*) FILTER (WHERE ${comments.replied} = true AND ${comments.repliedAt} >= ${todayStart})`,
                ai:             sql<number>`count(*) FILTER (WHERE ${comments.replied} = true AND ${comments.replyMethod} = 'ai')`,
                template:       sql<number>`count(*) FILTER (WHERE ${comments.replied} = true AND ${comments.replyMethod} = 'template')`,
                manual:         sql<number>`count(*) FILTER (WHERE ${comments.replied} = true AND ${comments.replyMethod} = 'manual')`,
            })
                .from(comments)
                .innerJoin(posts, eq(comments.postId, posts.id))
                .innerJoin(pages, eq(posts.pageId, pages.id))
                .where(and(eq(pages.workspaceId, workspaceId), eq(pages.autoReplyEnabled, true))),

            // Instagram comments — single query with FILTER
            db.select({
                total:          sql<number>`count(*)`,
                replied:        sql<number>`count(*) FILTER (WHERE ${instagramComments.replied} = true)`,
                needsAttention: sql<number>`count(*) FILTER (WHERE ${instagramComments.needsAttention} = true AND ${instagramComments.resolved} = false)`,
                resolved:       sql<number>`count(*) FILTER (WHERE ${instagramComments.resolved} = true)`,
                actionRequired: sql<number>`count(*) FILTER (WHERE ${instagramComments.resolved} = false AND (${instagramComments.replied} = false OR ${instagramComments.needsAttention} = true))`,
                repliedToday:   sql<number>`count(*) FILTER (WHERE ${instagramComments.replied} = true AND ${instagramComments.repliedAt} >= ${todayStart})`,
                ai:             sql<number>`count(*) FILTER (WHERE ${instagramComments.replied} = true AND ${instagramComments.replyMethod} = 'ai')`,
                template:       sql<number>`count(*) FILTER (WHERE ${instagramComments.replied} = true AND ${instagramComments.replyMethod} = 'template')`,
                manual:         sql<number>`count(*) FILTER (WHERE ${instagramComments.replied} = true AND ${instagramComments.replyMethod} = 'manual')`,
            })
                .from(instagramComments)
                .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
                .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
                .where(and(eq(pages.workspaceId, workspaceId), eq(pages.instagramAutoReplyEnabled, true))),
        ]);

        const fb = fbStats[0];
        const ig = igStats[0];

        const total = Number(fb?.total || 0) + Number(ig?.total || 0);

        if (total === 0) {
            return {
                total: 0, replied: 0, unreplied: 0, needsAttention: 0, actionRequired: 0,
                resolved: 0, repliedToday: 0, replyRate: '0',
                byMethod: { template: 0, ai: 0, manual: 0 },
            };
        }

        const replied = Number(fb?.replied || 0) + Number(ig?.replied || 0);
        const needsAttention = Number(fb?.needsAttention || 0) + Number(ig?.needsAttention || 0);
        const actionRequired = Number(fb?.actionRequired || 0) + Number(ig?.actionRequired || 0);
        const resolved = Number(fb?.resolved || 0) + Number(ig?.resolved || 0);
        const repliedToday = Number(fb?.repliedToday || 0) + Number(ig?.repliedToday || 0);

        const byMethod = {
            template: Number(fb?.template || 0) + Number(ig?.template || 0),
            ai:       Number(fb?.ai || 0)       + Number(ig?.ai || 0),
            manual:   Number(fb?.manual || 0)   + Number(ig?.manual || 0),
        };

        // unreplied excludes resolved comments (they don't need action)
        const unreplied = total - replied - resolved;

        return {
            total,
            replied,
            unreplied: Math.max(0, unreplied),
            needsAttention,
            actionRequired,
            resolved,
            repliedToday,
            replyRate: (replied / total * 100).toFixed(1),
            byMethod,
        };
    }
    /**
     * Log feedback for a reply
     */
    async logFeedback(commentId: string, userId: string, helpful: boolean, reason?: string) {
        // Get comment details for context
        const comment = await this.getComment(commentId);
        
        if (!comment) {
            throw new Error('Comment not found');
        }

        const [log] = await db
            .insert(logs)
            .values({
                userId,
                commentId,
                action: helpful ? 'feedback_like' : 'feedback_dislike',
                status: 'success',
                message: reason || (helpful ? 'User found reply helpful' : 'User found reply unhelpful'),
                metadata: {
                    replyMethod: comment.replyMethod,
                    replyText: comment.replyText,
                    helpful,
                    reason
                }
            })
            .returning();
            
        return log;
    }
}

export const commentsService = new CommentsService();

