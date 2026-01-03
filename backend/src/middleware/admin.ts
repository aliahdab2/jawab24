import { FastifyReply } from 'fastify';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AuthenticatedRequest } from './auth';

/**
 * Admin role type stored in user metadata
 * For now we use a simple approach: admin emails are configured via env var
 * In production, you'd want a proper role column in the users table
 */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean);

export interface AdminUser {
    userId: string;
    facebookId: string;
    email?: string;
    isAdmin: boolean;
}

/**
 * Check if a user is an admin
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
    try {
        const [user] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, userId));
        
        if (!user || !user.email) {
            return false;
        }
        
        return ADMIN_EMAILS.includes(user.email);
    } catch {
        return false;
    }
}

/**
 * Middleware to require admin role
 * Must be used AFTER authenticate middleware
 */
export async function requireAdmin(request: AuthenticatedRequest, reply: FastifyReply) {
    const user = request.user;
    
    if (!user) {
        return reply.status(401).send({
            error: true,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED',
        });
    }
    
    const isAdmin = await isUserAdmin(user.userId);
    
    if (!isAdmin) {
        return reply.status(403).send({
            error: true,
            message: 'Admin access required',
            code: 'ADMIN_REQUIRED',
        });
    }
}
