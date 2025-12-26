import { db } from '../db';
import { users, subscriptions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import type { User, JWTPayload, AuthResponse } from '../types';
import { subscriptionsService } from './subscriptions';

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
            
            // Ensure existing user has a subscription
            await this.ensureSubscription(user.id);
            
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

        const newUser = newUsers[0];
        
        // Create subscription for new user (with free trial)
        await this.createSubscriptionForNewUser(newUser.id);

        return newUser;
    }
    
    /**
     * Create subscription for a new user
     */
    private async createSubscriptionForNewUser(userId: string): Promise<void> {
        try {
            await subscriptionsService.createSubscription(userId);
            console.log(`[Auth] Created subscription for new user: ${userId}`);
        } catch (error) {
            // Log but don't fail the auth if subscription creation fails
            console.error(`[Auth] Failed to create subscription for user ${userId}:`, error);
        }
    }
    
    /**
     * Ensure user has a subscription (for existing users who might not have one)
     */
    private async ensureSubscription(userId: string): Promise<void> {
        try {
            const existing = await subscriptionsService.getUserSubscription(userId);
            if (!existing) {
                await subscriptionsService.createSubscription(userId);
                console.log(`[Auth] Created missing subscription for existing user: ${userId}`);
            }
        } catch (error) {
            console.error(`[Auth] Failed to ensure subscription for user ${userId}:`, error);
        }
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
    createAuthResponse(user: User, token: string, fbAccessToken: string): AuthResponse {
        return {
            token,
            fbAccessToken,
            user: {
                id: user.id,
                name: user.name || '',
                facebookId: user.facebookId,
            },
        };
    }
}

export const authService = new AuthService();
