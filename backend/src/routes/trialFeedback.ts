import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { trialFeedback } from '../db/schema';
import { verifyTrialFeedbackToken } from '../utils/tokens';

// Fixed reason slugs — kept in sync with FEEDBACK_REASONS in services/trialEndedEmail.ts
// and the i18n labels (trialFeedback* keys). 'other' is reserved for future use.
const VALID_REASONS = new Set(['too_expensive', 'didnt_work', 'too_complex', 'just_testing', 'other']);

/**
 * Trial win-back churn-reason capture. Public, HMAC-gated (no auth) — the merchant
 * clicks a reason link in the trial-ended email. The frontend /trial-feedback page
 * posts { u, reason, token } here. Doubles as the automated churn survey.
 */
export default async function trialFeedbackRoutes(fastify: FastifyInstance) {
    fastify.post('/', {
        schema: { tags: ['Trial'], summary: 'Record trial win-back feedback reason' },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { u?: string; reason?: string; token?: string };
        const userId = body.u?.trim();
        const reason = body.reason?.trim();
        const token = body.token?.trim();

        if (!userId || !reason || !token) {
            return reply.status(400).send({ success: false, error: 'Missing parameters' });
        }
        if (!VALID_REASONS.has(reason)) {
            return reply.status(400).send({ success: false, error: 'Invalid reason' });
        }
        if (!verifyTrialFeedbackToken(userId, token)) {
            return reply.status(403).send({ success: false, error: 'Invalid feedback link' });
        }

        try {
            await db.insert(trialFeedback).values({ userId, reason });
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error, 'Failed to record trial feedback');
            return reply.status(500).send({ success: false, error: 'Something went wrong' });
        }
    });
}
