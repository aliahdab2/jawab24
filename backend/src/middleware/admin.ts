import { FastifyReply } from 'fastify';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AuthenticatedRequest } from './auth';

export interface AdminUser {
    userId: string;
    facebookId: string;
    email?: string;
    isAdmin: boolean;
}

/**
 * Check if a user is an admin.
 *
 * The authoritative admin signal is the `is_admin` DB column (set only by the
 * trusted `ensureAdminUsers` startup bootstrap or the CLI promote/demote scripts) —
 * NOT the user's email. `email` is self-settable via PATCH /auth/profile, unverified,
 * and not unique, so comparing it against the admin allowlist here let any authed
 * user grant themselves admin by changing their email. Reading `is_admin` fresh (vs.
 * the JWT-cached flag) also means a demotion takes effect immediately.
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
    try {
        const [user] = await db
            .select({ isAdmin: users.isAdmin })
            .from(users)
            .where(eq(users.id, userId));

        return user?.isAdmin === true;
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

    // A restricted (embedded) session can never be admin — even if the OWNER is
    // a real Jawab24 admin. This gate re-reads admin status from the DB (unlike
    // middleware/auth.ts, which trusts the force-cleared JWT flag), so the JWT
    // clearing alone would NOT stop it here — the session marker must.
    if (user.embeddedPlatform) {
        request.log.warn({
            userId: user.userId,
            route: request.url,
            embeddedPlatform: user.embeddedPlatform,
        }, 'Admin access denied for embedded session');
        return reply.status(403).send({
            error: true,
            message: 'Admin access required',
            code: 'ADMIN_REQUIRED',
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
