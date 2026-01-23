import { db } from '../db';
import { users } from '../db/schema';
import { eq, or, ilike } from 'drizzle-orm';

/**
 * Ensure admin users are set up based on environment variables
 * Called on server startup
 * 
 * Supports multiple admins via comma-separated list:
 * ADMIN_EMAILS=admin1@example.com,admin2@example.com
 */
export async function ensureAdminUsers(): Promise<void> {
    const adminEmails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL;
    
    if (!adminEmails) {
        console.log('ℹ️  No ADMIN_EMAILS configured (set ADMIN_EMAILS env var to auto-promote admins)');
        return;
    }

    // Parse comma-separated list of emails
    const emails = adminEmails
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0);

    if (emails.length === 0) {
        return;
    }

    console.log(`🔐 Checking admin status for ${emails.length} configured admin(s)...`);

    for (const email of emails) {
        try {
            // Find user by email (case-insensitive)
            const [user] = await db
                .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
                .from(users)
                .where(ilike(users.email, email))
                .limit(1);

            if (!user) {
                console.log(`⚠️  Admin user not found: ${email} (will be promoted when they sign up)`);
                continue;
            }

            if (user.isAdmin) {
                console.log(`✅ Admin already set: ${email}`);
                continue;
            }

            // Promote to admin
            await db
                .update(users)
                .set({ isAdmin: true, updatedAt: new Date() })
                .where(eq(users.id, user.id));

            console.log(`🔑 Promoted to admin: ${email}`);
        } catch (error) {
            console.error(`❌ Failed to check/set admin for ${email}:`, error);
        }
    }
}

/**
 * Manually promote a user to admin by email
 * Used by CLI scripts
 */
export async function promoteToAdmin(email: string): Promise<{ success: boolean; message: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const [user] = await db
        .select({ id: users.id, email: users.email, name: users.name, isAdmin: users.isAdmin })
        .from(users)
        .where(ilike(users.email, normalizedEmail))
        .limit(1);

    if (!user) {
        return { 
            success: false, 
            message: `User not found with email: ${normalizedEmail}` 
        };
    }

    if (user.isAdmin) {
        return { 
            success: true, 
            message: `${user.name || user.email} is already an admin` 
        };
    }

    await db
        .update(users)
        .set({ isAdmin: true, updatedAt: new Date() })
        .where(eq(users.id, user.id));

    return { 
        success: true, 
        message: `✅ ${user.name || user.email} (${user.email}) is now an admin` 
    };
}

/**
 * Remove admin privileges from a user
 */
export async function demoteAdmin(email: string): Promise<{ success: boolean; message: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const [user] = await db
        .select({ id: users.id, email: users.email, name: users.name, isAdmin: users.isAdmin })
        .from(users)
        .where(ilike(users.email, normalizedEmail))
        .limit(1);

    if (!user) {
        return { 
            success: false, 
            message: `User not found with email: ${normalizedEmail}` 
        };
    }

    if (!user.isAdmin) {
        return { 
            success: true, 
            message: `${user.name || user.email} is not an admin` 
        };
    }

    await db
        .update(users)
        .set({ isAdmin: false, updatedAt: new Date() })
        .where(eq(users.id, user.id));

    return { 
        success: true, 
        message: `✅ ${user.name || user.email} (${user.email}) is no longer an admin` 
    };
}

/**
 * List all current admins
 */
export async function listAdmins(): Promise<Array<{ id: string; email: string | null; name: string | null }>> {
    return db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.isAdmin, true));
}
