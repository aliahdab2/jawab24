import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { customerNotificationTemplates, customerNotificationsLog, whatsappNotificationTemplates } from '../db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { customerNotificationService } from '../services/customerNotifications';
import { ensureTemplatesProvisioned, resolveWhatsAppSender } from '../services/whatsappNotificationSender';
import {
    canonicalTemplateFor,
    isWhatsAppNotificationType,
    WHATSAPP_NOTIFICATION_TYPES,
} from '../services/whatsappNotificationTemplates';

/** GET /api/notification-templates/:storeId */
export async function getTemplates(request: FastifyRequest, reply: FastifyReply) {
    const { storeId } = request.params as { storeId: string };

    const templates = await db
        .select()
        .from(customerNotificationTemplates)
        .where(eq(customerNotificationTemplates.ecommerceStoreId, storeId))
        .orderBy(customerNotificationTemplates.notificationType);

    return reply.send(templates);
}

const VALID_NOTIFICATION_TYPES = new Set([
    'abandoned_cart', 'order_confirmed', 'order_shipped',
    'order_delivered', 'review_request', 'digital_delivery',
]);
const MAX_MESSAGE_LENGTH = 1600; // 10 SMS segments
/** Delivery rails a merchant may pick per notification type. */
const VALID_CHANNELS = new Set(['sms', 'whatsapp']);

/** PUT /api/notification-templates/:storeId/:type */
export async function updateTemplate(request: FastifyRequest, reply: FastifyReply) {

    const { storeId, type } = request.params as { storeId: string; type: string };

    if (!VALID_NOTIFICATION_TYPES.has(type)) {
        return reply.status(400).send({ error: 'Invalid notification type' });
    }

    const body = request.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if ('isEnabled' in body) {
        if (typeof body.isEnabled !== 'boolean') return reply.status(400).send({ error: 'isEnabled must be a boolean' });
        patch.isEnabled = body.isEnabled;
    }
    if ('messageAr' in body) {
        if (typeof body.messageAr !== 'string' || body.messageAr.length > MAX_MESSAGE_LENGTH) {
            return reply.status(400).send({ error: `messageAr must be a string under ${MAX_MESSAGE_LENGTH} characters` });
        }
        patch.messageAr = body.messageAr;
    }
    if ('messageEn' in body) {
        if (typeof body.messageEn !== 'string' || body.messageEn.length > MAX_MESSAGE_LENGTH) {
            return reply.status(400).send({ error: `messageEn must be a string under ${MAX_MESSAGE_LENGTH} characters` });
        }
        patch.messageEn = body.messageEn;
    }
    if ('delayMinutes' in body) {
        const delay = Number(body.delayMinutes);
        if (!Number.isInteger(delay) || delay < 0 || delay > 10080) { // max 1 week
            return reply.status(400).send({ error: 'delayMinutes must be an integer between 0 and 10080' });
        }
        patch.delayMinutes = delay;
    }
    if ('channel' in body) {
        if (typeof body.channel !== 'string' || !VALID_CHANNELS.has(body.channel)) {
            return reply.status(400).send({ error: `channel must be one of: ${[...VALID_CHANNELS].join(', ')}` });
        }
        if (body.channel === 'whatsapp') {
            // Refuse the switch rather than accept it and fail silently at send
            // time: only these types have a canonical Meta template, and the store
            // needs a WhatsApp-connected page linked to it to have a sender at all.
            if (!isWhatsAppNotificationType(type)) {
                return reply.status(400).send({
                    error: 'This notification type is not available over WhatsApp',
                    code: 'WHATSAPP_TYPE_UNSUPPORTED',
                });
            }
            const sender = await resolveWhatsAppSender(storeId);
            if (!sender) {
                return reply.status(400).send({
                    error: 'No WhatsApp-connected page is linked to this store',
                    code: 'NO_WHATSAPP_SENDER',
                });
            }
            // Submitting the canonical templates takes minutes-to-hours at Meta, so
            // start now — the merchant sees the status on the card.
            ensureTemplatesProvisioned(sender).catch(err => {
                request.log.error({ err, storeId }, '[WANotif] template provisioning failed after channel switch');
            });
        }
        patch.channel = body.channel;
    }

    if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: 'No valid fields provided' });
    }

    const [updated] = await db
        .update(customerNotificationTemplates)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(
            eq(customerNotificationTemplates.ecommerceStoreId, storeId),
            eq(customerNotificationTemplates.notificationType, type),
        ))
        .returning();

    if (!updated) return reply.status(404).send({ error: 'Template not found' });
    return reply.send(updated);
}

/** POST /api/notification-templates/:storeId/reset */
export async function resetTemplates(request: FastifyRequest, reply: FastifyReply) {
    const { storeId } = request.params as { storeId: string };

    await db
        .delete(customerNotificationTemplates)
        .where(eq(customerNotificationTemplates.ecommerceStoreId, storeId));

    await customerNotificationService.seedDefaults(storeId);
    return reply.send({ ok: true });
}

/**
 * GET /api/notification-templates/:storeId/whatsapp-status
 *
 * Whether this store can send over WhatsApp at all, and where Meta's review of
 * the canonical templates stands. The card uses it to decide between the channel
 * toggle, a "connect WhatsApp" nudge, and a "waiting for approval" chip — so the
 * merchant is never left guessing why a notification did not go out.
 */
export async function getWhatsAppStatus(request: FastifyRequest, reply: FastifyReply) {
    const { storeId } = request.params as { storeId: string };

    const sender = await resolveWhatsAppSender(storeId);
    if (!sender) return reply.send({ available: false, templates: {} });

    const rows = await db
        .select({
            templateName: whatsappNotificationTemplates.templateName,
            language: whatsappNotificationTemplates.language,
            status: whatsappNotificationTemplates.status,
        })
        .from(whatsappNotificationTemplates)
        .where(eq(whatsappNotificationTemplates.pageId, sender.pageId));

    // Collapse the per-language rows into one status per notification type: a type
    // is usable only when BOTH language variants are approved (we pick the language
    // from the customer's phone at send time, so a half-approved pair is not ready).
    const templates: Record<string, string> = {};
    for (const type of WHATSAPP_NOTIFICATION_TYPES) {
        const statuses = (['ar', 'en'] as const).map(lang =>
            rows.find(r => r.templateName === canonicalTemplateFor(type, lang).name && r.language === lang)?.status ?? 'missing',
        );
        templates[type] = statuses.includes('rejected') ? 'rejected'
            : statuses.every(s => s === 'approved') ? 'approved'
                : statuses.includes('missing') ? 'missing'
                    : 'pending';
    }

    return reply.send({ available: true, templates });
}

/** GET /api/notification-log/:storeId */
export async function getLog(request: FastifyRequest, reply: FastifyReply) {

    const { storeId } = request.params as { storeId: string };
    const { limit: limitStr } = request.query as { limit?: string };
    const limit = Math.min(parseInt(limitStr ?? '50', 10), 200);

    const log = await db
        .select()
        .from(customerNotificationsLog)
        .where(eq(customerNotificationsLog.ecommerceStoreId, storeId))
        .orderBy(desc(customerNotificationsLog.createdAt))
        .limit(limit);

    return reply.send(log);
}

/** GET /api/notification-log/:storeId/stats */
export async function getStats(request: FastifyRequest, reply: FastifyReply) {
    const { storeId } = request.params as { storeId: string };

    const [statusCounts, typeCounts] = await Promise.all([
        db
            .select({ status: customerNotificationsLog.status, count: count() })
            .from(customerNotificationsLog)
            .where(eq(customerNotificationsLog.ecommerceStoreId, storeId))
            .groupBy(customerNotificationsLog.status),
        db
            .select({ notificationType: customerNotificationsLog.notificationType, count: count() })
            .from(customerNotificationsLog)
            .where(eq(customerNotificationsLog.ecommerceStoreId, storeId))
            .groupBy(customerNotificationsLog.notificationType),
    ]);

    const total = statusCounts.reduce((sum, r) => sum + r.count, 0);
    const sent = statusCounts.find(r => r.status === 'sent')?.count ?? 0;
    const failed = statusCounts.find(r => r.status === 'failed')?.count ?? 0;
    const byType = Object.fromEntries(typeCounts.map(r => [r.notificationType, r.count]));

    return reply.send({ total, sent, failed, byType });
}
