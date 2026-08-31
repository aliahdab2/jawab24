import { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { config } from '../config';
import { pagesService } from '../services/pages';
import { whatsappService } from '../services/whatsapp';
import { subscriptionsService } from '../services/subscriptions';
import { channelTrialService } from '../services/channelTrial';
import { getWhatsAppUnavailableReason, WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE } from '../services/whatsappAvailability';
import { recordAutoreplyEnabledIfEffective } from '../services/activation';
import { businessInfoGate } from '../services/businessReadiness';
import { pageGateError } from '../utils/pageGateResponse';
import { serializePage } from './pages';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import { pgErrorCode } from '../utils/dbErrors';

/** Meta error code: two-step-verification PIN mismatch on /register. */
const META_PIN_MISMATCH = 133005;
/** Postgres unique_violation — the whatsapp_phone_number_id unique index. */
const PG_UNIQUE_VIOLATION = '23505';

const PIN_MISMATCH_RESPONSE = {
    error: 'This number has two-step verification enabled with a different PIN. Disable it in the WhatsApp Business app, then reconnect.',
    code: 'WHATSAPP_PIN_MISMATCH',
} as const;

const NUMBER_TAKEN_RESPONSE = {
    error: 'This WhatsApp number is already connected to another page',
    code: 'WHATSAPP_NUMBER_TAKEN',
} as const;

/**
 * Canary gate: while `WHATSAPP_ALLOWLIST` is non-empty, only those accounts may
 * connect a WhatsApp number (staged rollout — founder first). Empty allowlist =
 * open to everyone (full launch). Enforced server-side by email (fetched from
 * the DB, like the admin check) so it holds regardless of the client. Returns
 * true when the acting user is allowed to connect.
 */
export async function isWhatsAppConnectAllowed(userId: string): Promise<boolean> {
    if (config.whatsappAllowlist.length === 0) return true;
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const email = user?.email?.trim().toLowerCase();
    return !!email && config.whatsappAllowlist.includes(email);
}

const NOT_ALLOWLISTED_RESPONSE = {
    error: 'WhatsApp isn\'t available on your account yet.',
    code: 'WHATSAPP_NOT_ALLOWLISTED',
} as const;

/**
 * Shared 403 body for the WhatsApp plan gate. Exported so the redirect-flow
 * callback (`whatsappRedirect.ts`) reuses the exact same contract instead of
 * carrying its own copy (Rule 10.8).
 */
export const PLAN_REQUIRED_RESPONSE = {
    error: 'WhatsApp requires the Starter plan or higher.',
    code: 'WHATSAPP_PLAN_REQUIRED',
    requiredPlan: 'starter',
} as const;

/**
 * Shared 402 body for the WhatsApp connect STATUS gate. A sibling of
 * `PLAN_REQUIRED_RESPONSE` and `WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE`: one
 * definition, so both connect transports send the SAME code and the client's
 * `whatsappConnectErrorKey` has one entry to map. Deliberately static — the service's
 * `reason` is an internal English string (`getUsageSummary` refuses to forward
 * it for exactly that reason), and the client renders a translated message
 * keyed off `code`.
 */
export const WHATSAPP_SUBSCRIPTION_INACTIVE_RESPONSE = {
    error: 'WhatsApp connect requires an active subscription.',
    code: 'WHATSAPP_SUBSCRIPTION_INACTIVE',
} as const;

/** A connect gate refusal, in the shape every transport can render. */
export interface WhatsAppConnectRefusal {
    status: 402 | 403;
    code: string;
    body: Record<string, unknown>;
}

/**
 * Plan entitlement gate: WhatsApp is included from the Starter plan up
 * (`plans.whatsapp_enabled`; Basic is the only paid plan without it — D-118).
 * Keyed on the WORKSPACE OWNER's subscription — team admins have no
 * subscription row of their own (same subject as `canEnablePage`). No
 * subscription = blocked (fail closed). The trial rides on Starter, so trialing
 * accounts are entitled. Enforced on connect + enable only — disconnect/disable
 * always work, and an already-enabled number keeps working after a downgrade
 * (matches the maxPages model: enforcement-on-enable, no retroactive disable).
 *
 * CONNECT does not call this directly — it goes through
 * `checkWhatsAppConnectEntitlement`, which adds the status gate and shares this
 * one subscription read. The ENABLE/toggle path still calls it alone, because
 * status there is `canEnablePage`'s job.
 */
export async function hasWhatsAppPlanAccess(workspaceOwnerId: string): Promise<boolean> {
    const sub = await subscriptionsService.getUserSubscription(workspaceOwnerId);
    return !!sub?.plan.whatsappEnabled;
}

/**
 * THE gate chain for CONNECTING a WhatsApp number. Returns the refusal, or null
 * when the account may proceed. Every connect entry point — `connect`,
 * `connectNew`, the redirect `prepareStartUrls`, the callback `reverifyGates` —
 * calls this and nothing else, so the checks and their ORDER are defined once.
 *
 * Order is deliberate: PERMANENT blocks before transient ones. A Zid-connected
 * account can never connect WhatsApp (D-117), so telling it "renew your
 * subscription" would steer the merchant to pay for something renewal cannot
 * unlock. Plan → marketplace → status.
 *
 * Why connect status-gates at all, when a page slot is enforced at ENABLE
 * (`canEnablePage`): completing connect ends in `completeWhatsAppSignup`, whose
 * `registerPhoneNumber` call takes the number OFF the merchant's phone. Refusing
 * at enable would be after that. Before D-118 the Starter-only plan flag doubled
 * as this gate; making WhatsApp a Starter feature removed that side effect, so
 * an expired-trial Starter reached signup. See D-121.
 *
 * ONE `getUserSubscription` read serves both the plan check and the status
 * check — it is a join plus a possible lazy-expiry UPDATE, and the two gates
 * ask different questions of the SAME row. Fails closed on a missing
 * subscription: the plan check already refuses that, and the status check must
 * not silently pass what the plan check would refuse.
 */
export async function checkWhatsAppConnectEntitlement(
    workspaceOwnerId: string,
): Promise<WhatsAppConnectRefusal | null> {
    const sub = await subscriptionsService.getUserSubscription(workspaceOwnerId);
    if (!sub?.plan.whatsappEnabled) {
        return { status: 403, code: PLAN_REQUIRED_RESPONSE.code, body: { ...PLAN_REQUIRED_RESPONSE } };
    }
    if (await getWhatsAppUnavailableReason(workspaceOwnerId)) {
        return {
            status: 403,
            code: WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE.code,
            body: { ...WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE },
        };
    }
    if (!subscriptionsService.checkSubscriptionStatus(sub).allowed) {
        return {
            status: 402,
            code: WHATSAPP_SUBSCRIPTION_INACTIVE_RESPONSE.code,
            body: { ...WHATSAPP_SUBSCRIPTION_INACTIVE_RESPONSE },
        };
    }
    return null;
}

/** True when a DB write lost the race to the whatsapp_phone_number_id unique index. */
function isDuplicateNumberError(error: unknown): boolean {
    // NOT a bare `.code` read — drizzle wraps the driver error (see utils/dbErrors).
    return pgErrorCode(error) === PG_UNIQUE_VIOLATION;
}

/**
 * True when Meta refused `POST /{phone-number-id}/register` because the number
 * belongs to a Business-app (SMB) account — «Register endpoint is not available
 * for SMB businesses». That refusal IS the coexistence signal.
 *
 * Matched on the message, not the code, because `metaCode` here is the generic
 * 100 ("Invalid parameter") that dozens of unrelated failures also carry — code
 * alone would swallow real errors. The substring is narrow and the match is
 * case-insensitive; if Meta rewords it the guard simply stops firing and the
 * error surfaces as before, which is the safe direction to fail.
 */
function isSmbRegisterRefusal(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    return /not available for SMB/i.test(message);
}

function metaErrorCode(error: unknown): number | undefined {
    // whatsappService now throws a sanitized WhatsAppApiError carrying `metaCode`;
    // fall back to the raw axios shape for safety (and mocked tests).
    const e = error as { metaCode?: number; response?: { data?: { error?: { code?: number } } } };
    return e.metaCode ?? e.response?.data?.error?.code;
}

/**
 * The post-exchange half of the Embedded Signup sequence, shared by the popup
 * flow (WhatsAppController.runEmbeddedSignup) and the redirect flow
 * (whatsappRedirectController): WABA webhook subscribe → Cloud API registration
 * (migration path only; re-registration with the same derived PIN is idempotent
 * at Meta, and a foreign two-step PIN is the one actionable failure) → phone
 * display info. Coexistence numbers are NEVER registered — Meta onboarded them
 * during ES and registering would take the number off the merchant's phone.
 */
export async function completeWhatsAppSignup(
    accessToken: string,
    phoneNumberId: string,
    wabaId: string,
    coexistence: boolean,
): Promise<
    | { ok: true; info: { displayPhoneNumber: string; verifiedName: string } }
    | { ok: false }
> {
    await whatsappService.subscribeAppToWaba(wabaId, accessToken);
    if (!coexistence) {
        try {
            await whatsappService.registerPhoneNumber(phoneNumberId, accessToken);
        } catch (error) {
            if (metaErrorCode(error) === META_PIN_MISMATCH) {
                return { ok: false };
            }
            // Meta refusing to register BECAUSE the number is an SMB (Business
            // app) number is proof it is a coexistence number, whatever
            // `platform_type` claimed. Registration is the only step coexistence
            // skips, so there is nothing left to do — swallowing it here is not a
            // silenced error, it is the correct no-op. The primary defence is the
            // sticky-coexistence rule at the call site; this is the net for the
            // case where the merchant genuinely asked to migrate a number Meta
            // treats as SMB. Without it, the whole connect dies after the WABA is
            // already subscribed — which is exactly what shipped on 2026-08-29.
            if (isSmbRegisterRefusal(error)) {
                return { ok: true, info: await whatsappService.getPhoneNumberInfo(phoneNumberId, accessToken) };
            }
            throw error;
        }
    }
    const info = await whatsappService.getPhoneNumberInfo(phoneNumberId, accessToken);
    return { ok: true, info };
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
    connect = async (
        request: FastifyRequest<{
            Params: { id: string };
            Body: { code: string; phoneNumberId: string; wabaId: string; coexistence?: boolean };
        }>,
        reply: FastifyReply,
    ) => {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId } = req;
        const { userId } = req.user;
        const { id } = request.params;
        const { code, phoneNumberId, wabaId } = request.body ?? {};
        // Reported by the ES popup from the event Meta actually sent, not from
        // what we requested. Coerced rather than trusted: the only thing it
        // changes is whether we register the number against the Cloud API, and a
        // client lying here would just leave its OWN number unregistered.
        const coexistence = request.body?.coexistence === true;

        if (!code || !phoneNumberId || !wabaId
            || typeof code !== 'string' || typeof phoneNumberId !== 'string' || typeof wabaId !== 'string') {
            return reply.status(400).send({ error: 'code, phoneNumberId and wabaId are required' });
        }

        if (!(await isWhatsAppConnectAllowed(userId))) {
            return reply.status(403).send(NOT_ALLOWLISTED_RESPONSE);
        }
        const refusal = await checkWhatsAppConnectEntitlement(req.workspaceOwnerId);
        if (refusal) {
            request.log.info(
                { workspaceOwnerId: req.workspaceOwnerId, code: refusal.code },
                '[WhatsApp] connect refused by entitlement gate',
            );
            return reply.status(refusal.status).send(refusal.body);
        }

        try {
            const page = await pagesService.getPage(workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            // One WhatsApp number belongs to exactly one page across the platform.
            // Fast pre-check for a clear message; the DB unique index is the real
            // guarantee (catch below) against a concurrent double-connect.
            const holder = await pagesService.getPageByWhatsAppPhoneNumberId(phoneNumberId);
            if (holder && holder.id !== id) {
                return reply.status(409).send(NUMBER_TAKEN_RESPONSE);
            }

            const signup = await this.runEmbeddedSignup(code, phoneNumberId, wabaId, coexistence);
            if (!signup.ok) {
                return reply.status(422).send(PIN_MISMATCH_RESPONSE);
            }

            const updated = await pagesService.connectWhatsApp(workspaceId, id, {
                phoneNumberId,
                businessAccountId: wabaId,
                displayPhoneNumber: signup.info.displayPhoneNumber,
                accessToken: signup.accessToken,
                tokenExpiresAt: signup.tokenExpiresAt,
                coexistence,
            });

            request.log.info(
                { pageId: id, phoneNumberId, wabaId, displayPhoneNumber: signup.info.displayPhoneNumber, tokenExpiresAt: signup.tokenExpiresAt, coexistence },
                '[WhatsApp] Number connected',
            );
            return reply.send(serializePage(updated));
        } catch (error) {
            if (isDuplicateNumberError(error)) {
                return reply.status(409).send(NUMBER_TAKEN_RESPONSE);
            }
            request.log.error(error);
            return reply.status(502).send({
                error: 'Failed to connect WhatsApp. Please try again.',
                code: 'WHATSAPP_CONNECT_FAILED',
            });
        }
    };

    /**
     * Connect a WhatsApp Business number WITHOUT a Facebook page — creates a
     * WhatsApp-only page card (facebookPageId null) that carries the number,
     * its own Business Info and stats.
     * POST /pages/connect-whatsapp
     *
     * Serves WhatsApp-only merchants (Shopify/Salla/Zid sellers with no FB
     * page) and additional numbers for existing merchants: each number is its
     * own card. Created with auto-reply OFF; enabling goes through the same
     * billing + channel-trial gates as any page, so an active card consumes a
     * page slot.
     */
    connectNew = async (
        request: FastifyRequest<{
            Body: { code: string; phoneNumberId: string; wabaId: string; coexistence?: boolean };
        }>,
        reply: FastifyReply,
    ) => {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId } = req;
        const { userId } = req.user;
        const { code, phoneNumberId, wabaId } = request.body ?? {};
        // Reported by the ES popup from the event Meta actually sent, not from
        // what we requested. Coerced rather than trusted: the only thing it
        // changes is whether we register the number against the Cloud API, and a
        // client lying here would just leave its OWN number unregistered.
        const coexistence = request.body?.coexistence === true;

        if (!code || !phoneNumberId || !wabaId
            || typeof code !== 'string' || typeof phoneNumberId !== 'string' || typeof wabaId !== 'string') {
            return reply.status(400).send({ error: 'code, phoneNumberId and wabaId are required' });
        }

        if (!(await isWhatsAppConnectAllowed(userId))) {
            return reply.status(403).send(NOT_ALLOWLISTED_RESPONSE);
        }
        const refusal = await checkWhatsAppConnectEntitlement(req.workspaceOwnerId);
        if (refusal) {
            request.log.info(
                { workspaceOwnerId: req.workspaceOwnerId, code: refusal.code },
                '[WhatsApp] connect refused by entitlement gate',
            );
            return reply.status(refusal.status).send(refusal.body);
        }

        try {
            // One WhatsApp number belongs to exactly one page across the platform.
            // Fast pre-check; the DB unique index (catch below) is the real guard
            // against a concurrent double-connect that both pass this check.
            const holder = await pagesService.getPageByWhatsAppPhoneNumberId(phoneNumberId);
            if (holder) {
                return reply.status(409).send(NUMBER_TAKEN_RESPONSE);
            }

            const signup = await this.runEmbeddedSignup(code, phoneNumberId, wabaId, coexistence);
            if (!signup.ok) {
                return reply.status(422).send(PIN_MISMATCH_RESPONSE);
            }

            const newPage = await pagesService.createWhatsAppOnlyPage(workspaceId, userId, {
                phoneNumberId,
                businessAccountId: wabaId,
                displayPhoneNumber: signup.info.displayPhoneNumber,
                accessToken: signup.accessToken,
                tokenExpiresAt: signup.tokenExpiresAt,
                verifiedName: signup.info.verifiedName,
                coexistence,
            });

            request.log.info(
                { pageId: newPage.id, phoneNumberId, wabaId, displayPhoneNumber: signup.info.displayPhoneNumber },
                '[WhatsApp] WhatsApp-only page created',
            );
            return reply.status(201).send(serializePage(newPage));
        } catch (error) {
            if (isDuplicateNumberError(error)) {
                return reply.status(409).send(NUMBER_TAKEN_RESPONSE);
            }
            request.log.error(error);
            return reply.status(502).send({
                error: 'Failed to connect WhatsApp. Please try again.',
                code: 'WHATSAPP_CONNECT_FAILED',
            });
        }
    };

    /**
     * The Embedded Signup sequence shared by both connect paths:
     * code → business token, WABA webhook subscribe, Cloud API registration
     * (re-registration with the same PIN is idempotent at Meta; a number
     * carrying a foreign two-step PIN is the one actionable failure), then
     * phone display info.
     */
    private async runEmbeddedSignup(
        code: string,
        phoneNumberId: string,
        wabaId: string,
        coexistence = false,
    ): Promise<
        | { ok: true; accessToken: string; tokenExpiresAt: Date | null; info: { displayPhoneNumber: string; verifiedName: string } }
        | { ok: false }
    > {
        const { token: accessToken, expiresIn } = await whatsappService.exchangeCodeForToken(code);
        // Meta forces a 60-day expiry on this login variation, so record the deadline
        // now — it is the only moment we are told it. NULL when Meta reports no
        // expiry, which the health sweep reads as "no deadline to warn about".
        const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

        const completed = await completeWhatsAppSignup(accessToken, phoneNumberId, wabaId, coexistence);
        if (!completed.ok) return { ok: false };
        return { ok: true, accessToken, tokenExpiresAt, info: completed.info };
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
                if (!(await hasWhatsAppPlanAccess(workspaceOwnerId))) {
                    return reply.status(403).send(PLAN_REQUIRED_RESPONSE);
                }
                if (await getWhatsAppUnavailableReason(workspaceOwnerId)) {
                    return reply.status(403).send(WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE);
                }

                // A WhatsApp-only card is born with NO Business Info — there is no
                // Facebook page to seed it from — so without this the GA happy path
                // is "connect a number, AI starts answering customers with nothing
                // to answer from".
                //
                // Ordered AFTER the plan gate and BEFORE the page-limit/trial gates:
                // WhatsApp needs Business/Pro/Scale, so a Starter merchant must be
                // told to upgrade (filling Business Info would not unlock it), but a
                // merchant who IS entitled should hear about the thing they can
                // actually fix rather than a seat count.
                const infoGate = await businessInfoGate(existingPage);
                if (infoGate) return reply.status(infoGate.status).send(infoGate.body);

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
                // Activation funnel (D-026): same emit as the FB page toggle — the
                // gate counts whatsappAutoReplyEnabled, and WhatsApp-only pages are
                // born with every other toggle off, so this endpoint can be the step
                // that makes the pipeline effective.
                if (page.userId) {
                    void recordAutoreplyEnabledIfEffective(page.userId, workspaceId, { pageId: page.id, source: 'page_toggle' });
                }
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle WhatsApp auto-reply' });
        }
    }
}

export const whatsappController = new WhatsAppController();
