import axios from 'axios';
import crypto from 'crypto';
import { db } from '../db';
import { aiCache } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { AiGenerateRequest, AiGenerateResponse, Logger, noopLogger } from '../types';
import { redis } from '../lib/redis';

export class AiService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Generate a hash for a comment to use as cache key
     * Includes pageId to prevent cross-page cache collisions
     */
    private hashComment(comment: string, language?: string, pageId?: string): string {
        // Remove punctuation, emojis, and extra whitespace to increase cache hits
        const normalized = comment
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, '') // Keep letters, numbers, whitespace
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim();

        const key = `${normalized}:${language || 'auto'}:${pageId || 'global'}`;
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    /**
     * Check cache for existing reply
     */
    async checkCache(comment: string, language?: string, pageId?: string): Promise<string | null> {
        if (!config.ai.cacheEnabled) {
            return null;
        }

        const hash = this.hashComment(comment, language, pageId);
        const cacheKey = `cache:ai_reply:${hash}`;

        try {
            // Try Redis first (fast path)
            const cachedReply = await redis.get(cacheKey);
            if (cachedReply) {
                // Determine if we need to extend TTL
                // Redis GET doesn't update TTL automatically, but for now we accept it.
                // Optionally we could run redis.expire(cacheKey, 30 * 24 * 60 * 60);
                return cachedReply;
            }
        } catch (error) {
            this.logger.error('Redis cache error', { error });
            // Fallback to DB or return null is handled by continuing
        }

        // Fallback to Postgres (slow path / persistent)
        const cached = await db
            .select()
            .from(aiCache)
            .where(eq(aiCache.commentHash, hash));

        if (cached.length > 0) {
            const reply = cached[0].replyText;

            // Populate Redis for next time
            try {
                await redis.set(cacheKey, reply, 'EX', 30 * 24 * 60 * 60); // 30 days
            } catch {
                // Ignore redis set error
            }

            // Update DB hit count
            await db
                .update(aiCache)
                .set({
                    hitCount: (cached[0].hitCount || 0) + 1,
                    lastUsedAt: new Date(),
                })
                .where(eq(aiCache.id, cached[0].id));

            return reply;
        }

        return null;
    }

    /**
     * Save reply to cache
     */
    async saveToCache(comment: string, reply: string, language?: string, pageId?: string): Promise<void> {
        if (!config.ai.cacheEnabled) {
            return;
        }

        const hash = this.hashComment(comment, language, pageId);
        const cacheKey = `cache:ai_reply:${hash}`;

        // Save to Redis (30 days TTL)
        try {
            await redis.set(cacheKey, reply, 'EX', 30 * 24 * 60 * 60);
        } catch (error) {
            this.logger.error('Failed to save to Redis', { error });
        }

        // Save to Postgres (Persistent)
        await db
            .insert(aiCache)
            .values({
                commentHash: hash,
                replyText: reply,
                language: language || null,
            })
            .onConflictDoUpdate({
                target: aiCache.commentHash,
                set: {
                    replyText: reply,
                    hitCount: 1,
                    lastUsedAt: new Date(),
                },
            });
    }

    /**
     * Generate AI reply for a comment
     */
    async generateReply(request: AiGenerateRequest): Promise<AiGenerateResponse> {
        const pageId = request.context?.pageId;

        // Check cache first (scoped per page to avoid cross-page collisions)
        const cachedReply = await this.checkCache(request.comment, request.language, pageId);
        if (cachedReply) {
            return {
                reply: cachedReply,
                language: request.language || 'auto',
                cached: true,
            };
        }

        // If AI is disabled, return a default message
        if (!config.ai.enabled) {
            return {
                reply: 'Thank you for your comment! We will get back to you soon.',
                language: request.language || 'en',
                cached: false,
                model: 'disabled',
            };
        }

        try {
            // Call AI Worker service
            const response = await axios.post<{
                reply: string;
                language: string;
                intent?: string;
                confidence?: string;
                flags?: string[];
            }>(
                `${config.ai.serviceUrl}/generate`,
                {
                    comment: request.comment,
                    language: request.language,
                    context: request.context,
                },
                {
                    timeout: 30000, // 30 second timeout
                }
            );

            const aiReply = response.data.reply;
            const detectedLanguage = response.data.language || request.language || 'en';

            // Save to cache (scoped per page)
            await this.saveToCache(request.comment, aiReply, detectedLanguage, pageId);

            return {
                reply: aiReply,
                language: detectedLanguage,
                cached: false,
                model: config.ai.model,
                intent: response.data.intent,
                confidence: response.data.confidence,
                flags: response.data.flags,
            };
        } catch (error) {
            this.logger.error('AI Service error', {
                error: error instanceof Error ? error.message : String(error)
            });

            // Return fallback response
            return {
                reply: 'Thank you for your comment!',
                language: request.language || 'en',
                cached: false,
                model: 'fallback',
            };
        }
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{ totalEntries: number; totalHits: number }> {
        const entries = await db.select().from(aiCache);

        const totalHits = entries.reduce((sum, entry) => sum + (entry.hitCount || 0), 0);

        return {
            totalEntries: entries.length,
            totalHits,
        };
    }

    /**
     * Clear cache (admin function)
     */
    async clearCache(): Promise<void> {
        await db.delete(aiCache);
    }
    async enqueueReply(request: AiGenerateRequest): Promise<{ jobId: string; status: string }> {
        const { aiQueue } = await import('../lib/queue');

        const job = await aiQueue.add('generate-reply', {
            comment: request.comment,
            language: request.language,
            context: request.context,
            type: 'reply'
        });

        return {
            jobId: job.id || 'unknown',
            status: 'queued'
        };
    }

    /**
     * Get the status of an async AI generation job
     */
    async getJobStatus(jobId: string): Promise<{ 
        jobId: string; 
        status: 'queued' | 'active' | 'completed' | 'failed' | 'not_found';
        result?: { reply: string };
        error?: string;
    }> {
        const { aiQueue } = await import('../lib/queue');
        
        const job = await aiQueue.getJob(jobId);
        
        if (!job) {
            return { jobId, status: 'not_found' };
        }

        const state = await job.getState();
        
        if (state === 'completed') {
            const returnValue = job.returnvalue as { reply: string } | undefined;
            return {
                jobId,
                status: 'completed',
                result: returnValue
            };
        }
        
        if (state === 'failed') {
            return {
                jobId,
                status: 'failed',
                error: job.failedReason || 'Unknown error'
            };
        }
        
        if (state === 'active') {
            return { jobId, status: 'active' };
        }
        
        // waiting, delayed, etc. -> treat as queued
        return { jobId, status: 'queued' };
    }
}

export const aiService = new AiService();

