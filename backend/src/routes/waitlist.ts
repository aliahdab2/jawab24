import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { createHmac } from 'crypto';
import { db } from '../db';
import { waitlistEmails } from '../db/schema';
import { config } from '../config';
import { PHONE_REGEX } from '@jawab24/shared';

const WaitlistSchema = z.object({
    contact: z.string().min(1).max(255),
    feature: z.string().min(1).max(50),
}).refine((data) => {
    const isEmail = z.string().email().safeParse(data.contact).success;
    const isPhone = PHONE_REGEX.test(data.contact.replace(/\s/g, ''));
    return isEmail || isPhone;
}, { message: 'Please enter a valid email or phone number' });

/**
 * Generate an HMAC token for unsubscribe links.
 * Uses JWT secret as the signing key — no extra env var needed.
 */
export function generateUnsubscribeToken(email: string): string {
    const secret = config.jwt.secret || 'waitlist-fallback-key';
    return createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');
}

/** Verify an unsubscribe token matches the email */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
    return generateUnsubscribeToken(email) === token;
}

export default async function waitlistRoutes(fastify: FastifyInstance) {
    fastify.post('/', {
        schema: { tags: ['Waitlist'], summary: 'Subscribe to feature waitlist' },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const parsed = WaitlistSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                success: false,
                error: parsed.error.errors[0]?.message ?? 'Invalid email or phone number',
            });
        }

        const { contact, feature } = parsed.data;
        const isEmail = z.string().email().safeParse(contact).success;

        try {
            await db.insert(waitlistEmails).values({
                email: isEmail ? contact.toLowerCase().trim() : null,
                phone: !isEmail ? contact.replace(/\s/g, '') : null,
                feature,
            }).onConflictDoNothing();

            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error, 'Failed to save waitlist signup');
            return reply.status(500).send({
                success: false,
                error: 'Something went wrong',
            });
        }
    });

    /**
     * POST /waitlist/unsubscribe - Unsubscribe from waitlist emails
     * Body: { email: string; token: string }
     * Public endpoint — no auth required, HMAC token prevents abuse.
     */
    fastify.post('/unsubscribe', {
        schema: { tags: ['Waitlist'], summary: 'Unsubscribe from waitlist emails' },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { email?: string; token?: string };
        const email = body.email?.toLowerCase().trim();
        const token = body.token?.trim();

        if (!email || !token) {
            return reply.status(400).send({ success: false, error: 'Missing email or token' });
        }

        if (!verifyUnsubscribeToken(email, token)) {
            return reply.status(403).send({ success: false, error: 'Invalid unsubscribe link' });
        }

        try {
            await db.update(waitlistEmails)
                .set({ unsubscribedAt: new Date() })
                .where(and(
                    eq(waitlistEmails.email, email),
                    isNull(waitlistEmails.unsubscribedAt),
                ));

            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error, 'Failed to unsubscribe waitlist email');
            return reply.status(500).send({ success: false, error: 'Something went wrong' });
        }
    });
}
