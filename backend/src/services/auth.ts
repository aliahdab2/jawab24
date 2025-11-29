import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import type { User, JWTPayload, AuthResponse } from '../types';

export class AuthService {
    /**
     * Find or create user by Facebook ID
     */
    async findOrCreateUser(facebookId: string, name: string, email?: string): Promise<User> {
        // Check if user exists
        const existingUsers = await db.select().from(users).where(eq(users.facebookId, facebookId));

        if (existingUsers.length > 0) {
            // Update user info if changed
            const user = existingUsers[0];
            if (user.name !== name || user.email !== email) {
                await db
                    .update(users)
                    .set({
                        name,
                        email,
                        updatedAt: new Date(),
                    })
                    .where(eq(users.id, user.id));

                return { ...user, name, email: email ?? null, updatedAt: new Date() };
            }
            return user;
        }

        // Create new user
        const newUsers = await db
            .insert(users)
            .values({
                facebookId,
                name,
                email,
            })
            .returning();

        return newUsers[0];
    }

    /**
     * Generate JWT token for user
     */
    generateToken(user: User): string {
        const payload: JWTPayload = {
            userId: user.id,
            facebookId: user.facebookId,
        };

        // For now, we'll use a simple base64 encoding
        // In production, use @fastify/jwt plugin for proper JWT signing
        const token = Buffer.from(JSON.stringify(payload)).toString('base64');
        return token;
    }

    /**
     * Verify and decode JWT token
     */
    verifyToken(token: string): JWTPayload | null {
        try {
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            return JSON.parse(decoded) as JWTPayload;
        } catch {
            return null;
        }
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        const result = await db.select().from(users).where(eq(users.id, userId));
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Create auth response
     */
    createAuthResponse(user: User, token: string): AuthResponse {
        return {
            token,
            user: {
                id: user.id,
                name: user.name || '',
                facebookId: user.facebookId,
            },
        };
    }
}

export const authService = new AuthService();
