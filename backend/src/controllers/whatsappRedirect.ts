import { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { workspaceMembers, workspaces } from '../db/schema';
import { config } from '../config';
import { pagesService } from '../services/pages';
import { whatsappService } from '../services/whatsapp';
import { WHATSAPP_NONCE_COOKIE_OPTIONS } from '../services/cookies';
import {
    mintWhatsAppConnectState,
    verifyWhatsAppConnectState,
    type WhatsAppConnectState,
} from '../utils/whatsappConnectState';
import {
    completeWhatsAppSignup,
    hasWhatsAppPlanAccess,
    isWhatsAppConnectAllowed,
} from './whatsapp';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

/**
 * WhatsApp connect via FULL-PAGE redirect Embedded Signup.
 *
 * Why this exists: the popup flow (`fb.login`) cannot run in the Capacitor
 * WebView and opens unreliably in phone browsers (mobile Chrome never painted
 * the wizard — 2026-07-30). A full-page navigation to the same ES dialog needs
 * no popup anywhere, which is Meta's own popup-free pattern (manual OAuth flow
 * with config_id). Verified rendering full-page in mobile Chrome on a real
 * device before this was built.
 *
 * The trade: no `postMessage` session info, so the callback discovers the
 * connected assets from the token itself (debug_token granular scopes → WABA →
 * phone numbers) and reads coexistence from Meta's `platform_type` outcome.
 *
 * Rollout flag: `WHATSAPP_CONNECT_REDIRECT` — off = both routes 404 and the
 * popup flow remains the only path (instant rollback).
 */

export const WHATSAPP_NONCE_COOKIE = 'waConnectNonce';

/** How many WABAs we are willing to enumerate before calling it ambiguous. */
const MAX_WABA_CANDIDATES = 5;

function localePath(locale: 'ar' | 'en'): string {
    // Mirrors frontend buildWebUrl: Arabic is the default (no prefix).
    return locale === 'en' ? '/en' : '';
}

function pagesRedirect(locale: 'ar' | 'en', params?: Record<string, string>): string {
    const qs = params && Object.keys(params).length > 0
        ? `?${new URLSearchParams(params).toString()}`
        : '';
    return `${config.frontendUrl}${localePath(locale)}/pages${qs}`;
}

/** The redirect_uri registered at Meta. Must match byte-for-byte on both legs. */
export function whatsappCallbackUri(): string {
    return `${config.publicApiBaseUrl}/auth/whatsapp/callback`;
}

interface PhoneCandidate {
    wabaId: string;
    id: string;
    displayPhoneNumber: string;
    verifiedName: string;
    platformType?: string;
    lastOnboardedTime?: string;
}

/**
 * Pick the phone number this signup just produced.
 * Exactly one candidate → it. Several → the strictly most recently onboarded.
 * No usable ordering → null (the caller surfaces WHATSAPP_AMBIGUOUS — we never
 * guess, because phone_number_id is the webhook routing key and a wrong pick
 * silently kills inbound delivery).
 */
export function pickPhoneCandidate(candidates: PhoneCandidate[]): PhoneCandidate | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const dated = candidates.filter(c => c.lastOnboardedTime);
    if (dated.length === 0) return null;
    const sorted = [...dated].sort((a, b) => (b.lastOnboardedTime as string).localeCompare(a.lastOnboardedTime as string));
    if (sorted.length > 1 && sorted[0].lastOnboardedTime === sorted[1].lastOnboardedTime) return null;
    return sorted[0];
}

export class WhatsAppRedirectController {
    /**
     * POST /auth/whatsapp/start — authenticated (owner scope, same middleware
     * chain as the popup connect endpoints). Runs the same gate order as
     * `connect` UP FRONT so a blocked merchant fails here with the familiar
     * JSON error contract instead of mid-wizard, then mints the signed state +
     * nonce cookie and returns the dialog URL for a full-page navigation.
     */
    start = async (
        request: FastifyRequest<{ Body: { pageId?: string | null; coexistence?: boolean; locale?: string } }>,
        reply: FastifyReply,
    ) => {
        if (!config.whatsappConnectRedirect) {
            return reply.status(404).send({ error: 'Not found' });
        }
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        if (!config.whatsappConfigId) {
            request.log.error('[WhatsApp redirect] WHATSAPP_CONFIG_ID is not configured');
            return reply.status(500).send({ error: 'WhatsApp connect is not configured', code: 'WHATSAPP_CONNECT_FAILED' });
        }

        if (!(await isWhatsAppConnectAllowed(req.user.userId))) {
            return reply.status(403).send({ error: 'WhatsApp isn\'t available on your account yet.', code: 'WHATSAPP_NOT_ALLOWLISTED' });
        }
        if (!(await hasWhatsAppPlanAccess(req.workspaceOwnerId))) {
            return reply.status(403).send({ error: 'WhatsApp requires the Business plan or higher.', code: 'WHATSAPP_PLAN_REQUIRED', requiredPlan: 'business' });
        }

        const pageId = typeof request.body?.pageId === 'string' && request.body.pageId ? request.body.pageId : null;
        let coexistence = request.body?.coexistence === true;
        // Reconnect: the onboarding path is FIXED by the connected number —
        // both minted variants must collapse onto the stored value.
        let pathLocked = false;
        if (pageId) {
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            // RECONNECT MUST PRESERVE THE ONBOARDING PATH — enforced server-side,
            // not trusted from the client: re-running ES without coexistence puts
            // Meta on the migration path and takes a live coexistence number off
            // the merchant's phone, permanently and silently.
            if (page.whatsappPhoneNumberId) {
                coexistence = page.whatsappCoexistence === true;
                pathLocked = true;
            }
        }
        const locale: 'ar' | 'en' = request.body?.locale === 'en' ? 'en' : 'ar';

        // Mint BOTH onboarding variants up front, bound to ONE nonce cookie.
        // The path-question modal calls start when it OPENS, so the chosen URL
        // can be navigated to SYNCHRONOUSLY with the merchant's tap — mobile
        // Chrome silently ignored a location.assign issued after the start
        // round-trip (observed live 2026-07-30: four minted URLs, zero
        // navigations), and a gesture-synchronous navigation is the only shape
        // browsers never second-guess. On a reconnect both variants carry the
        // STORED path (the override above), so whichever the client uses is
        // safe. The dialog URL has no `scope` param — a Facebook Login for
        // Business configuration defines its own permissions; `extras` mirrors
        // the popup's fb.login extras.
        const stateInput = {
            userId: req.user.userId,
            workspaceId: req.workspaceId,
            pageId,
            locale,
        };
        const buildUrl = (state: string, withCoexistence: boolean): string => {
            const extras = JSON.stringify({
                setup: {},
                featureType: withCoexistence ? 'whatsapp_business_app_onboarding' : '',
                sessionInfoVersion: '3',
            });
            const params = new URLSearchParams({
                client_id: config.facebook.appId,
                config_id: config.whatsappConfigId,
                redirect_uri: whatsappCallbackUri(),
                state,
                response_type: 'code',
                extras,
            });
            return `https://www.facebook.com/${config.facebook.graphApiVersion}/dialog/oauth?${params.toString()}`;
        };
        // Reconnect: both variants collapse onto the stored path (pathLocked).
        const coexistenceVariant = pathLocked ? coexistence : true;
        const dedicatedVariant = pathLocked ? coexistence : false;
        const first = mintWhatsAppConnectState({ ...stateInput, coexistence: coexistenceVariant });
        const second = mintWhatsAppConnectState({ ...stateInput, coexistence: dedicatedVariant }, first.nonce);
        reply.setCookie(WHATSAPP_NONCE_COOKIE, first.nonce, WHATSAPP_NONCE_COOKIE_OPTIONS);

        const urls = {
            coexistence: buildUrl(first.state, coexistenceVariant),
            dedicated: buildUrl(second.state, dedicatedVariant),
        };

        request.log.info({ pageId, coexistence, locale }, '[WhatsApp redirect] start');
        // `url` preserves the original single-URL contract (the requested
        // variant) for clients built before the pre-mint change.
        return reply.send({ url: coexistence ? urls.coexistence : urls.dedicated, urls });
    };

    /**
     * GET /auth/whatsapp/callback — PUBLIC: a top-level 302 from facebook.com,
     * carrying `code` + our signed `state`. No Authorization header exists on a
     * navigation, so identity and context come exclusively from the state
     * (self-authenticating HMAC) double-checked against the nonce cookie, and
     * the workspace-owner role is RE-VERIFIED against the DB — never trusted
     * from a 10-minute-old assertion.
     *
     * Every outcome is a 302 back to /pages: `?whatsappConnected=1&waPageId=…`
     * on success, `?whatsappError=<code>` on failure (it is a navigation — a
     * JSON body would strand the merchant on a blank API page).
     */
    callback = async (
        request: FastifyRequest<{
            Querystring: { code?: string; state?: string; error?: string; error_description?: string };
        }>,
        reply: FastifyReply,
    ) => {
        if (!config.whatsappConnectRedirect) {
            return reply.status(404).send({ error: 'Not found' });
        }
        const { code, state: rawState, error: oauthError } = request.query ?? {};

        // Without a VERIFIED state there is no trusted locale either — fall back
        // to the site default (Arabic, no prefix).
        const state = typeof rawState === 'string' ? verifyWhatsAppConnectState(rawState) : null;
        if (!state) {
            request.log.warn('[WhatsApp redirect] callback with missing/invalid/expired state');
            return reply.redirect(pagesRedirect('ar', { whatsappError: 'WHATSAPP_CONNECT_FAILED' }));
        }

        const fail = (errorCode: string) => reply.redirect(pagesRedirect(state.locale, { whatsappError: errorCode }));

        // Nonce double-submit: the state must have been minted for THIS browser.
        const rawCookie = request.cookies?.[WHATSAPP_NONCE_COOKIE];
        const unsigned = rawCookie ? request.unsignCookie(rawCookie) : null;
        reply.clearCookie(WHATSAPP_NONCE_COOKIE, { path: '/' });
        if (!unsigned?.valid || unsigned.value !== state.nonce) {
            request.log.warn('[WhatsApp redirect] nonce mismatch on callback');
            return fail('WHATSAPP_CONNECT_FAILED');
        }

        // Merchant backed out inside the wizard — not an error, just go home.
        if (oauthError || !code || typeof code !== 'string') {
            return reply.redirect(pagesRedirect(state.locale));
        }

        try {
            const gate = await this.reverifyGates(state);
            if (gate) return fail(gate);

            // 30-second code TTL: the exchange happens right here in the callback,
            // before any other I/O that isn't strictly required.
            const { token: accessToken, expiresIn } = await whatsappService.exchangeCodeForToken(code, whatsappCallbackUri());
            const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

            const picked = await this.discoverPhoneNumber(accessToken, request);
            if (!picked.ok) return fail(picked.error);
            const candidate = picked.candidate;

            // Coexistence is Meta's OUTCOME, read from the number itself: SMB_APP =
            // the number still lives on the merchant's phone (never Cloud-register
            // it), CLOUD_API = migrated. When Meta omits platform_type we fall back
            // to the REQUESTED path from the signed state — safe in the dangerous
            // direction, because a coexistence request never registers, and a
            // migration request only produces SMB_APP if Meta ignored the requested
            // featureType, which the wizard does not do.
            const coexistence = candidate.platformType === 'SMB_APP'
                ? true
                : candidate.platformType === 'CLOUD_API'
                    ? false
                    : state.coexistence;
            if (candidate.platformType === undefined) {
                request.log.warn({ phoneNumberId: candidate.id }, '[WhatsApp redirect] platform_type missing; using requested path');
            }

            // One number = one page, platform-wide. Same-page reconnect is allowed.
            const holder = await pagesService.getPageByWhatsAppPhoneNumberId(candidate.id);
            if (holder && holder.id !== state.pageId) {
                return fail('WHATSAPP_NUMBER_TAKEN');
            }

            const completed = await completeWhatsAppSignup(accessToken, candidate.id, candidate.wabaId, coexistence);
            if (!completed.ok) {
                return fail('WHATSAPP_PIN_MISMATCH');
            }

            let pageId: string;
            if (state.pageId) {
                const updated = await pagesService.connectWhatsApp(state.workspaceId, state.pageId, {
                    phoneNumberId: candidate.id,
                    businessAccountId: candidate.wabaId,
                    displayPhoneNumber: completed.info.displayPhoneNumber,
                    accessToken,
                    tokenExpiresAt,
                    coexistence,
                });
                pageId = updated.id;
            } else {
                const created = await pagesService.createWhatsAppOnlyPage(state.workspaceId, state.userId, {
                    phoneNumberId: candidate.id,
                    businessAccountId: candidate.wabaId,
                    displayPhoneNumber: completed.info.displayPhoneNumber,
                    accessToken,
                    tokenExpiresAt,
                    verifiedName: completed.info.verifiedName,
                    coexistence,
                });
                pageId = created.id;
            }

            request.log.info(
                { pageId, phoneNumberId: candidate.id, wabaId: candidate.wabaId, coexistence, tokenExpiresAt },
                '[WhatsApp redirect] Number connected',
            );
            return reply.redirect(pagesRedirect(state.locale, { whatsappConnected: '1', waPageId: pageId }));
        } catch (error) {
            if ((error as { code?: string })?.code === '23505') {
                return fail('WHATSAPP_NUMBER_TAKEN');
            }
            request.log.error(error, '[WhatsApp redirect] callback failed');
            return fail('WHATSAPP_CONNECT_FAILED');
        }
    };

    /**
     * The `start` gates, re-run at callback time: ~10 minutes have passed and
     * the state is only an assertion about the past. Ownership is checked
     * against the live membership row (state's role claims are never trusted).
     * Returns an error code, or null when all gates pass.
     */
    private async reverifyGates(state: WhatsAppConnectState): Promise<string | null> {
        const membership = await db
            .select({ role: workspaceMembers.role, ownerId: workspaces.ownerId })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
            .where(and(
                eq(workspaceMembers.workspaceId, state.workspaceId),
                eq(workspaceMembers.userId, state.userId),
            ))
            .limit(1);
        if (membership.length === 0 || membership[0].role !== 'owner') {
            return 'WHATSAPP_CONNECT_FAILED';
        }
        if (!(await isWhatsAppConnectAllowed(state.userId))) {
            return 'WHATSAPP_NOT_ALLOWLISTED';
        }
        if (!(await hasWhatsAppPlanAccess(membership[0].ownerId))) {
            return 'WHATSAPP_PLAN_REQUIRED';
        }
        if (state.pageId) {
            const page = await pagesService.getPage(state.workspaceId, state.pageId);
            if (!page) return 'WHATSAPP_CONNECT_FAILED';
        }
        return null;
    }

    /**
     * Redirect-mode asset discovery: the popup's postMessage session info does
     * not exist here, so the WABA(s) come from the token's granular scopes and
     * the number from /{waba}/phone_numbers.
     */
    private async discoverPhoneNumber(
        accessToken: string,
        request: FastifyRequest,
    ): Promise<{ ok: true; candidate: PhoneCandidate } | { ok: false; error: string }> {
        const debug = await whatsappService.debugToken(accessToken);
        const wabaIds = debug.wabaIds.slice(0, MAX_WABA_CANDIDATES);
        if (wabaIds.length === 0) {
            // Signup finished without granting a WABA (e.g. abandoned before the
            // number step, or WABA created with the phone still pending review).
            return { ok: false, error: 'WHATSAPP_NO_NUMBER' };
        }
        const perWaba = await Promise.all(wabaIds.map(async wabaId => {
            const numbers = await whatsappService.listWabaPhoneNumbers(wabaId, accessToken);
            return numbers.map(n => ({ ...n, wabaId }));
        }));
        const candidates: PhoneCandidate[] = perWaba.flat();
        if (candidates.length === 0) {
            return { ok: false, error: 'WHATSAPP_NO_NUMBER' };
        }
        const candidate = pickPhoneCandidate(candidates);
        if (!candidate) {
            request.log.warn({ wabaCount: wabaIds.length, numberCount: candidates.length }, '[WhatsApp redirect] ambiguous phone candidates');
            return { ok: false, error: 'WHATSAPP_AMBIGUOUS' };
        }
        return { ok: true, candidate };
    }
}

export const whatsappRedirectController = new WhatsAppRedirectController();
