import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users, subscriptions, plans, adminAuditLogs, pages, usage } from '../db/schema';
import { eq, ilike, desc, and, gte, lte } from 'drizzle-orm';
import { auth } from '../utils/swagger';

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
    });
}
