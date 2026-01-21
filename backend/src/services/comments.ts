import { db } from '../db';
import { comments, posts, pages } from '../db/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
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
     */
    async getCommentsByUser(userId: string, options?: { replied?: boolean; limit?: number }) {
        let query = db
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
                pageName: pages.name,
            })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(eq(pages.userId, userId))
            .orderBy(desc(comments.createdAt))
            .$dynamic();

        if (options?.replied !== undefined) {
            query = query.where(eq(comments.replied, options.replied));
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        return query;
    }

    /**
     * Get unreplied comments for a user
     */
    async getUnrepliedComments(userId: string, limit?: number) {
        return this.getCommentsByUser(userId, { replied: false, limit });
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
    async markAsReplied(commentId: string, replyText: string, replyMethod: 'template' | 'ai' | 'manual', templateId?: string, replyLanguage?: string) {
        const [updatedComment] = await db
            .update(comments)
            .set({
                replied: true,
                replyText,
                replyMethod,
                templateId,
                replyLanguage,
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

        return {
            total,
            replied,
            unreplied: total - replied,
            replyRate: (replied / total * 100).toFixed(1),
            byMethod,
        };
    }
}

export const commentsService = new CommentsService();

