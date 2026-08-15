import { FastifyReply, FastifyRequest } from 'fastify';
import { pagesService, isPageDisconnected } from '../services/pages';
import { facebookService } from '../services/facebook';
import { subscriptionsService } from '../services/subscriptions';
import { channelTrialService } from '../services/channelTrial';
import { notificationService } from '../services/notifications';
import { gapDetectorService } from '../services/kb/gap-detector';
import { detectCatalogLikePatterns } from '../services/kb/content-classifier';
import { recordActivationEvent, recordAutoreplyEnabledIfEffective, isBusinessInfoProvided } from '../services/activation';
import { businessInfoGate } from '../services/businessReadiness';
import { logAutoReplyToggle, auditLog } from '../services/auditLog';
import { CreatePageDTO, UpdatePageDTO, UpdateLeadConfigDTO, createRequestLogger } from '../types';
import { sanitizeLeadStages, sanitizeLeadFields } from './leadConfigSanitizers';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import { config } from '../config';
import { authService } from '../services/auth';
import { merchantBusinessProfileSchema, validateSchema } from '../utils/validation';
import { canonicalizeHoursWeek, removeKbLines, businessPhoneList, unwrapBusinessProfile } from '@jawab24/shared';
import { pageGateError } from '../utils/pageGateResponse';
import { replyGenerator } from '../services/reply/generator';
import { buildPlaygroundContext } from '../services/reply/playgroundContext';

/** Add isConnected flag and strip both access tokens from page response.
 *  isConnected means "the page's primary channel credential is valid": the
 *  Facebook token for Facebook-backed pages, the WABA token for WhatsApp-only
 *  pages (facebookPageId null) — otherwise WhatsApp-only cards would render
 *  as broken Facebook pages (reconnect banner, disabled card body). */
export function serializePage<T extends {
    accessToken?: string | null;
    whatsappAccessToken?: string | null;
    instagramAccessToken?: string | null;
    facebookPageId?: string | null;
    whatsappDisconnectReason?: string | null;
}>(page: T) {
    const { accessToken, whatsappAccessToken, instagramAccessToken, ...rest } = page;
    const whatsappConnected = !!whatsappAccessToken && whatsappAccessToken !== '';
    const instagramDirectConnected = !!instagramAccessToken && instagramAccessToken !== '';
    // IDENTITY, distinct from the liveness flag above: is this card the
    // Instagram-direct kind at all? NULL means "never was" — while '' is the
    // was-connected sentinel the refresh sweep writes when Meta pronounces the
    // credential dead (markCredentialDead). The card must keep its Instagram
    // identity in exactly that state, or the dead card re-renders as a
    // WhatsApp-only one and the reconnect banner becomes unreachable (PR #772
    // re-review, High): for a pageless IG row `isConnected` and
    // `instagramDirectConnected` flip false TOGETHER, so no liveness-derived
    // discriminator can survive the death it exists to surface.
    const instagramDirect = !page.facebookPageId
        && instagramAccessToken !== null && instagramAccessToken !== undefined;
    return {
        ...rest,
        // "Is the card's PRIMARY channel credential valid?" — Facebook token for a
        // page-backed card; for a page-less card (facebookPageId null) whichever
        // direct channel it carries: the WABA token or the Instagram-direct token.
        // ⚠️ THREE expressions of ONE rule. The admin console asks the same question
        // in SQL (`services/admin/users.ts`, the `disconnected` column) because it
        // must not pull token values into memory, and the backend gates ask it as a
        // predicate (`services/pages.ts` `isPageDisconnected` — webhook front door,
        // manual replies, archive). Change one, change all three, or the admin badge,
        // the merchant's card, and the reply pipeline start disagreeing about the
        // same row. All pinned by tests.
        isConnected: page.facebookPageId ? (!!accessToken && accessToken !== '') : (whatsappConnected || instagramDirectConnected),
        instagramDirect,
        instagramDirectConnected,
        whatsappConnected,
        // "The token needs attention" — driven by the REASON, not by the absence of a
        // token. The health sweep deliberately keeps the credential and only flags
        // (see whatsappTokenHealth.markWhatsAppNeedsReconnect), so gating this on
        // `!whatsappConnected` would have hidden the banner in exactly the state it
        // exists for. Derived here so the UI never learns the enum's values.
        whatsappNeedsReconnect: !!page.whatsappDisconnectReason,
    };
}

/** Upper bound on KB lines a single cleanup request may name (defensive). */
const MAX_CLEANUP_LINES = 1000;

export class PagesController {
    /**
     * Create a new page
     * POST /pages
     */
    async create(request: FastifyRequest<{ Body: CreatePageDTO }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId, workspaceOwnerId } = req;

        try {
            // Check enabled page limit — billing is based on workspace owner's subscription
            const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId);
            if (!limitCheck.allowed) {
                const { status, body } = pageGateError(limitCheck);
                return reply.status(status).send(body);
            }

            const page = await pagesService.createPage(workspaceId, userId, request.body);

            // Subscribe page to webhook events so Facebook sends comments/messages
            if (request.body.facebookPageId && request.body.accessToken) {
                await facebookService.subscribePageToWebhooks(request.body.facebookPageId, request.body.accessToken);
            }

            return reply.status(201).send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create page' });
        }
    }

    /**
     * Get all pages
     * GET /pages
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const pages = await pagesService.getPages(req.workspaceId);
            // Archived pages are hidden HERE, not in pagesService.getPages: this is the
            // single endpoint every merchant surface reads (channels, dashboard, inbox,
            // pickers), while the Facebook sync needs the archived rows to stay visible
            // to its existing-page map and revoke list.
            return reply.send(pages.filter(page => !page.archivedAt).map(serializePage));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch pages' });
        }
    }

    /**
     * Get a single page
     * GET /pages/:id
     */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch page' });
        }
    }

    /**
     * Update a page
     * PUT /pages/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdatePageDTO }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            // Validate businessProfile if present
            if (request.body.businessProfile !== undefined) {
                // The MERCHANT schema — it adds the "a phone slot holds a phone"
                // rule on top of the shared shape. Facebook sync keeps using the
                // base schema (see the comment on merchantBusinessProfileSchema).
                //
                // ⭐ The already-stored numbers are GRANDFATHERED. The editor
                // sends a full-replace patch, so without this one bad stored
                // entry — which Facebook sync or the KB extractor is free to
                // write, both bypassing this rule by design — would 400 a save
                // that only touched the address, forever. The merchant may keep
                // or delete such a row; it can never block an unrelated edit.
                // Only numbers being ADDED or CHANGED here are judged.
                const existing = await pagesService.getPage(req.workspaceId, id);
                const storedNumbers = businessPhoneList(
                    unwrapBusinessProfile(existing?.businessProfile as never).merchant ?? {},
                );
                const validation = validateSchema(
                    merchantBusinessProfileSchema(storedNumbers),
                    request.body.businessProfile,
                );
                if (!validation.success) {
                    return reply.status(400).send({ error: 'Invalid business profile', errors: validation.errors });
                }
                request.body.businessProfile = validation.data;

                // Canonicalize + validate hours at the boundary so the authoritative
                // BUSINESS_INFO prompt block never carries garbage (bad day keys,
                // un-normalized "9am-6pm"). Accepts loose input, emits
                // "HH:MM-HH:MM" / "closed" / "all day".
                //
                // Contract (deliberate): a single bad day key/value rejects the whole
                // payload with 400. Chosen as fail-fast — surfaces a client bug rather
                // than silently dropping data — and there is no live caller today (the
                // frontend KB save sends only { knowledgeBase }). When a merchant-facing
                // hours editor ships, relax this to drop-and-warn (mirror the
                // kbWarnings pattern below) so one stray key can't block the save.
                const bp = request.body.businessProfile as { hours?: Record<string, string[]> };
                if (bp.hours && typeof bp.hours === 'object') {
                    const canon = canonicalizeHoursWeek(bp.hours);
                    if (!canon.ok) {
                        return reply.status(400).send({ error: 'Invalid business hours', day: canon.day, code: canon.error });
                    }
                    bp.hours = canon.value;
                }
            }

            const page = await pagesService.updatePage(req.workspaceId, id, request.body);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            // Activation funnel: KB counts as "filled" only once it carries real,
            // merchant-provided content — enough text AND diverged from the Facebook
            // auto-sync snapshot (shared gate, so the funnel and the dashboard
            // checklist agree). Only evaluate when this PUT actually touched the KB.
            if (request.body.knowledgeBase !== undefined && page.userId
                && isBusinessInfoProvided(page.knowledgeBase, page.suggestedKnowledgeBase)) {
                void recordActivationEvent(page.userId, 'kb_filled', {
                    chars: (page.knowledgeBase ?? '').trim().length,
                });
            }

            // Non-blocking: flag catalog-like patterns in raw KB so the editor
            // can prompt the merchant to restructure (Stage 2/3 will offer
            // structured catalog entry). Only runs when KB text was supplied
            // in this update.
            const serialized = serializePage(page);
            const kbText = request.body.knowledgeBase;
            if (typeof kbText === 'string' && kbText.trim().length > 0) {
                const detection = detectCatalogLikePatterns(kbText);
                if (detection.hasCatalog) {
                    return reply.send({ ...serialized, kbWarnings: detection });
                }
            }
            return reply.send(serialized);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update page' });
        }
    }

    /**
     * Save per-page lead-config overrides (sub-stages / custom fields).
     * PATCH /pages/:id/lead-config  (admin+ only)
     * Body per slice: omitted key → unchanged; `null` → revert to workspace
     * default; set value → full override for this page (sanitized; 400 on garbage).
     */
    async updateLeadConfig(request: FastifyRequest<{ Params: { id: string }; Body: UpdateLeadConfigDTO }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;
        const body = request.body ?? {};
        const update: UpdateLeadConfigDTO = {};

        if ('leadStages' in body) {
            if (body.leadStages === null) {
                update.leadStages = null;
            } else {
                const sanitized = sanitizeLeadStages(body.leadStages);
                if (sanitized === undefined) {
                    return reply.status(400).send({ error: 'Invalid leadStages config' });
                }
                update.leadStages = sanitized;
            }
        }
        if ('leadFields' in body) {
            if (body.leadFields === null) {
                update.leadFields = null;
            } else {
                const sanitized = sanitizeLeadFields(body.leadFields);
                if (sanitized === undefined) {
                    return reply.status(400).send({ error: 'Invalid leadFields config' });
                }
                update.leadFields = sanitized;
            }
        }

        try {
            const page = await pagesService.updateLeadConfig(req.workspaceId, id, update);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update lead config' });
        }
    }

    /**
     * Delete a page
     * DELETE /pages/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            // Unsubscribe from webhooks before deleting
            const page = await pagesService.getPage(req.workspaceId, id);
            if (page) {
                if (page.facebookPageId) {
                    await facebookService.unsubscribePageFromWebhooks(page.facebookPageId, page.accessToken);
                }
            }

            await pagesService.deletePage(req.workspaceId, id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete page' });
        }
    }

    /**
     * Archive (soft-hide) a disconnected page
     * POST /pages/:id/archive
     */
    async archive(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId } = req;
        const { userId } = req.user;
        const { id } = request.params;

        try {
            const result = await pagesService.archivePage(workspaceId, id);

            if (result.status === 'not_found') {
                return reply.status(404).send({ error: 'Page not found' });
            }
            if (result.status === 'not_disconnected') {
                return reply.status(400).send({
                    error: 'Only a disconnected Facebook page can be archived.',
                    code: 'PAGE_NOT_DISCONNECTED',
                });
            }

            if (!result.already) {
                void auditLog({
                    userId,
                    workspaceId,
                    pageId: id,
                    action: 'page.archived',
                    entityType: 'page',
                    entityId: id,
                    metadata: { reason: 'user' },
                });
            }

            return reply.send(serializePage(result.page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to archive page' });
        }
    }

    /**
     * Toggle auto-reply for a page
     * PATCH /pages/:id/auto-reply
     */
    async toggleAutoReply(request: FastifyRequest<{ Params: { id: string }; Body: { enabled: boolean } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId, workspaceOwnerId } = req;
        const { userId } = req.user;
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            // Snapshot the prior state up-front: it drives the enable-time guards
            // below AND lets us emit an audit event only on a genuine transition.
            const existingPage = await pagesService.getPage(workspaceId, id);
            const previousEnabled = existingPage?.autoReplyEnabled ?? null;

            // Only check limit when ENABLING (disabling is always allowed)
            if (enabled) {
                // Block enabling if page access was revoked in Facebook.
                //
                // ⚠️ The `facebookPageId` half is NOT redundant. This endpoint governs
                // the FACEBOOK channel only (Instagram and WhatsApp own
                // /instagram-auto-reply and their own toggle), and since #772
                // `isPageDisconnected` reports a PAGELESS row — WhatsApp-only or
                // Instagram-direct — as CONNECTED, because its credential simply
                // lives in another column. Those rows used to land here as
                // "disconnected" purely because `access_token` is '' on them, so
                // without this half the widened predicate would newly ALLOW enabling
                // Facebook auto-reply on a card that has no Facebook Page to reply
                // as. Asking the channel's own question keeps this endpoint's answer
                // byte-identical to pre-#772 for every pageless row.
                //
                // `existingPage &&` preserves the not-found path: an unknown id must
                // still fall through to the 404 below, not answer 400 here.
                if (existingPage && !existingPage.facebookPageId) {
                    return reply.status(400).send({
                        error: 'This page is disconnected. Please reconnect via Facebook to resume auto-replies.',
                        code: 'PAGE_DISCONNECTED',
                    });
                }
                if (isPageDisconnected(existingPage)) {
                    return reply.status(400).send({
                        error: 'This page is disconnected. Please reconnect via Facebook to resume auto-replies.',
                        code: 'PAGE_DISCONNECTED',
                    });
                }

                // Same readiness bar as the WhatsApp and Instagram toggles: never
                // put a bot in front of customers with nothing to answer from. A
                // Facebook page normally passes on its seeded about/phone/hours, so
                // this bites only a genuinely empty card — verified against
                // production before wiring (39 enabled pages, 0 would be refused).
                const infoGate = await businessInfoGate(existingPage);
                if (infoGate) return reply.status(infoGate.status).send(infoGate.body);

                const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId, id);
                if (!limitCheck.allowed) {
                    const { status, body } = pageGateError(limitCheck);
                    return reply.status(status).send(body);
                }

                // Anti free-trial-abuse: a channel gets one free trial across the
                // platform. If this channel already used it under another account
                // and this account isn't paying, keep auto-reply off until they
                // subscribe (paying unlocks it instantly).
                if (existingPage) {
                    const trialCheck = await channelTrialService.evaluate(
                        workspaceOwnerId,
                        channelTrialService.channelsForPage(existingPage),
                    );
                    if (trialCheck.blocked) {
                        return reply.status(402).send({
                            error: 'This page has already used its free trial. Subscribe to enable auto-reply.',
                            code: 'TRIAL_ALREADY_USED',
                        });
                    }
                }
            }

            const page = await pagesService.toggleAutoReply(workspaceId, id, enabled);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            // Claim the channels for the billing account (first writer wins) so this
            // page's free trial can't later be farmed by a different account.
            if (enabled) {
                await channelTrialService.record(
                    channelTrialService.channelsForPage(page),
                    workspaceOwnerId,
                    workspaceId,
                );
                // Activation funnel: count as activated only when the pipeline can
                // actually fire — workspace master ON and this (or another) page
                // channel-enabled (D-026). The page-level toggle alone used to emit,
                // over-counting new signups whose master is OFF by default (D-025).
                if (page.userId) {
                    void recordAutoreplyEnabledIfEffective(page.userId, workspaceId, { pageId: page.id, source: 'page_toggle' });
                }
            }
            // Audit trail: record WHO flipped auto-reply and WHEN. Support can then
            // answer "who turned this page on/off again?" with a single query
            // instead of reconstructing it from row timestamps. Emit only on a real
            // transition so idempotent re-saves don't create phantom toggle events.
            if (previousEnabled !== enabled) {
                logAutoReplyToggle({
                    pageId: id,
                    workspaceId,
                    userId,
                    enabled,
                    previous: previousEnabled,
                    reason: 'user',
                });
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle auto-reply' });
        }
    }

    /**
     * Sync pages from Facebook
     * POST /pages/sync
     */
    async sync(request: FastifyRequest<{ Body: { accessToken: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId, workspaceOwnerId } = req;
        const { accessToken } = request.body;

        if (!accessToken) {
            return reply.status(400).send({
                error: 'Access token is required',
                hint: 'Please log out and log back in to refresh your Facebook token'
            });
        }

        // Demo users have no real Facebook token — return their seeded pages directly
        const dbUser = config.demo.enabled ? await authService.getUserById(userId) : null;
        if (dbUser?.facebookId === config.demo.userFacebookId) {
            const pages = await pagesService.getPages(workspaceId);
            return reply.send({ synced: pages.length, pages: pages.map(serializePage), skipped: 0 });
        }

        try {
            request.log.info(`[Pages] Sync requested for workspace ${workspaceId}`);
            const { syncedPages, skippedCount, skippedPages, skipReason, pageLimit, takenCount, trialBlockedCount, trialBlockedPages, revokedCount, alreadyMemberOf } = await pagesService.syncFromFacebook(workspaceId, userId, accessToken, workspaceOwnerId, createRequestLogger(request.log));

            // Activation funnel: the user has connected at least one page.
            if (syncedPages.length > 0) {
                void recordActivationEvent(userId, 'page_connected', { count: syncedPages.length });
            }

            if (syncedPages.length === 0 && takenCount === 0 && (trialBlockedCount ?? 0) === 0 && skippedCount === 0) {
                // /me/accounts came back empty — every non-empty Facebook response
                // increments one of the counters above. Count the drop-off only for
                // merchants with no previously-connected pages either: a revoked-
                // permission re-sync of an established workspace is not an
                // "Instagram-only merchant" prospect.
                const existingPages = await pagesService.getPages(workspaceId);
                if (existingPages.length === 0) {
                    void recordActivationEvent(userId, 'no_fb_pages');
                }
                return reply.send({
                    synced: 0,
                    pages: [],
                    message: 'No pages found. Make sure you are an admin of at least one Facebook page and have granted the required permissions.'
                });
            }

            const response: Record<string, unknown> = { synced: syncedPages.length, pages: syncedPages.map(serializePage) };

            if (skippedCount > 0) {
                // Pages REFUSED at connect (not persisted). Surface the names so the
                // client can tell the merchant exactly which pages are missing, plus
                // the REASON so it shows the right call-to-action.
                response.skippedCount = skippedCount;
                response.skippedPages = skippedPages;
                response.skipReason = skipReason; // 'subscription_inactive' | 'page_limit'
                if (skipReason === 'subscription_inactive') {
                    // Returning identity / trial-already-used: NOT a page-count limit.
                    // "Upgrade for more pages" is misleading — they must subscribe.
                    response.warning = `${skippedCount} page(s) were not connected because this account's free trial was already used. Subscribe to connect and enable auto-reply.`;
                    response.subscriptionRequired = true;
                } else {
                    response.warning = `${skippedCount} page(s) were not connected because your plan's page limit was reached. Upgrade to connect more pages.`;
                    response.pageLimit = pageLimit;
                }
            }

            if (takenCount > 0) {
                response.takenCount = takenCount;
            }

            // Pages connected but auto-reply kept OFF because the channel already
            // used its free trial under another account (and this account isn't
            // paying). The client surfaces a "subscribe to enable" notice.
            if ((trialBlockedCount ?? 0) > 0) {
                response.trialBlockedCount = trialBlockedCount;
                response.trialBlockedPages = trialBlockedPages;

                // Best-effort persistent bell notification (the toast is transient).
                // Sent to the billing owner — one per blocked page, capped at a few
                // so a large sweep can't flood the bell. Failure must not break sync.
                // No deepLink — the client resolves an iOS-safe route by type
                // (App Store 3.1.1: iOS taps must not lead to /pricing).
                for (const blocked of (trialBlockedPages ?? []).slice(0, 5)) {
                    notificationService.sendTemplateNotification(
                        workspaceOwnerId,
                        'page_trial_used',
                        { pageName: blocked.pageName }
                    ).catch(err => request.log.error({ err }, 'Failed to send page_trial_used notification'));
                }
            }

            // Pages whose holding workspace the user is already a member of — the
            // client renders an actionable "Switch to ‹X›" affordance instead of
            // the generic "ask the owner to invite you" warning.
            if (alreadyMemberOf && alreadyMemberOf.length > 0) {
                response.alreadyMemberOf = alreadyMemberOf;
            }

            if ((revokedCount ?? 0) > 0) {
                response.revokedWarning = `${revokedCount} page(s) were disconnected because access was revoked in Facebook.`;
                response.revokedCount = revokedCount;
            }

            // Include current limit status for frontend display
            const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId);
            if (limitCheck.remaining !== undefined) {
                response.enabledPagesRemaining = limitCheck.remaining;
            }

            return reply.send(response);
        } catch (error) {
            request.log.error(error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return reply.status(500).send({
                error: 'Failed to sync pages from Facebook',
                details: errorMessage,
                hint: 'This could be due to an expired token. Try logging out and back in.'
            });
        }
    }
    /**
     * Get unresolved KB gaps for a page
     * GET /pages/:id/kb-gaps
     */
    async getKbGaps(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            // Verify page belongs to this workspace
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            const gaps = await gapDetectorService.getUnresolvedGaps(id, 10);
            return reply.send({ success: true, data: gaps });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch KB gaps' });
        }
    }

    /**
     * Confirmed KB cleanup after a catalog import/scan (Phase C).
     * POST /pages/:id/kb/cleanup   body: { lines: string[] }
     *
     * The merchant confirmed specific KB lines (their products moved to the
     * catalog) for removal. Contract is by LINE TEXT, not index: a stale index
     * could delete the WRONG line, whereas an exact-text match that no longer
     * exists is simply skipped — so we never delete a line the merchant didn't
     * name. NOTE this is still a read-modify-write of the whole KB (last-write-
     * wins, same as the normal KB PATCH): a *different* line added concurrently
     * between this read and write could be lost. Acceptable here because cleanup
     * fires right after an import in the same session (tiny window); a
     * kbVersion compare-and-set across the whole KB-edit surface is the proper
     * follow-up, not a cleanup-only bolt-on.
     *
     * Reuses updatePage (validation / ingestion / activation) but passes
     * skipGapResolution so the «سألها N عملاء» backlog survives — a cleanup
     * REMOVES product lines, it does not answer open customer questions.
     */
    async cleanupKb(request: FastifyRequest<{ Params: { id: string }; Body: { lines?: unknown } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;
        const { lines } = request.body;

        if (!Array.isArray(lines) || lines.some((l) => typeof l !== 'string')) {
            return reply.status(400).send({ error: 'Body must be { lines: string[] } — the exact KB lines to remove' });
        }
        // Defensive cap: a real KB has at most a few dozen lines; a payload larger
        // than this is a client bug, not a legitimate cleanup.
        if (lines.length > MAX_CLEANUP_LINES) {
            return reply.status(400).send({ error: `Too many lines (max ${MAX_CLEANUP_LINES})`, code: 'TOO_MANY_LINES' });
        }

        try {
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            const currentKb = page.knowledgeBase ?? '';
            const confirmed = new Set(lines as string[]);
            const kbLines = currentKb.split('\n');
            const indices = kbLines
                .map((line, i) => (confirmed.has(line) ? i : -1))
                .filter((i) => i >= 0);

            // Nothing matched (KB changed since the merchant saw the sheet) —
            // a safe no-op, not an error.
            if (indices.length === 0) {
                return reply.send({ ...serializePage(page), cleanup: { removed: 0 } });
            }

            const cleaned = removeKbLines(currentKb, indices);

            // Guard the empty-KB trap: an emptied KB skips re-ingestion upstream,
            // leaving stale RAG chunks active. A cleanup should never blank the
            // whole KB (you don't move every business fact to the catalog); if it
            // would, refuse and tell the merchant rather than silently rotting.
            if (!cleaned.trim()) {
                return reply.status(400).send({ error: 'Cleanup would empty your Business Info — remove products individually instead', code: 'CLEANUP_EMPTIES_KB' });
            }

            const updated = await pagesService.updatePage(
                req.workspaceId,
                id,
                { knowledgeBase: cleaned } as UpdatePageDTO,
                { skipGapResolution: true },
            );
            if (!updated) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            // Audit trail: this mutation REMOVES merchant content, so leave a record
            // that lets a "you deleted the wrong line" report be reconstructed.
            request.log.info(
                { pageId: id, workspaceId: req.workspaceId, removed: indices.length },
                '[Pages] KB cleanup removed merchant-confirmed lines',
            );

            return reply.send({ ...serializePage(updated), cleanup: { removed: indices.length } });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to clean up Business Info' });
        }
    }

    /**
     * Dismiss (resolve) a KB gap
     * POST /pages/:id/kb-gaps/:gapId/dismiss
     */
    async dismissGap(request: FastifyRequest<{ Params: { id: string; gapId: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id, gapId } = request.params;

        try {
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            await gapDetectorService.resolveGap(gapId, id);
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to dismiss KB gap' });
        }
    }

    /**
     * Record the merchant's interest in connecting Instagram without a
     * Facebook Page — the demand signal for a future Instagram-Login connect
     * path. Idempotent per user via activation_events' unique index.
     * POST /pages/instagram-direct-interest
     */
    async recordInstagramDirectInterest(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        void recordActivationEvent(req.user.userId, 'ig_direct_interest');
        return reply.status(204).send();
    }

    /**
     * Test smart reply generation for a page
     * POST /pages/:id/test-reply
     */
    async testReply(request: FastifyRequest<{ Params: { id: string }; Body: { question: string; channel: 'comment' | 'dm'; postMessage?: string; conversationHistory?: { role: 'user' | 'assistant'; content: string }[] } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceOwnerId } = req;
        const { id } = request.params;
        const { question, channel, postMessage, conversationHistory } = request.body;
        const startTime = Date.now();

        // 1. Validate input
        if (!question?.trim()) {
            return reply.status(400).send({ error: 'question is required' });
        }
        if (question.length > 500) {
            return reply.status(400).send({ error: 'question must be 500 characters or less' });
        }
        if (channel !== 'comment' && channel !== 'dm') {
            return reply.status(400).send({ error: 'channel must be "comment" or "dm"' });
        }
        if (postMessage && postMessage.length > 1000) {
            return reply.status(400).send({ error: 'postMessage must be 1000 characters or less' });
        }
        if (conversationHistory && !Array.isArray(conversationHistory)) {
            return reply.status(400).send({ error: 'conversationHistory must be an array' });
        }
        if (conversationHistory && conversationHistory.length > 20) {
            return reply.status(400).send({ error: 'conversationHistory must be 20 messages or less' });
        }

        // 2. Check AI quota
        const quotaCheck = await subscriptionsService.canUseAiReplies(workspaceOwnerId);
        if (!quotaCheck.allowed) {
            return reply.status(403).send({
                error: quotaCheck.reason || 'AI reply limit reached',
                code: 'AI_QUOTA_EXCEEDED',
                limit: quotaCheck.limit,
                used: quotaCheck.used,
            });
        }

        try {
            // 3. Fetch page (workspace-scoped — tenant isolation)
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            // 4–6. Build playground context (shared with admin playground)
            const { playgroundInput, commentReplyMode, nudgeText } = await buildPlaygroundContext({
                page, question, channel, postMessage,
                conversationHistory: channel === 'dm' ? conversationHistory : undefined,
            });

            // 7. Generate reply via the same pipeline as production
            replyGenerator.setLogger(request.log);
            const result = await replyGenerator.generateForPlayground(playgroundInput);

            // 8. Strip internal metadata — return only customer-safe fields.
            // When the generator returned 'skipped' (friend-tag, spam, punctuation w/o post
            // context), production posts NOTHING — not the full reply, not the nudge. Match
            // that here: nudgeText is null on skipped so the UI doesn't show a phantom nudge.
            const isSkipped = result.replyMethod === 'skipped';
            return reply.send({
                success: true,
                data: {
                    reply: result.reply,
                    replyMethod: result.replyMethod,
                    latencyMs: Date.now() - startTime,
                    commentReplyMode: channel === 'comment' ? commentReplyMode : null,
                    nudgeText: channel === 'comment' && !isSkipped ? nudgeText : null,
                    // Customer-safe teaching signal: the reply exceeded the model
                    // output cap and was auto-shortened by the truncation retry.
                    // Lets the merchant see the shortening the moment they test
                    // their Business Info, before any customer is affected.
                    replyShortened: !isSkipped && result.replyShortened,
                },
            });
        } catch (error) {
            request.log.error(error, 'Test smart reply failed');
            return reply.status(500).send({ error: 'Failed to generate reply' });
        }
    }
}

export const pagesController = new PagesController();
