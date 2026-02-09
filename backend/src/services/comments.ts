import { db } from '../db';
import { comments, posts, pages, logs } from '../db/schema';
import { eq, desc, sql, and, gte } from 'drizzle-orm';
import { CreateCommentDTO, UpdateCommentDTO } from '../types';

export class CommentsService {
    /**
     * Create a new comment
     */
    async createComment(data: CreateCommentDTO) {
        const [newComment] = await db
            .insert(comments)
            .values({
                postId: data.postId,
                facebookCommentId: data.facebookCommentId,
                message: data.message,
                fromId: data.fromId,
                fromName: data.fromName,
                createdTime: data.createdTime,
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
    async getCommentsByUser(userId: string, options?: {
        replied?: boolean;
        replyMethod?: 'ai' | 'template' | 'manual';  // Filter by reply method
        needsAttention?: boolean;  // Filter by needsAttention flag
        limit?: number;
        cursor?: string;  // Comment ID to start after (for pagination)
    }) {
        const limit = options?.limit || 50;

        // Build base conditions
        const conditions = [eq(pages.userId, userId)];

        // Filter by replied status
        if (options?.replied !== undefined) {
            conditions.push(eq(comments.replied, options.replied));
        }

        // Filter by reply method (ai, template, manual)
        if (options?.replyMethod) {
            conditions.push(eq(comments.replyMethod, options.replyMethod));
        }

        // Filter by needsAttention flag
        if (options?.needsAttention !== undefined) {
            conditions.push(eq(comments.needsAttention, options.needsAttention));
        }

        // For cursor-based pagination, we need to get the createdAt of the cursor comment
        // and fetch comments older than that
        if (options?.cursor) {
            const cursorComment = await db
                .select({ createdAt: comments.createdAt })
                .from(comments)
                .where(eq(comments.id, options.cursor))
                .limit(1);

            if (cursorComment[0]) {
                conditions.push(sql`${comments.createdAt} < ${cursorComment[0].createdAt}`);
            }
        }

        // Fetch limit + 1 to check if there are more
        const data = await db
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
            .orderBy(desc(comments.createdAt))
            .limit(limit + 1);

        // Check if there are more results
        const hasMore = data.length > limit;
        const results = hasMore ? data.slice(0, limit) : data;
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
    async getAllCommentsByUser(userId: string, options?: { replied?: boolean }) {
        const conditions = [eq(pages.userId, userId)];

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
    async getUnrepliedComments(userId: string, limit?: number) {
        const result = await this.getCommentsByUser(userId, { replied: false, limit });
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
        aiIntent?: string
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
                repliedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(comments.id, commentId))
            .returning();

        return updatedComment;
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
     * Optimized to use SQL aggregation instead of in-memory counting
     */
    async getStats(userId: string) {
        // Get total counts joined by page -> user
        const totalResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(eq(pages.userId, userId));

        const total = Number(totalResult[0]?.count || 0);

        if (total === 0) {
            return {
                total: 0,
                replied: 0,
                unreplied: 0,
                needsAttention: 0,
                repliedToday: 0,
                replyRate: '0',
                byMethod: { template: 0, ai: 0, manual: 0 },
            };
        }

        // Get replied count
        const repliedResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(pages.userId, userId), eq(comments.replied, true)));

        const replied = Number(repliedResult[0]?.count || 0);

        // Get counts by method
        const byMethodResult = await db
            .select({
                method: comments.replyMethod,
                count: sql<number>`count(*)`,
            })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(pages.userId, userId), eq(comments.replied, true)))
            .groupBy(comments.replyMethod);

        const byMethod = {
            template: 0,
            ai: 0,
            manual: 0,
        };

        byMethodResult.forEach((row) => {
            if (row.method === 'template') byMethod.template = Number(row.count);
            else if (row.method === 'ai') byMethod.ai = Number(row.count);
            else if (row.method === 'manual') byMethod.manual = Number(row.count);
        });

        // Get needs attention count
        const needsAttentionResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(pages.userId, userId), eq(comments.needsAttention, true), eq(comments.replied, false)));

        const needsAttention = Number(needsAttentionResult[0]?.count || 0);

        // Get replied today count
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const repliedTodayResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(
                eq(pages.userId, userId),
                eq(comments.replied, true),
                gte(comments.repliedAt, todayStart)
            ));

        const repliedToday = Number(repliedTodayResult[0]?.count || 0);

        return {
            total,
            replied,
            unreplied: total - replied - needsAttention,
            needsAttention,
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

