import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { waitlistEmails } from '../db/schema';
import { PHONE_REGEX } from '@jawab24/shared';

const WaitlistSchema = z.object({
    contact: z.string().min(1).max(255),
    feature: z.string().min(1).max(50),
}).refine((data) => {
    const isEmail = z.string().email().safeParse(data.contact).success;
    const isPhone = PHONE_REGEX.test(data.contact.replace(/\s/g, ''));
    return isEmail || isPhone;
}, { message: 'Please enter a valid email or phone number' });

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
}
