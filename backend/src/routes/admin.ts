import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users, subscriptions, plans, adminAuditLogs, pages, usage, kbChunks, kbGaps } from '../db/schema';
import { eq, ilike, desc, and, gte, lte, sql } from 'drizzle-orm';
import { auth } from '../utils/swagger';
import { config } from '../config';
import { aiService } from '../services/ai';
import { rulesService } from '../services/rules';
import { templatesService } from '../services/templates';
import { RetrievalService } from '../services/kb/retrieval';
import { OpenAIEmbeddingProvider } from '../services/kb/embedding';
import { gapDetectorService } from '../services/kb/gap-detector';
import { settingsService } from '../services/settings';
import { shouldSkipReply, shouldUseFallback, PRICE_FALLBACK } from '../services/reply/generator';
import { RetrievedChunkContext } from '../types';

// Request body types
interface ManualUpgradeBody {
    planId: string;
    periodMonths: 1 | 3 | 6 | 12;
    paymentMethod: 'manual' | 'bank_transfer' | 'syrian_bank';
    paymentReference?: string;
    note?: string;
}

interface SearchUsersQuery {
    email?: string;
}

interface ListAllUsersQuery {
    page?: string;
    limit?: string;
    status?: string;
    plan?: string;
    search?: string;
}

/**
 * Admin Routes - Protected endpoints for manual subscription management
 * All routes require authentication + admin privileges
 */
export default async function adminRoutes(fastify: FastifyInstance) {
    // Apply authentication + admin check to all routes
    fastify.register(async (adminProtected) => {
        adminProtected.addHook('preHandler', authenticate);
        adminProtected.addHook('preHandler', requireAdmin);

        /**
         * GET /admin/users/all - List all users with pagination and filters
         * Query: ?page=1&limit=20&status=active&plan=pro&search=email
         */
        adminProtected.get<{ Querystring: ListAllUsersQuery }>(
            '/users/all',
            { schema: { tags: ['Admin'], summary: 'List all users with pagination and filters', security: auth } },
            async (request: FastifyRequest<{ Querystring: ListAllUsersQuery }>, reply: FastifyReply) => {
                const { 
                    page = '1', 
                    limit = '20', 
                    status, 
                    plan: planSlug, 
                    search 
                } = request.query;

                const pageNum = Math.max(1, parseInt(page, 10) || 1);
                const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
                const offset = (pageNum - 1) * limitNum;

                try {
                    // Build base query with subscriptions join
                    // We'll filter in memory for simplicity with the current schema
                    const baseQuery = db
                        .select({
                            id: users.id,
                            email: users.email,
                            name: users.name,
                            facebookId: users.facebookId,
                            createdAt: users.createdAt,
                            subscriptionId: subscriptions.id,
                            subscriptionStatus: subscriptions.status,
                            planId: subscriptions.planId,
                            planName: plans.name,
                            planSlug: plans.slug,
                            currentPeriodStart: subscriptions.currentPeriodStart,
                            currentPeriodEnd: subscriptions.currentPeriodEnd,
                            paymentMethod: subscriptions.paymentMethod,
                        })
                        .from(users)
                        .leftJoin(subscriptions, eq(users.id, subscriptions.userId))
                        .leftJoin(plans, eq(subscriptions.planId, plans.id))
                        .orderBy(desc(users.createdAt));

                    // Get all users first (we'll filter and paginate)
                    let allUsers = await baseQuery;

                    // Apply filters
                    if (search && search.trim().length > 0) {
                        const searchLower = search.trim().toLowerCase();
                        allUsers = allUsers.filter(u => 
                            u.email?.toLowerCase().includes(searchLower) ||
                            u.name?.toLowerCase().includes(searchLower)
                        );
                    }

                    if (status) {
                        allUsers = allUsers.filter(u => u.subscriptionStatus === status);
                    }

                    if (planSlug) {
                        allUsers = allUsers.filter(u => u.planSlug === planSlug);
                    }

                    // Get total count after filters
                    const totalCount = allUsers.length;

                    // Apply pagination
                    const paginatedUsers = allUsers.slice(offset, offset + limitNum);

                    // Transform to response format
                    const responseData = paginatedUsers.map(u => ({
                        id: u.id,
                        email: u.email,
                        name: u.name,
                        facebookId: u.facebookId,
                        createdAt: u.createdAt,
                        subscription: u.subscriptionId ? {
                            id: u.subscriptionId,
                            status: u.subscriptionStatus,
                            planId: u.planId,
                            planName: u.planName,
                            planSlug: u.planSlug,
                            currentPeriodStart: u.currentPeriodStart,
                            currentPeriodEnd: u.currentPeriodEnd,
                            paymentMethod: u.paymentMethod,
                        } : null,
                    }));

                    return reply.send({
                        success: true,
                        data: responseData,
                        pagination: {
                            page: pageNum,
                            limit: limitNum,
                            total: totalCount,
                            totalPages: Math.ceil(totalCount / limitNum),
                        },
                    });
                } catch (error) {
                    request.log.error(error, 'Admin list all users failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to list users',
                    });
                }
            }
        );

        /**
         * GET /admin/users - Search users by email
         * Query: ?email=user@example.com
         */
        adminProtected.get<{ Querystring: SearchUsersQuery }>(
            '/users',
            { schema: { tags: ['Admin'], summary: 'Search users by email', security: auth } },
            async (request: FastifyRequest<{ Querystring: SearchUsersQuery }>, reply: FastifyReply) => {
                const { email } = request.query;

                if (!email || email.trim().length < 3) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Email query required (min 3 characters)',
                    });
                }

                try {
                    // Search users by email (case-insensitive partial match)
                    const foundUsers = await db
                        .select({
                            id: users.id,
                            email: users.email,
                            name: users.name,
                            facebookId: users.facebookId,
                            createdAt: users.createdAt,
                        })
                        .from(users)
                        .where(ilike(users.email, `%${email.trim()}%`))
                        .limit(20);

                    // For each user, get their current subscription
                    const usersWithSubscriptions = await Promise.all(
                        foundUsers.map(async (user) => {
                            const [subscription] = await db
                                .select({
                                    id: subscriptions.id,
                                    status: subscriptions.status,
                                    planId: subscriptions.planId,
                                    planName: plans.name,
                                    planSlug: plans.slug,
                                    currentPeriodStart: subscriptions.currentPeriodStart,
                                    currentPeriodEnd: subscriptions.currentPeriodEnd,
                                    paymentMethod: subscriptions.paymentMethod,
                                })
                                .from(subscriptions)
                                .leftJoin(plans, eq(subscriptions.planId, plans.id))
                                .where(eq(subscriptions.userId, user.id))
                                .limit(1);

                            return {
                                ...user,
                                subscription: subscription || null,
                            };
                        })
                    );

                    return reply.send({
                        success: true,
                        data: usersWithSubscriptions,
                        count: usersWithSubscriptions.length,
                    });
                } catch (error) {
                    request.log.error(error, 'Admin user search failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to search users',
                    });
                }
            }
        );

        /**
         * GET /admin/users/:userId - Get single user details with pages and usage
         */
        adminProtected.get<{ Params: { userId: string } }>(
            '/users/:userId',
            { schema: { tags: ['Admin'], summary: 'Get single user details with pages and usage', security: auth, params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] } } },
            async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
                const { userId } = request.params;

                try {
                    const [user] = await db
                        .select({
                            id: users.id,
                            email: users.email,
                            name: users.name,
                            facebookId: users.facebookId,
                            createdAt: users.createdAt,
                        })
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);

                    if (!user) {
                        return reply.status(404).send({
                            success: false,
                            error: 'User not found',
                        });
                    }

                    // Get subscription with plan limits
                    const [subscription] = await db
                        .select({
                            id: subscriptions.id,
                            status: subscriptions.status,
                            planId: subscriptions.planId,
                            planName: plans.name,
                            planSlug: plans.slug,
                            currentPeriodStart: subscriptions.currentPeriodStart,
                            currentPeriodEnd: subscriptions.currentPeriodEnd,
                            paymentMethod: subscriptions.paymentMethod,
                            trialEndsAt: subscriptions.trialEndsAt,
                            maxAiRepliesPerMonth: plans.maxAiRepliesPerMonth,
                            maxPages: plans.maxPages,
                        })
                        .from(subscriptions)
                        .leftJoin(plans, eq(subscriptions.planId, plans.id))
                        .where(eq(subscriptions.userId, userId))
                        .limit(1);

                    // Get pages count
                    const userPages = await db
                        .select({ id: pages.id })
                        .from(pages)
                        .where(eq(pages.userId, userId));
                    const pagesCount = userPages.length;

                    // Get current period usage
                    const now = new Date();
                    const [currentUsage] = await db
                        .select({
                            aiRepliesCount: usage.aiRepliesCount,
                            templateRepliesCount: usage.templateRepliesCount,
                            periodStart: usage.periodStart,
                            periodEnd: usage.periodEnd,
                        })
                        .from(usage)
                        .where(
                            and(
                                eq(usage.userId, userId),
                                lte(usage.periodStart, now),
                                gte(usage.periodEnd, now)
                            )
                        )
                        .limit(1);

                    return reply.send({
                        success: true,
                        data: {
                            ...user,
                            subscription: subscription || null,
                            pagesCount,
                            usage: currentUsage ? {
                                aiRepliesCount: currentUsage.aiRepliesCount || 0,
                                templateRepliesCount: currentUsage.templateRepliesCount || 0,
                                periodStart: currentUsage.periodStart,
                                periodEnd: currentUsage.periodEnd,
                                limit: subscription?.maxAiRepliesPerMonth || null,
                            } : {
                                aiRepliesCount: 0,
                                templateRepliesCount: 0,
                                periodStart: null,
                                periodEnd: null,
                                limit: subscription?.maxAiRepliesPerMonth || null,
                            },
                        },
                    });
                } catch (error) {
                    request.log.error(error, 'Admin get user failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to get user',
                    });
                }
            }
        );

        /**
         * POST /admin/users/:userId/upgrade - Manual subscription upgrade
         * Body: { planId, periodMonths, paymentMethod, paymentReference?, note? }
         */
        adminProtected.post<{ Params: { userId: string }; Body: ManualUpgradeBody }>(
            '/users/:userId/upgrade',
            { schema: { tags: ['Admin'], summary: 'Manual subscription upgrade for a user', security: auth, params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] } } },
            async (
                request: FastifyRequest<{ Params: { userId: string }; Body: ManualUpgradeBody }>,
                reply: FastifyReply
            ) => {
                const { userId } = request.params;
                const { planId, periodMonths, paymentMethod, paymentReference, note } = request.body;
                const adminUserId = (request as AuthenticatedRequest).user?.userId;

                // Validate required fields
                if (!planId || !periodMonths || !paymentMethod) {
                    return reply.status(400).send({
                        success: false,
                        error: 'planId, periodMonths, and paymentMethod are required',
                    });
                }

                // Validate periodMonths
                if (![1, 3, 6, 12].includes(periodMonths)) {
                    return reply.status(400).send({
                        success: false,
                        error: 'periodMonths must be 1, 3, 6, or 12',
                    });
                }

                try {
                    // Verify user exists
                    const [user] = await db
                        .select({ id: users.id, email: users.email })
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);

                    if (!user) {
                        return reply.status(404).send({
                            success: false,
                            error: 'User not found',
                        });
                    }

                    // Verify plan exists
                    const [plan] = await db
                        .select({ id: plans.id, name: plans.name, slug: plans.slug })
                        .from(plans)
                        .where(eq(plans.id, planId))
                        .limit(1);

                    if (!plan) {
                        return reply.status(404).send({
                            success: false,
                            error: 'Plan not found',
                        });
                    }

                    // Get existing subscription for audit log
                    const [existingSubscription] = await db
                        .select()
                        .from(subscriptions)
                        .where(eq(subscriptions.userId, userId))
                        .limit(1);

                    // Calculate period dates
                    const now = new Date();
                    const periodEnd = new Date(now);
                    periodEnd.setMonth(periodEnd.getMonth() + periodMonths);

                    // Create or update subscription
                    let newSubscription;
                    if (existingSubscription) {
                        // Update existing subscription
                        [newSubscription] = await db
                            .update(subscriptions)
                            .set({
                                planId,
                                status: 'active',
                                paymentMethod,
                                currentPeriodStart: now,
                                currentPeriodEnd: periodEnd,
                                trialEndsAt: null, // Clear any trial
                                canceledAt: null,
                                cancelReason: null,
                                cancelAtPeriodEnd: false,
                                updatedAt: now,
                            })
                            .where(eq(subscriptions.id, existingSubscription.id))
                            .returning();
                    } else {
                        // Create new subscription
                        [newSubscription] = await db
                            .insert(subscriptions)
                            .values({
                                userId,
                                planId,
                                status: 'active',
                                paymentMethod,
                                currentPeriodStart: now,
                                currentPeriodEnd: periodEnd,
                            })
                            .returning();
                    }

                    // Create audit log
                    await db.insert(adminAuditLogs).values({
                        adminUserId,
                        targetUserId: userId,
                        action: 'manual_upgrade',
                        previousValue: existingSubscription
                            ? {
                                  planId: existingSubscription.planId,
                                  status: existingSubscription.status,
                                  periodEnd: existingSubscription.currentPeriodEnd,
                                  paymentMethod: existingSubscription.paymentMethod,
                              }
                            : null,
                        newValue: {
                            planId,
                            planName: plan.name,
                            status: 'active',
                            periodMonths,
                            periodEnd: periodEnd.toISOString(),
                            paymentMethod,
                        },
                        paymentReference,
                        note,
                    });

                    request.log.info(
                        {
                            adminUserId,
                            targetUserId: userId,
                            planId,
                            periodMonths,
                            paymentMethod,
                            paymentReference,
                        },
                        'Manual subscription upgrade completed'
                    );

                    return reply.send({
                        success: true,
                        message: `User upgraded to ${plan.name} for ${periodMonths} month(s)`,
                        data: {
                            subscription: newSubscription,
                            plan,
                            periodEnd: periodEnd.toISOString(),
                        },
                    });
                } catch (error) {
                    request.log.error(error, 'Admin manual upgrade failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to upgrade user',
                    });
                }
            }
        );

        /**
         * GET /admin/plans - List all plans (for admin dropdown)
         */
        adminProtected.get('/plans', { schema: { tags: ['Admin'], summary: 'List all plans for admin dropdown', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const allPlans = await db
                    .select({
                        id: plans.id,
                        name: plans.name,
                        slug: plans.slug,
                        price: plans.price,
                        isActive: plans.isActive,
                    })
                    .from(plans)
                    .orderBy(plans.sortOrder);

                return reply.send({
                    success: true,
                    data: allPlans,
                });
            } catch (error) {
                request.log.error(error, 'Admin get plans failed');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to get plans',
                });
            }
        });

        /**
         * GET /admin/audit-logs - View recent audit logs
         */
        adminProtected.get('/audit-logs', { schema: { tags: ['Admin'], summary: 'View recent audit logs', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const logs = await db
                    .select({
                        id: adminAuditLogs.id,
                        action: adminAuditLogs.action,
                        previousValue: adminAuditLogs.previousValue,
                        newValue: adminAuditLogs.newValue,
                        paymentReference: adminAuditLogs.paymentReference,
                        note: adminAuditLogs.note,
                        createdAt: adminAuditLogs.createdAt,
                        adminEmail: users.email,
                    })
                    .from(adminAuditLogs)
                    .leftJoin(users, eq(adminAuditLogs.adminUserId, users.id))
                    .orderBy(adminAuditLogs.createdAt)
                    .limit(100);

                return reply.send({
                    success: true,
                    data: logs,
                });
            } catch (error) {
                request.log.error(error, 'Admin get audit logs failed');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to get audit logs',
                });
            }
        });

        // ============================================
        // AI Playground — Admin-only reply testing
        // ============================================

        /**
         * GET /admin/pages - List all pages (for playground dropdown)
         */
        adminProtected.get('/pages', {
            schema: { tags: ['Admin'], summary: 'List all pages for playground', security: auth },
        }, async (_request: FastifyRequest, reply: FastifyReply) => {
            try {
                const allPages = await db
                    .select({
                        id: pages.id,
                        name: pages.name,
                        kbVersion: pages.kbVersion,
                        kbActiveVersion: pages.kbActiveVersion,
                        userId: pages.userId,
                    })
                    .from(pages)
                    .orderBy(pages.name);

                return reply.send({ success: true, data: allPages });
            } catch (error) {
                _request.log.error(error, 'Admin list pages failed');
                return reply.status(500).send({ success: false, error: 'Failed to list pages' });
            }
        });

        /**
         * GET /admin/kb/status/:pageId - KB status for a page
         */
        adminProtected.get<{ Params: { pageId: string } }>('/kb/status/:pageId', {
            schema: { tags: ['Admin'], summary: 'Get KB status for a page', security: auth },
        }, async (request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) => {
            const { pageId } = request.params;

            try {
                const [page] = await db
                    .select({
                        id: pages.id,
                        name: pages.name,
                        knowledgeBase: pages.knowledgeBase,
                        kbVersion: pages.kbVersion,
                        kbActiveVersion: pages.kbActiveVersion,
                        kbUpdatedAt: pages.kbUpdatedAt,
                    })
                    .from(pages)
                    .where(eq(pages.id, pageId))
                    .limit(1);

                if (!page) {
                    return reply.status(404).send({ success: false, error: 'Page not found' });
                }

                // Count chunks for the active version
                const [chunkCount] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(kbChunks)
                    .where(
                        and(
                            eq(kbChunks.pageId, pageId),
                            page.kbActiveVersion !== null
                                ? eq(kbChunks.kbVersion, page.kbActiveVersion)
                                : sql`false`
                        )
                    );

                // Count unresolved gaps
                const [gapCount] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(kbGaps)
                    .where(and(eq(kbGaps.pageId, pageId), eq(kbGaps.resolved, false)));

                return reply.send({
                    success: true,
                    data: {
                        pageId: page.id,
                        pageName: page.name,
                        kbLength: page.knowledgeBase?.length || 0,
                        kbVersion: page.kbVersion,
                        kbActiveVersion: page.kbActiveVersion,
                        kbUpdatedAt: page.kbUpdatedAt,
                        chunksCount: chunkCount?.count || 0,
                        gapsCount: gapCount?.count || 0,
                    },
                });
            } catch (error) {
                request.log.error(error, 'Admin KB status failed');
                return reply.status(500).send({ success: false, error: 'Failed to get KB status' });
            }
        });

        /**
         * GET /admin/kb/gaps/:pageId - List KB gaps for a page
         */
        adminProtected.get<{ Params: { pageId: string } }>('/kb/gaps/:pageId', {
            schema: { tags: ['Admin'], summary: 'List KB gaps for a page', security: auth },
        }, async (request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) => {
            const { pageId } = request.params;

            try {
                const gaps = await db
                    .select({
                        id: kbGaps.id,
                        queryText: kbGaps.queryText,
                        detectedIntent: kbGaps.detectedIntent,
                        occurrenceCount: kbGaps.occurrenceCount,
                        firstSeenAt: kbGaps.firstSeenAt,
                        lastSeenAt: kbGaps.lastSeenAt,
                        resolved: kbGaps.resolved,
                    })
                    .from(kbGaps)
                    .where(eq(kbGaps.pageId, pageId))
                    .orderBy(desc(kbGaps.occurrenceCount));

                return reply.send({ success: true, data: gaps });
            } catch (error) {
                request.log.error(error, 'Admin KB gaps failed');
                return reply.status(500).send({ success: false, error: 'Failed to get KB gaps' });
            }
        });

        /**
         * POST /admin/ai/playground - Test AI reply with full metadata
         * Body: { pageId, question, channel }
         */
        adminProtected.post<{ Body: { pageId: string; question: string; channel: 'comment' | 'dm' } }>('/ai/playground', {
            schema: { tags: ['Admin'], summary: 'Test AI reply generation with full metadata', security: auth },
        }, async (request: FastifyRequest<{ Body: { pageId: string; question: string; channel: 'comment' | 'dm' } }>, reply: FastifyReply) => {
            const { pageId, question, channel } = request.body;
            const startTime = Date.now();

            if (!pageId || !question?.trim()) {
                return reply.status(400).send({ success: false, error: 'pageId and question are required' });
            }

            try {
                // 1. Fetch page data
                const [page] = await db
                    .select({
                        id: pages.id,
                        name: pages.name,
                        userId: pages.userId,
                        workspaceId: pages.workspaceId,
                        knowledgeBase: pages.knowledgeBase,
                        kbActiveVersion: pages.kbActiveVersion,
                    })
                    .from(pages)
                    .where(eq(pages.id, pageId))
                    .limit(1);

                if (!page) {
                    return reply.status(404).send({ success: false, error: 'Page not found' });
                }

                // 1b. Fetch page owner's reply mode settings
                const NUDGE_DEFAULT = 'تم إرسال التفاصيل برسالة خاصة 📩';
                let commentReplyMode: 'public' | 'private' | 'dual' = 'public';
                let nudgeText: string | null = null;
                if (page.userId) {
                    try {
                        const ownerSettings = await settingsService.getSettings(page.userId);
                        commentReplyMode = ownerSettings.commentReplyMode || 'public';
                        if (commentReplyMode === 'dual') {
                            nudgeText = ((ownerSettings.dualReplyNudge as string) || NUDGE_DEFAULT).slice(0, 80);
                        }
                    } catch {
                        // Non-critical — fall back to defaults
                    }
                }

                // 2. Try template match
                let templateMatch: { name?: string; message?: string; id?: string } | null = null;
                if (page.workspaceId) {
                    const matchingRule = await rulesService.findMatchingRule(page.workspaceId, question);
                    if (matchingRule?.templateId) {
                        const template = await templatesService.getTemplate(page.workspaceId, matchingRule.templateId);
                        if (template?.message && template.active !== false) {
                            templateMatch = { name: template.name, message: template.message, id: template.id };
                        }
                    }
                }

                if (templateMatch) {
                    return reply.send({
                        success: true,
                        data: {
                            reply: templateMatch.message,
                            replyMethod: 'template',
                            templateName: templateMatch.name,
                            ragMode: config.ragMode || 'off',
                            chunksRetrieved: 0,
                            chunks: [],
                            intent: null,
                            confidence: null,
                            flags: [],
                            needsAttention: false,
                            cached: false,
                            detectedLanguage: null,
                            latencyMs: Date.now() - startTime,
                            tokensUsed: 0,
                            model: null,
                            gapRecorded: false,
                            commentReplyMode: channel === 'comment' ? commentReplyMode : null,
                            nudgeText: channel === 'comment' ? nudgeText : null,
                        },
                    });
                }

                // 3. RAG retrieval (capture chunks for display)
                let retrievedChunks: RetrievedChunkContext[] = [];
                let queryEmbedding: number[] | undefined;
                let gapRecorded = false;
                const ragMode = config.ragMode || 'off';

                const activeVersion = page.kbActiveVersion;
                if (ragMode !== 'off' && config.openai?.apiKey && activeVersion !== null) {
                    try {
                        const embeddingProvider = new OpenAIEmbeddingProvider(config.openai.apiKey);
                        const retrievalService = new RetrievalService(embeddingProvider);
                        const result = await retrievalService.retrieve(pageId, question, activeVersion);
                        queryEmbedding = result.queryEmbedding;

                        if (result.chunks.length > 0) {
                            retrievedChunks = result.chunks.map(c => ({
                                type: c.type,
                                title: c.title,
                                content: c.content,
                                score: c.finalScore,
                            }));
                        } else {
                            // Record gap (fire-and-forget)
                            gapDetectorService.recordGap(pageId, question).catch(() => {});
                            gapRecorded = true;
                        }
                    } catch {
                        // Retrieval failed — fall back to static KB
                    }
                }

                // 4. Call AI service
                const effectiveKB = (ragMode === 'on' && retrievedChunks.length > 0)
                    ? undefined
                    : page.knowledgeBase || undefined;

                const aiResponse = await aiService.generateReply({
                    comment: question,
                    context: {
                        pageId,
                        pageName: page.name ?? undefined,
                        knowledgeBase: effectiveKB,
                        retrievedChunks: retrievedChunks.length > 0 ? retrievedChunks : undefined,
                        channel,
                        kbActiveVersion: page.kbActiveVersion,
                        queryEmbedding,
                    },
                });

                // 5. Process flags (same logic as generator.ts)
                const flags = [...(aiResponse.flags || [])];
                if (aiResponse.confidence === 'low' && !flags.includes('low_confidence')) {
                    flags.push('low_confidence');
                }
                const needsAttention = flags.length > 0 ||
                    aiResponse.intent === 'COMPLAINT' ||
                    aiResponse.intent === 'OFFENSIVE';
                const skipped = shouldSkipReply(flags.join(','), aiResponse.intent);
                const useFallback = shouldUseFallback(flags.join(','));

                let finalReply = aiResponse.reply;
                if (skipped) {
                    finalReply = null as unknown as string;
                } else if (useFallback) {
                    const lang = aiResponse.language === 'ar' ? 'ar' : 'en';
                    finalReply = PRICE_FALLBACK[lang] || PRICE_FALLBACK.en;
                }

                return reply.send({
                    success: true,
                    data: {
                        reply: finalReply,
                        replyMethod: skipped ? 'skipped' : 'ai',
                        templateName: null,
                        ragMode,
                        chunksRetrieved: retrievedChunks.length,
                        chunks: retrievedChunks,
                        intent: aiResponse.intent || null,
                        confidence: aiResponse.confidence || null,
                        flags,
                        needsAttention,
                        cached: aiResponse.cached,
                        detectedLanguage: aiResponse.language || null,
                        latencyMs: Date.now() - startTime,
                        tokensUsed: aiResponse.tokensUsed || 0,
                        model: aiResponse.model || null,
                        gapRecorded,
                        commentReplyMode: channel === 'comment' ? commentReplyMode : null,
                        nudgeText: channel === 'comment' ? nudgeText : null,
                    },
                });
            } catch (error) {
                request.log.error(error, 'Admin AI playground failed');
                return reply.status(500).send({ success: false, error: 'Failed to generate AI reply' });
            }
        });
    });
}
