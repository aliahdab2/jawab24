import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { instagramLoginService, InstagramLoginError } from '../services/instagramLogin';
import { pagesService } from '../services/pages';
import { subscriptionsService } from '../services/subscriptions';
import { issueSingleUse, consumeSingleUse } from '../lib/singleUseKey';
import { appReturnPage } from '../utils/appReturnPage';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

/**
 * Instagram-DIRECT connect (Instagram Login, no Facebook Page).
 *
 * Shape follows the proven app→browser→Meta contract (Rule 17b, learned the
 * hard way on WhatsApp):
 *  - the browser tab's FIRST document is instagram.com — the app opens the
 *    authorize URL returned by /start, never a page-side location.assign;
 *  - the return leg SERVES A PAGE whose script navigates to the /auth/app-sync
 *    App Link — never a 302 Location header (Android ignores those);
 *  - cookie jars don't cross app↔browser, so the replay defence is single-use
 *    state in Redis (lib/singleUseKey), not a cookie pair.
 */

/** Single-use connect state: nonce → the identity that minted it. */
const igStateKey = (nonce: string) => `ig:state:${nonce}`;
const IG_STATE_TTL_MS = 15 * 60 * 1000;

interface IgConnectState {
    userId: string;
    workspaceId: string;
    locale: 'ar' | 'en';
}

/**
 * The return leg: the shared app-return document (`utils/appReturnPage`) —
 * a page whose SCRIPT navigates to the App Link (a page navigation is
 * interceptable by Android; a server redirect is not). This wrapper only
 * builds the /pages?{qs} destination the Instagram flow returns to.
 */
function igReturnPage(params: Record<string, string>, locale: 'ar' | 'en'): string {
    const qs = Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
    const appSyncUrl = `${config.frontendUrl}/auth/app-sync?redirect=${encodeURIComponent(`/pages${qs}`)}`;
    return appReturnPage(appSyncUrl, locale);
}

export class InstagramConnectController {
    /**
     * POST /auth/instagram/start — authenticated, owner only. Runs the gates up
     * front (configured? page slot available?) so the merchant fails here with
     * the familiar JSON contract instead of mid-OAuth, then mints the
     * single-use state and returns the instagram.com authorize URL for the
     * client to open as the tab's first document.
     */
    start = async (
        request: FastifyRequest<{ Body: { locale?: string } }>,
        reply: FastifyReply,
    ) => {
        if (!instagramLoginService.isConfigured()) {
            return reply.status(404).send({ error: 'Not found' });
        }
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        // Courtesy slot check — the hard gate re-runs at enable time like every
        // other channel, but failing before the OAuth round-trip is kinder.
        const limitCheck = await subscriptionsService.canEnablePage(req.workspaceOwnerId, req.workspaceId);
        if (!limitCheck.allowed) {
            return reply.status(403).send({
                error: 'Page limit reached', code: 'PAGE_LIMIT_REACHED', limit: limitCheck.limit,
            });
        }

        const nonce = crypto.randomBytes(16).toString('hex');
        const state: IgConnectState = {
            userId: req.user.userId,
            workspaceId: req.workspaceId,
            locale: request.body?.locale === 'en' ? 'en' : 'ar',
        };
        await issueSingleUse(igStateKey(nonce), JSON.stringify(state), IG_STATE_TTL_MS);

        request.log.info('[InstagramConnect] start');
        return reply.send({ url: instagramLoginService.buildAuthorizeUrl(nonce) });
    };

    /**
     * GET /auth/instagram/callback — PUBLIC: a top-level navigation from
     * instagram.com. Every outcome — success, cancel, replayed state, taken
     * account — returns the app-sync PAGE with a status param; /pages reads it
     * and shows the right toast. Never a bare error body: the merchant is in a
     * browser tab that must find its way back to the app.
     */
    callback = async (
        request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string; error_reason?: string } }>,
        reply: FastifyReply,
    ) => {
        if (!instagramLoginService.isConfigured()) {
            return reply.status(404).send({ error: 'Not found' });
        }
        const { code, state: nonce, error } = request.query;
        const sendPage = (params: Record<string, string>, locale: 'ar' | 'en' = 'ar') =>
            reply.header('content-type', 'text/html; charset=utf-8').send(igReturnPage(params, locale));

        // State first: without it we can't even trust the locale. A missing or
        // replayed nonce ends the flow — a signed-but-replayable state would let
        // an attacker attach THEIR Instagram to the victim's workspace.
        const raw = nonce ? await consumeSingleUse(igStateKey(nonce)) : null;
        if (!raw) {
            request.log.warn('[InstagramConnect] callback with missing/replayed state');
            return sendPage({ igError: 'state' });
        }
        const state = JSON.parse(raw) as IgConnectState;

        if (error || !code) {
            // Merchant cancelled the dialog (or Meta returned an error).
            request.log.info({ error, reason: request.query.error_reason }, '[InstagramConnect] cancelled');
            return sendPage({ igError: 'cancelled' }, state.locale);
        }

        try {
            const { token, profile } = await instagramLoginService.completeConnect(code);
            const result = await pagesService.connectInstagramDirect(state.workspaceId, state.userId, profile, token);
            if (result.taken) {
                request.log.warn('[InstagramConnect] account already connected to another workspace');
                return sendPage({ igError: 'taken' }, state.locale);
            }
            if (result.alreadyLinked) {
                request.log.info('[InstagramConnect] account already reachable via its Facebook Page');
                return sendPage({ igError: 'linked' }, state.locale);
            }

            // Install the app on the account itself. Instagram Login delivers
            // NOTHING without this (see subscribeToWebhooks) — a connect that
            // skipped it would look healthy and answer no one. It runs after the
            // row exists so a merchant whose subscription fails still has a page
            // to retry from, and its outcome is reported rather than assumed.
            // The toast is not the only recovery: the daily
            // `runWebhookResubscribeSweep` re-issues the idempotent install for
            // every live direct row, so a missed toast heals within 24h.
            const subscribed = await instagramLoginService.subscribeToWebhooks(
                profile.userId, token.accessToken, request.log,
            );
            request.log.info(`[InstagramConnect] connected @${profile.username} (webhooks: ${subscribed ? 'ok' : 'FAILED'})`);
            return sendPage(
                subscribed ? { instagramConnected: '1' } : { instagramConnected: '1', igWarn: 'webhooks' },
                state.locale,
            );
        } catch (err) {
            const code2 = err instanceof InstagramLoginError ? err.code : 'UNEXPECTED';
            request.log.error({ err, code: code2 }, '[InstagramConnect] callback failed');
            return sendPage({ igError: 'failed' }, state.locale);
        }
    };
}

export const instagramConnectController = new InstagramConnectController();
