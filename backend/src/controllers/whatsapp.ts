import { FastifyReply, FastifyRequest } from 'fastify';
import { pagesService } from '../services/pages';
import { whatsappService } from '../services/whatsapp';
import { subscriptionsService } from '../services/subscriptions';
import { channelTrialService } from '../services/channelTrial';
import { pageGateError } from '../utils/pageGateResponse';
import { serializePage } from './pages';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

/** Meta error code: two-step-verification PIN mismatch on /register. */
const META_PIN_MISMATCH = 133005;

function metaErrorCode(error: unknown): number | undefined {
    const axiosErr = error as { response?: { data?: { error?: { code?: number } } } };
    return axiosErr.response?.data?.error?.code;
}

export class WhatsAppController {
    /**
     * Connect a WhatsApp Business number to a page via Embedded Signup.
     * POST /pages/:id/connect-whatsapp
     *
     * Body comes from the ES popup: the one-time auth `code` plus the
     * `phoneNumberId` / `wabaId` delivered in the WA_EMBEDDED_SIGNUP
     * session-info message event.
     */
    async connect(
        request: FastifyRequest<{
            Params: { id: string };
            Body: { code: string; phoneNumberId: string; wabaId: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId } = req;
        const { id } = request.params;
        const { code, phoneNumberId, wabaId } = request.body ?? {};

        if (!code || !phoneNumberId || !wabaId
            || typeof code !== 'string' || typeof phoneNumberId !== 'string' || typeof wabaId !== 'string') {
            return reply.status(400).send({ error: 'code, phoneNumberId and wabaId are required' });
        }

        try {
            const page = await pagesService.getPage(workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            // One WhatsApp number belongs to exactly one page across the platform.
            const holder = await pagesService.getPageByWhatsAppPhoneNumberId(phoneNumberId);
            if (holder && holder.id !== id) {
                return reply.status(409).send({
                    error: 'This WhatsApp number is already connected to another page',
                    code: 'WHATSAPP_NUMBER_TAKEN',
                });
            }

            const accessToken = await whatsappService.exchangeCodeForToken(code);

            // Deliver this WABA's message webhooks to our /webhook endpoint.
            await whatsappService.subscribeAppToWaba(wabaId, accessToken);

            // Enable Cloud API messaging for the number. Re-registration with the
            // same PIN is idempotent at Meta, so a reconnect passes through; a
            // number carrying a foreign two-step PIN is the one actionable failure.
            try {
                await whatsappService.registerPhoneNumber(phoneNumberId, accessToken);
            } catch (error) {
                if (metaErrorCode(error) === META_PIN_MISMATCH) {
                    return reply.status(422).send({
                        error: 'This number has two-step verification enabled with a different PIN. Disable it in the WhatsApp Business app, then reconnect.',
                        code: 'WHATSAPP_PIN_MISMATCH',
                    });
                }
                throw error;
            }

            const info = await whatsappService.getPhoneNumberInfo(phoneNumberId, accessToken);

            const updated = await pagesService.connectWhatsApp(workspaceId, id, {
                phoneNumberId,
                businessAccountId: wabaId,
                displayPhoneNumber: info.displayPhoneNumber,
                accessToken,
            });

            request.log.info(
                { pageId: id, phoneNumberId, wabaId, displayPhoneNumber: info.displayPhoneNumber },
                '[WhatsApp] Number connected',
            );
            return reply.send(serializePage(updated));
        } catch (error) {
            request.log.error(error);
            return reply.status(502).send({
                error: 'Failed to connect WhatsApp. Please try again.',
                code: 'WHATSAPP_CONNECT_FAILED',
            });
        }
    }

    /**
     * Disconnect WhatsApp from a page.
     * DELETE /pages/:id/whatsapp
     *
     * Local-only: we deliberately do NOT unsubscribe the app from the WABA —
     * a WABA can hold multiple numbers and an unsubscribe would silence all
     * of them, including numbers connected to other pages.
     */
    async disconnect(
        request: FastifyRequest<{ Params: { id: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            const updated = await pagesService.disconnectWhatsApp(req.workspaceId, id);
            if (!updated) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            request.log.info({ pageId: id }, '[WhatsApp] Number disconnected');
            return reply.send(serializePage(updated));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to disconnect WhatsApp' });
        }
    }

    /**
     * Toggle WhatsApp auto-reply for a page
     * PATCH /pages/:id/whatsapp-auto-reply
     */
    async toggleAutoReply(
        request: FastifyRequest<{
            Params: { id: string };
            Body: { enabled: boolean };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId, workspaceOwnerId } = req;
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            const existingPage = await pagesService.getPage(workspaceId, id);
            if (!existingPage) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            if (!existingPage.whatsappPhoneNumberId) {
                return reply.status(400).send({
                    error: 'WhatsApp is not connected to this page',
                    code: 'WHATSAPP_NOT_CONNECTED',
                });
            }

            // Only check limit when ENABLING (disabling is always allowed)
            if (enabled) {
                const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId, id);
                if (!limitCheck.allowed) {
                    const { status, body } = pageGateError(limitCheck);
                    return reply.status(status).send(body);
                }

                // Anti free-trial-abuse: a channel gets one free trial across the
                // platform (same gate as the Facebook/Instagram toggles).
                const trialCheck = await channelTrialService.evaluate(
                    workspaceOwnerId,
                    channelTrialService.channelsForPage(existingPage),
                );
                if (trialCheck.blocked) {
                    return reply.status(402).send({
                        error: 'This account has already used its free trial. Subscribe to enable auto-reply.',
                        code: 'TRIAL_ALREADY_USED',
                    });
                }
            }

            const page = await pagesService.toggleWhatsAppAutoReply(workspaceId, id, enabled);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            // Claim the channels for the billing account (first writer wins).
            if (enabled) {
                await channelTrialService.record(
                    channelTrialService.channelsForPage(page),
                    workspaceOwnerId,
                    workspaceId,
                );
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle WhatsApp auto-reply' });
        }
    }
}

export const whatsappController = new WhatsAppController();
