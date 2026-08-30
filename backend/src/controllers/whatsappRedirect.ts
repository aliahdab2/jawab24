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
    WHATSAPP_STATE_TTL_MS,
    type WhatsAppConnectState,
} from '../utils/whatsappConnectState';
import { issueSingleUse, consumeSingleUse } from '../lib/singleUseKey';
import {
    completeWhatsAppSignup,
    hasWhatsAppPlanAccess,
    isWhatsAppConnectAllowed,
    PLAN_REQUIRED_RESPONSE,
} from './whatsapp';
import { getWhatsAppUnavailableReason, WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE } from '../services/whatsappAvailability';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import { authService } from '../services/auth';
import { refreshTokenService } from '../services/refreshToken';
import { cookiesService } from '../services/cookies';
import { workspaceService } from '../services/workspace';
import { escapeHtml } from '../utils/htmlUtils';
import { t } from '../utils/i18n';
import { appReturnPage } from '../utils/appReturnPage';
import { isUniqueViolation } from '../utils/dbErrors';

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
 * phone numbers). Coexistence comes from the SIGNED REQUEST, with Meta's
 * `platform_type` able only to add it — see the callback for why that field
 * cannot be trusted to remove it.
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

/**
 * The handoff page the NATIVE app lands the system browser on.
 *
 * Why a page and not a 302 straight to Meta: on the owner's device, a
 * navigation to facebook.com issued by anything other than the merchant's own
 * tap — a page-side `location.assign` (Custom Tab 2026-07-30, intent-opened
 * Chrome 2026-07-31) or a server 302 (2026-07-31) — never rendered Meta's
 * dialog; the browser flashed and returned to the app, with no request
 * reaching us afterwards. A REAL anchor click is the most privileged
 * navigation a browser has, and it is the one shape not yet tried.
 *
 * There is deliberately NO automatic redirect on this page: an auto-attempt
 * that gets intercepted bounces the merchant away before they ever see the
 * button, which is exactly the dead end we are escaping — and it would also
 * destroy the diagnostic value of "did the page render and stay?".
 *
 * Self-contained markup (no bundle, no fonts, no JS) so it paints instantly
 * over mobile data and cannot fail on a blocked asset.
 */
function handoffPage(dialogUrl: string, locale: 'ar' | 'en'): string {
    const rtl = locale === 'ar';
    return `<!DOCTYPE html>
<html lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${config.frontendUrl}/brand/favicon-32x32.png">
<title>${escapeHtml(t('waHandoffTitle', locale))}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         padding:24px; box-sizing:border-box; background:#f8fafc; color:#0f172a;
         font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:420px; width:100%; text-align:center; background:#fff; border-radius:16px;
          padding:32px 24px; box-shadow:0 4px 24px rgba(15,23,42,.08); }
  /* Square box reserved up front — the mark loads over mobile data and must
     not shove the CTA down under the merchant's thumb mid-tap. */
  .mark { width:64px; height:64px; margin:0 auto 16px; display:block; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { font-size:15px; line-height:1.6; margin:0 0 24px; color:#475569; }
  a.cta { display:block; background:#0f9d76; color:#fff; text-decoration:none; font-size:17px;
          font-weight:600; padding:16px 24px; border-radius:12px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f172a; color:#f1f5f9; }
    .card { background:#1e293b; box-shadow:none; }
    p { color:#94a3b8; }
  }
</style>
</head>
<body>
  <main class="card">
    <img class="mark" width="64" height="64" src="${config.frontendUrl}/brand/icon-vector.svg" alt="Jawab24">
    <h1>${escapeHtml(t('waHandoffTitle', locale))}</h1>
    <p>${escapeHtml(t('waHandoffBody', locale))}</p>
    <a class="cta" href="${escapeHtml(dialogUrl)}">${escapeHtml(t('waHandoffCta', locale))}</a>
  </main>
</body>
</html>`;
}

/**
 * Single-use registry for APP-minted states.
 *
 * The web flow binds a state to one browser with the nonce cookie; the app
 * flow cannot (the cookie lands in the WebView's jar, the callback arrives in
 * the browser's), so without a replacement an app state would be replayable
 * for its whole 30-minute TTL by anyone who obtained it — from browser history
 * or the URL it travels in — and a replay attaches the REPLAYER's WhatsApp
 * number to the victim's workspace, since the callback's ownership re-verify
 * checks the state's user, not the caller's.
 *
 * So app states are consumed exactly once instead. Single-use is a strictly
 * stronger property than the same-browser binding it replaces, and it reuses
 * the pattern already proven by the browser-handoff code.
 */
const appStateKey = (nonce: string) => `wa:appstate:${nonce}`;

const registerAppState = (nonce: string) => issueSingleUse(appStateKey(nonce), '1', WHATSAPP_STATE_TTL_MS);

/** True exactly once per minted state; false for replays, expiry, or unknown. */
const consumeAppState = async (nonce: string) => (await consumeSingleUse(appStateKey(nonce))) === '1';

/**
 * Where an APP-initiated connect returns to.
 *
 * The /auth/app-sync App Link is Android-verified (assetlinks.json), so it
 * reopens Jawab24 and closes the browser tab — the same return leg the shipped
 * Facebook page-connect flow uses. No token rides it: the app never lost its
 * session (it only lent the browser one), so `_app.tsx` just navigates to the
 * intent. `redirect` is locale-less, matching the Facebook flow's contract.
 */
function appReturn(params: Record<string, string>): string {
    const qs = Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
    return `${config.frontendUrl}/auth/app-sync?redirect=${encodeURIComponent(`/pages${qs}`)}`;
}

/*
 * …delivered as a PAGE that navigates, not as a 302 — the shared
 * `utils/appReturnPage` document (observed 2026-07-31: an App Link sent as a
 * `Location:` header renders the web fallback with a 200 and leaves the
 * merchant in the browser; only a page-started navigation is intercepted).
 */

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
        request: FastifyRequest<{ Body: { pageId?: string | null; coexistence?: boolean; locale?: string; nativeApp?: boolean } }>,
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

        const prep = await this.prepareStartUrls({
            userId: req.user.userId,
            workspaceId: req.workspaceId,
            workspaceOwnerId: req.workspaceOwnerId,
            pageId: typeof request.body?.pageId === 'string' && request.body.pageId ? request.body.pageId : null,
            coexistence: request.body?.coexistence === true,
            locale: request.body?.locale === 'en' ? 'en' : 'ar',
            // The native app opens the dialog in its own browser tab, so the
            // nonce cookie set on THIS response never reaches the callback —
            // the state records that, and the callback returns via App Link.
            app: request.body?.nativeApp === true,
            reply,
        });
        if (!prep.ok) {
            return reply.status(prep.status).send(prep.payload);
        }

        request.log.info({ pageId: prep.pageId, coexistence: prep.coexistence, locale: prep.locale }, '[WhatsApp redirect] start');
        // `url` preserves the original single-URL contract (the requested
        // variant) for clients built before the pre-mint change.
        return reply.send({ url: prep.url, urls: prep.urls });
    };

    /**
     * Shared core of the two start legs: gates → reconnect path-lock → mint
     * both state variants bound to ONE nonce cookie → dialog URLs. The POST
     * /start leg wraps failures in the JSON error contract; the GET /app-start
     * leg turns them into `?whatsappError=` redirects (it is a navigation).
     */
    private async prepareStartUrls(args: {
        userId: string;
        workspaceId: string;
        workspaceOwnerId: string;
        pageId: string | null;
        coexistence: boolean;
        locale: 'ar' | 'en';
        /** Minted for the native app: no nonce pairing, App-Link return. */
        app?: boolean;
        reply: FastifyReply;
    }): Promise<
        | { ok: true; url: string; urls: { coexistence: string; dedicated: string }; coexistence: boolean; pageId: string | null; locale: 'ar' | 'en' }
        | { ok: false; status: number; code: string; payload: Record<string, unknown> }
    > {
        if (!config.whatsappConfigId) {
            return { ok: false, status: 500, code: 'WHATSAPP_CONNECT_FAILED', payload: { error: 'WhatsApp connect is not configured', code: 'WHATSAPP_CONNECT_FAILED' } };
        }
        if (!(await isWhatsAppConnectAllowed(args.userId))) {
            return { ok: false, status: 403, code: 'WHATSAPP_NOT_ALLOWLISTED', payload: { error: 'WhatsApp isn\'t available on your account yet.', code: 'WHATSAPP_NOT_ALLOWLISTED' } };
        }
        if (!(await hasWhatsAppPlanAccess(args.workspaceOwnerId))) {
            return { ok: false, status: 403, code: PLAN_REQUIRED_RESPONSE.code, payload: { ...PLAN_REQUIRED_RESPONSE } };
        }
        if (await getWhatsAppUnavailableReason(args.workspaceOwnerId)) {
            return { ok: false, status: 403, code: WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE.code, payload: { ...WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE } };
        }

        const { pageId, locale } = args;
        let coexistence = args.coexistence;
        // Reconnect: the onboarding path is FIXED by the connected number —
        // both minted variants must collapse onto the stored value.
        let pathLocked = false;
        if (pageId) {
            const page = await pagesService.getPage(args.workspaceId, pageId);
            if (!page) {
                return { ok: false, status: 404, code: 'WHATSAPP_CONNECT_FAILED', payload: { error: 'Page not found' } };
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
            userId: args.userId,
            workspaceId: args.workspaceId,
            pageId,
            locale,
            ...(args.app ? { app: true as const } : {}),
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
        if (args.app) {
            // No cookie can bind an app state to its browser — bind it to ONE
            // use instead (see registerAppState). Siblings share the nonce, so
            // whichever variant the merchant took, the pair is spent together.
            await registerAppState(first.nonce);
        } else {
            args.reply.setCookie(WHATSAPP_NONCE_COOKIE, first.nonce, WHATSAPP_NONCE_COOKIE_OPTIONS);
        }

        const urls = {
            coexistence: buildUrl(first.state, coexistenceVariant),
            dedicated: buildUrl(second.state, dedicatedVariant),
        };

        return { ok: true, url: coexistence ? urls.coexistence : urls.dedicated, urls, coexistence, pageId, locale };
    }

    /**
     * GET /auth/whatsapp/app-start — PUBLIC: the native app's connect leg.
     *
     * The app asks the onboarding-path question IN-APP, then opens the system
     * browser here with a single-use handoff code. This handler consumes the
     * code, signs the browser in (cookies — so the callback's return page
     * renders logged-in), mints the state + nonce cookie, and serves the
     * handoff page whose single anchor carries the merchant to Meta.
     *
     * The last hop is a real TAP for a reason: on the owner's device every
     * non-tap navigation to facebook.com from an app-launched browser died
     * silently (page-side location.assign in a Custom Tab and in an
     * intent-opened Chrome tab, and a server 302) — see handoffPage.
     *
     * Owner-only, like POST /start: the ES business token is workspace-level
     * credential material. Enforced here via the membership role, since a
     * top-level navigation carries no session for the middleware chain.
     */
    appStart = async (
        request: FastifyRequest<{ Querystring: { code?: string; pageId?: string; coexistence?: string; locale?: string; workspaceId?: string } }>,
        reply: FastifyReply,
    ) => {
        if (!config.whatsappConnectRedirect) {
            return reply.status(404).send({ error: 'Not found' });
        }
        const q = request.query;
        const locale: 'ar' | 'en' = q.locale === 'en' ? 'en' : 'ar';
        const fail = (code: string) => reply.redirect(pagesRedirect(locale, { whatsappError: code }));

        const redeemed = await authService.consumeBrowserHandoffCode(typeof q.code === 'string' ? q.code : '');
        if (!redeemed) {
            // Expired/used code: the browser has no session to show an error
            // toast with — land on login, where a signed-in user bounces to
            // the dashboard anyway.
            return reply.redirect(`${config.frontendUrl}${localePath(locale)}/login`);
        }
        // A restricted embedded session must not reach this flow at all. It signs
        // the browser in with a FULL session below (refresh cookie included) and
        // hands over workspace-level WhatsApp credential material — precisely what
        // an iframe credential is not allowed to buy. Embedded merchants connect
        // WhatsApp from a real login, not from the platform dashboard.
        if (redeemed.scope) {
            request.log.warn(
                { embeddedPlatform: redeemed.scope.embeddedPlatform },
                'WhatsApp app-start refused: handoff code was minted by a restricted embedded session',
            );
            return reply.redirect(`${config.frontendUrl}${localePath(locale)}/login`);
        }
        const userId = redeemed.userId;
        const user = await authService.getUserById(userId);
        if (!user) {
            return reply.redirect(`${config.frontendUrl}${localePath(locale)}/login`);
        }

        // Sign the browser in FIRST (same artifacts as the login exit): even a
        // gate failure below then lands on /pages authenticated, where the
        // whatsappError toast can render — and after the wizard, Meta's 302
        // back to /pages finds a live session.
        const token = authService.generateToken(user);
        const refreshToken = await refreshTokenService.createRefreshToken(user.id);
        cookiesService.setAuthCookies(reply, token);
        cookiesService.setRefreshTokenCookie(reply, refreshToken);

        let workspaceId = typeof q.workspaceId === 'string' && q.workspaceId ? q.workspaceId : null;
        if (!workspaceId) {
            workspaceId = await workspaceService.resolveDefaultWorkspaceId(userId);
        }
        if (!workspaceId) {
            return fail('WHATSAPP_CONNECT_FAILED');
        }
        const member = await workspaceService.getMemberRole(workspaceId, userId);
        if (!member || member.role !== 'owner') {
            // Same owner scope as POST /start — the ES token is credential material.
            return fail('WHATSAPP_CONNECT_FAILED');
        }
        const workspace = await workspaceService.getWorkspace(workspaceId);
        if (!workspace) {
            return fail('WHATSAPP_CONNECT_FAILED');
        }

        const prep = await this.prepareStartUrls({
            userId,
            workspaceId,
            workspaceOwnerId: workspace.ownerId,
            pageId: typeof q.pageId === 'string' && q.pageId ? q.pageId : null,
            coexistence: q.coexistence === 'true' || q.coexistence === '1',
            locale,
            reply,
        });
        if (!prep.ok) {
            return fail(prep.code);
        }

        request.log.info({ pageId: prep.pageId, coexistence: prep.coexistence, locale }, '[WhatsApp redirect] app-start');
        // Render the handoff page rather than 302ing to Meta — see handoffPage.
        return reply.type('text/html; charset=utf-8').send(handoffPage(prep.url, locale));
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

        // App flow goes home through the App Link — served as a PAGE that
        // navigates, because a 302 to it is not intercepted (see
        // appReturnPage). Web flow keeps the plain redirect.
        const home = (params: Record<string, string> = {}) => (state.app
            ? reply.type('text/html; charset=utf-8').send(appReturnPage(appReturn(params), state.locale))
            : reply.redirect(pagesRedirect(state.locale, params)));
        const fail = (errorCode: string) => home({ whatsappError: errorCode });

        // Replay defence, one per flow. `state.app` is inside the HMAC, so a
        // web-minted state can never take the app branch.
        //   web — nonce double-submit: the state was minted for THIS browser.
        //   app — single use: the cookie pair cannot exist across the WebView /
        //         browser jar boundary, so the state is spent instead
        //         (registerAppState). Strictly stronger than same-browser
        //         binding, and it closes the replay window that simply dropping
        //         the nonce would have left open for the state's full TTL.
        const rawCookie = request.cookies?.[WHATSAPP_NONCE_COOKIE];
        const unsigned = rawCookie ? request.unsignCookie(rawCookie) : null;
        reply.clearCookie(WHATSAPP_NONCE_COOKIE, { path: '/' });
        if (state.app) {
            if (!(await consumeAppState(state.nonce))) {
                request.log.warn('[WhatsApp redirect] app state already used or expired');
                return fail('WHATSAPP_CONNECT_FAILED');
            }
        } else if (!unsigned?.valid || unsigned.value !== state.nonce) {
            request.log.warn('[WhatsApp redirect] nonce mismatch on callback');
            return fail('WHATSAPP_CONNECT_FAILED');
        }

        // Merchant backed out inside the wizard — not an error, just go home.
        if (oauthError || !code || typeof code !== 'string') {
            return home();
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

            // Coexistence is STICKY: a number the merchant explicitly onboarded as
            // a coexistence number must NEVER be Cloud-registered, because
            // registering takes it off their phone. Meta's `platform_type` may only
            // ADD coexistence (SMB_APP when a migration request was ignored) — it
            // may never remove it.
            //
            // This used to read the other way round: CLOUD_API overrode the signed
            // request, on the assumption that the field is authoritative once the
            // wizard has finished. It is NOT. On 2026-08-29 the first real
            // coexistence connect in production came back `platform_type:
            // CLOUD_API` for a number Meta then refused to register — «Register
            // endpoint is not available for SMB businesses» (metaCode 100), i.e.
            // Meta itself classified the very same number as SMB. Every coexistence
            // connect died on that line, and the merchant was left with a number
            // linked at Meta and no page here.
            const coexistence = state.coexistence || candidate.platformType === 'SMB_APP';
            if (state.coexistence && candidate.platformType !== 'SMB_APP') {
                request.log.warn(
                    { phoneNumberId: candidate.id, platformType: candidate.platformType ?? null },
                    '[WhatsApp redirect] platform_type did not confirm coexistence; honouring the requested path',
                );
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
            return home({ whatsappConnected: '1', waPageId: pageId });
        } catch (error) {
            // NOT a bare `.code` read — drizzle wraps the driver error (see utils/dbErrors).
            if (isUniqueViolation(error)) {
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
        if (await getWhatsAppUnavailableReason(membership[0].ownerId)) {
            return WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE.code;
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
