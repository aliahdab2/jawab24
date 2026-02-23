import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { waitlistEmails } from '../db/schema';

const WaitlistSchema = z.object({
    email: z.string().email().max(255),
    feature: z.string().min(1).max(50),
});

export default async function waitlistRoutes(fastify: FastifyInstance) {
    fastify.post('/', {
        schema: { tags: ['Waitlist'], summary: 'Subscribe to feature waitlist' },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const parsed = WaitlistSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid email address',
            });
        }

        try {
            await db.insert(waitlistEmails).values({
                email: parsed.data.email.toLowerCase().trim(),
                feature: parsed.data.feature,
            }).onConflictDoNothing();

            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error, 'Failed to save waitlist email');
            return reply.status(500).send({
                success: false,
                error: 'Something went wrong',
            });
        }
    });
}
