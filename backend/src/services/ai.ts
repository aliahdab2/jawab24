import axios from 'axios';
import crypto from 'crypto';
import { db } from '../db';
import { aiCache } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { AiGenerateRequest, AiGenerateResponse, Logger, noopLogger } from '../types';

export class AiService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Generate a hash for a comment to use as cache key
     */
    private hashComment(comment: string, language?: string): string {
        const normalized = comment.toLowerCase().trim();
        const key = `${normalized}:${language || 'auto'}`;
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    /**
     * Check cache for existing reply
     */
    async checkCache(comment: string, language?: string): Promise<string | null> {
        if (!config.ai.cacheEnabled) {
            return null;
        }

        const hash = this.hashComment(comment, language);
        
        const cached = await db
            .select()
            .from(aiCache)
            .where(eq(aiCache.commentHash, hash));

        if (cached.length > 0) {
            // Update hit count and last used
            await db
                .update(aiCache)
                .set({
                    hitCount: (cached[0].hitCount || 0) + 1,
                    lastUsedAt: new Date(),
                })
                .where(eq(aiCache.id, cached[0].id));

            return cached[0].replyText;
        }

        return null;
    }

    /**
     * Save reply to cache
     */
    async saveToCache(comment: string, reply: string, language?: string): Promise<void> {
        if (!config.ai.cacheEnabled) {
            return;
        }

        const hash = this.hashComment(comment, language);

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
        // Check cache first
        const cachedReply = await this.checkCache(request.comment, request.language);
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
            const response = await axios.post<{ reply: string; language: string }>(
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

            // Save to cache
            await this.saveToCache(request.comment, aiReply, detectedLanguage);

            return {
                reply: aiReply,
                language: detectedLanguage,
                cached: false,
                model: config.ai.model,
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
}

export const aiService = new AiService();

