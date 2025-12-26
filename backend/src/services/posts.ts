import { db } from '../db';
import { posts, pages } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { CreatePostDTO, UpdatePostDTO } from '../types';
import { facebookService } from './facebook';

export class PostsService {
    /**
     * Create a new post
     */
    async createPost(data: CreatePostDTO) {
        const [newPost] = await db
            .insert(posts)
            .values({
                pageId: data.pageId,
                facebookPostId: data.facebookPostId,
                message: data.message,
                autoReplyEnabled: data.autoReplyEnabled ?? true,
                createdTime: data.createdTime,
            })
            .returning();
        
        return newPost;
    }

    /**
     * Get all posts for a page
     */
    async getPostsByPage(pageId: string) {
        return await db
            .select()
            .from(posts)
            .where(eq(posts.pageId, pageId))
            .orderBy(desc(posts.createdAt));
    }

    /**
     * Get all posts for a user (across all their pages)
     */
    async getPostsByUser(userId: string) {
        return await db
            .select({
                id: posts.id,
                pageId: posts.pageId,
                facebookPostId: posts.facebookPostId,
                message: posts.message,
                autoReplyEnabled: posts.autoReplyEnabled,
                createdTime: posts.createdTime,
                createdAt: posts.createdAt,
                updatedAt: posts.updatedAt,
                pageName: pages.name,
            })
            .from(posts)
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(eq(pages.userId, userId))
            .orderBy(desc(posts.createdAt));
    }

    /**
     * Get a single post by ID
     */
    async getPost(postId: string) {
        const result = await db
            .select()
            .from(posts)
            .where(eq(posts.id, postId));
        
        return result[0] || null;
    }

    /**
     * Get post by Facebook Post ID
     */
    async getPostByFacebookId(facebookPostId: string) {
        const result = await db
            .select()
            .from(posts)
            .where(eq(posts.facebookPostId, facebookPostId));
        
        return result[0] || null;
    }

    /**
     * Update a post
     */
    async updatePost(postId: string, data: UpdatePostDTO) {
        const [updatedPost] = await db
            .update(posts)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(posts.id, postId))
            .returning();
        
        return updatedPost;
    }

    /**
     * Delete a post
     */
    async deletePost(postId: string) {
        await db
            .delete(posts)
            .where(eq(posts.id, postId));
    }

    /**
     * Toggle auto-reply for a post
     */
    async toggleAutoReply(postId: string, enabled: boolean) {
        const [updatedPost] = await db
            .update(posts)
            .set({
                autoReplyEnabled: enabled,
                updatedAt: new Date(),
            })
            .where(eq(posts.id, postId))
            .returning();
        
        return updatedPost;
    }

    /**
     * Find or create post from Facebook webhook
     * Automatically fetches post content from Facebook if not provided
     */
    async findOrCreateFromWebhook(pageId: string, facebookPostId: string, message?: string, pageAccessToken?: string) {
        const existing = await this.getPostByFacebookId(facebookPostId);
        
        if (existing) {
            // If we have the post but no message, try to fetch it
            if (!existing.message && pageAccessToken) {
                const postContent = await facebookService.getPostContent(facebookPostId, pageAccessToken);
                if (postContent) {
                    console.log(`[Posts] Updating post ${facebookPostId} with fetched content`);
                    return await this.updatePost(existing.id, { message: postContent });
                }
            }
            return existing;
        }

        // Try to fetch post content from Facebook if not provided
        let postMessage = message;
        if (!postMessage && pageAccessToken) {
            console.log(`[Posts] Fetching content for new post ${facebookPostId}`);
            postMessage = await facebookService.getPostContent(facebookPostId, pageAccessToken) || undefined;
        }

        return await this.createPost({
            pageId,
            facebookPostId,
            message: postMessage,
        });
    }
}

export const postsService = new PostsService();

