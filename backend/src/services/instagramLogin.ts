import axios from 'axios';
import { db } from '../db';
import { pages } from '../db/schema';
import { and, eq, isNotNull, lt, ne } from 'drizzle-orm';
import { config } from '../config';
import { maybeDecryptToken, maybeEncryptToken } from './facebookCrypto';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

/**
 * Instagram API with Instagram Login — the Instagram-DIRECT connect path.
 *
 * A professional (Business/Creator) Instagram account connects with its own
 * Instagram credentials, no Facebook Page involved. Everything here talks to
 * instagram.com / graph.instagram.com with the SEPARATE Instagram app
 * credentials (config.instagram) — never the Facebook app.
 *
 * Token lifecycle (Meta-imposed, like the WhatsApp business token):
 *   code → short-lived token (1h) → long-lived token (60 days) → refreshed
 *   before expiry by the sweep below. A long-lived token can only be refreshed
 *   while it is still valid and at least 24h old, so the sweep runs well inside
 *   that window.
 */

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const SHORT_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_BASE = 'https://graph.instagram.com';

/** The three scopes Jawab24 needs. Publishing is deliberately NOT requested. */
export const INSTAGRAM_LOGIN_SCOPES = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
] as const;

/**
 * Webhook fields this app wants on each connected Instagram Login account.
 *
 * Mirrors the app-level `instagram` subscription in `metaWebhooks.ts` — the two
 * must stay in step, because the app-level subscription says WHICH events this
 * app may receive and the per-account one below says FOR WHICH ACCOUNT.
 */
const WEBHOOK_FIELDS = 'messages,comments';

/** Refresh tokens expiring within this window. Wide enough for several sweeps. */
const REFRESH_BEFORE_EXPIRY_MS = 10 * 24 * 60 * 60 * 1000; // 10 days
/** Delay between per-account Graph calls so the sweep can't hammer Meta. */
const PER_ACCOUNT_DELAY_MS = 1000;
/** How often the refresh sweep runs. Tokens live 60 days; daily is ample. */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class InstagramLoginError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'InstagramLoginError';
    }
}

export interface InstagramProfile {
    /** The professional account's id on graph.instagram.com (webhook entry.id). */
    userId: string;
    username: string;
    name: string | null;
    profilePictureUrl: string | null;
}

export interface LongLivedToken {
    accessToken: string;
    /** Absolute expiry computed from Meta's expires_in at exchange time. */
    expiresAt: Date;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const instagramLoginService = {
    /** Feature is dark unless all three credentials are configured. */
    isConfigured(): boolean {
        const { appId, appSecret, redirectUri } = config.instagram;
        return Boolean(appId && appSecret && redirectUri);
    },

    /**
     * The Instagram OAuth dialog URL. Per Rule 17b the app opens THIS url
     * directly (the tab's first document is instagram.com); `state` is a
     * single-use key minted from the authenticated app session.
     */
    buildAuthorizeUrl(state: string): string {
        const params = new URLSearchParams({
            client_id: config.instagram.appId,
            redirect_uri: config.instagram.redirectUri,
            response_type: 'code',
            scope: INSTAGRAM_LOGIN_SCOPES.join(','),
            state,
        });
        return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    /**
     * code → long-lived token + profile, in the three Meta-mandated steps.
     * Returns everything the connect controller needs to persist a channel row.
     */
    async completeConnect(code: string): Promise<{ token: LongLivedToken; profile: InstagramProfile }> {
        const shortToken = await this.exchangeCode(code);
        const token = await this.exchangeToLongLived(shortToken);
        const profile = await this.getProfile(token.accessToken);
        return { token, profile };
    },

    /** OAuth code → short-lived (1h) Instagram User token. */
    async exchangeCode(code: string): Promise<string> {
        const body = new URLSearchParams({
            client_id: config.instagram.appId,
            client_secret: config.instagram.appSecret,
            grant_type: 'authorization_code',
            redirect_uri: config.instagram.redirectUri,
            code,
        });
        try {
            const { data } = await axios.post(SHORT_TOKEN_URL, body.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15_000,
            });
            if (!data?.access_token) {
                throw new InstagramLoginError('No access_token in code exchange response', 'NO_TOKEN');
            }
            return data.access_token as string;
        } catch (error) {
            throw toLoginError(error, 'CODE_EXCHANGE_FAILED');
        }
    },

    /** Short-lived → long-lived (60 days). */
    async exchangeToLongLived(shortToken: string): Promise<LongLivedToken> {
        try {
            const { data } = await axios.get(`${GRAPH_BASE}/access_token`, {
                params: {
                    grant_type: 'ig_exchange_token',
                    client_secret: config.instagram.appSecret,
                    access_token: shortToken,
                },
                timeout: 15_000,
            });
            return toLongLived(data);
        } catch (error) {
            throw toLoginError(error, 'LONG_LIVED_EXCHANGE_FAILED');
        }
    },

    /** Refresh an unexpired long-lived token for another 60 days. */
    async refreshLongLived(token: string): Promise<LongLivedToken> {
        try {
            const { data } = await axios.get(`${GRAPH_BASE}/refresh_access_token`, {
                params: { grant_type: 'ig_refresh_token', access_token: token },
                timeout: 15_000,
            });
            return toLongLived(data);
        } catch (error) {
            throw toLoginError(error, 'REFRESH_FAILED');
        }
    },

    /** The connected professional account's identity. */
    async getProfile(token: string): Promise<InstagramProfile> {
        try {
            const { data } = await axios.get(`${GRAPH_BASE}/${config.facebook.graphApiVersion}/me`, {
                params: { fields: 'user_id,username,name,profile_picture_url', access_token: token },
                timeout: 15_000,
            });
            if (!data?.user_id || !data?.username) {
                throw new InstagramLoginError('Profile response missing user_id/username', 'BAD_PROFILE');
            }
            return {
                userId: String(data.user_id),
                username: data.username,
                name: data.name ?? null,
                profilePictureUrl: data.profile_picture_url ?? null,
            };
        } catch (error) {
            throw toLoginError(error, 'PROFILE_FAILED');
        }
    },

    /**
     * Subscribe THIS Instagram account to our webhooks.
     *
     * Not optional and not a nicety: for Instagram Login, the app-level
     * `instagram` subscription only declares which fields the app may receive —
     * each professional account must additionally install the app on itself
     * (`POST /{ig-id}/subscribed_apps`, verified against Meta's docs 2026-08-16).
     * Without this call the connect succeeds, the page appears healthy, and not
     * one message or comment ever arrives: the silent-channel failure mode this
     * codebase has now paid for on Instagram twice.
     *
     * Returns whether the subscription is confirmed. Never throws — a merchant
     * who reached this point has a valid credential, and losing that to a
     * transient Graph error would be worse than a channel we can re-subscribe.
     * The caller records the outcome so a false is visible rather than assumed.
     */
    async subscribeToWebhooks(instagramUserId: string, token: string, logger: Logger = noopLogger): Promise<boolean> {
        try {
            const { data } = await axios.post(
                `${GRAPH_BASE}/${config.facebook.graphApiVersion}/${instagramUserId}/subscribed_apps`,
                null,
                {
                    params: { subscribed_fields: WEBHOOK_FIELDS, access_token: token },
                    timeout: 15_000,
                },
            );
            const ok = data?.success === true;
            if (!ok) {
                captureError(
                    new InstagramLoginError('subscribed_apps did not return success', 'SUBSCRIBE_NOT_CONFIRMED'),
                    'Instagram-direct webhook subscription unconfirmed',
                    { tags: { service: 'instagram-login' }, extra: { instagramUserId, response: data } },
                );
            } else {
                logger.info(`[InstagramLogin] Webhooks subscribed for ${instagramUserId}`);
            }
            return ok;
        } catch (error) {
            captureError(error, 'Instagram-direct webhook subscription failed', {
                tags: { service: 'instagram-login' },
                extra: { instagramUserId },
            });
            return false;
        }
    },

    /**
     * Refresh sweep for Instagram-direct tokens nearing expiry. Mirrors the
     * WhatsApp token-health discipline: failures are captured per-row and never
     * abort the sweep; a row whose refresh fails keeps its token so the next
     * sweep retries until real expiry.
     */
    async runRefreshSweep(logger: Logger = noopLogger): Promise<{ refreshed: number; failed: number }> {
        const cutoff = new Date(Date.now() + REFRESH_BEFORE_EXPIRY_MS);
        const rows = await db
            .select({ id: pages.id, token: pages.instagramAccessToken })
            .from(pages)
            .where(and(
                isNotNull(pages.instagramAccessToken),
                ne(pages.instagramAccessToken, ''),
                isNotNull(pages.instagramTokenExpiresAt),
                lt(pages.instagramTokenExpiresAt, cutoff),
            ));

        let refreshed = 0;
        let failed = 0;
        for (const row of rows) {
            try {
                const current = maybeDecryptToken(row.token);
                const next = await this.refreshLongLived(current);
                await db.update(pages)
                    .set({
                        instagramAccessToken: maybeEncryptToken(next.accessToken),
                        instagramTokenExpiresAt: next.expiresAt,
                        updatedAt: new Date(),
                    })
                    .where(eq(pages.id, row.id));
                refreshed++;
                logger.info(`[InstagramLogin] Refreshed token for page ${row.id}`);
            } catch (error) {
                failed++;
                captureError(error, 'Instagram-direct token refresh failed', {
                    tags: { service: 'instagram-login' },
                    extra: { pageId: row.id },
                });
            }
            await sleep(PER_ACCOUNT_DELAY_MS);
        }
        return { refreshed, failed };
    },
};

let sweepHandle: NodeJS.Timeout | null = null;

/**
 * Daily refresh sweep. Dark unless Instagram-direct is configured — a deployment
 * without the Instagram app credentials has no such rows and no reason to wake.
 *
 * No sweep on boot: `runRefreshSweep` only touches rows inside a 10-day window of
 * a 60-day token, so the first scheduled run is always early enough, and a restart
 * loop must not turn into a burst of Graph calls.
 */
export function startInstagramTokenRefreshCron(logger: Logger = noopLogger): void {
    if (sweepHandle || !instagramLoginService.isConfigured()) return;
    logger.info(`[InstagramLogin] Refresh cron started — sweeps every ${SWEEP_INTERVAL_MS / 3600000}h`);
    sweepHandle = setInterval(() => {
        instagramLoginService.runRefreshSweep(logger).catch(err => {
            captureError(err, 'Instagram-direct token refresh cron failed', {
                tags: { service: 'instagram-login' },
            });
        });
    }, SWEEP_INTERVAL_MS);
}

export function stopInstagramTokenRefreshCron(): void {
    if (sweepHandle) {
        clearInterval(sweepHandle);
        sweepHandle = null;
    }
}

function toLongLived(data: unknown): LongLivedToken {
    const d = data as { access_token?: string; expires_in?: number };
    if (!d?.access_token) {
        throw new InstagramLoginError('No access_token in long-lived response', 'NO_TOKEN');
    }
    // expires_in is seconds from now. Missing ⇒ assume the standard 60 days
    // minus a day of slack rather than storing NULL (NULL = "unknown" contract).
    const seconds = typeof d.expires_in === 'number' && d.expires_in > 0
        ? d.expires_in
        : 59 * 24 * 60 * 60;
    return { accessToken: d.access_token, expiresAt: new Date(Date.now() + seconds * 1000) };
}

function toLoginError(error: unknown, fallbackCode: string): InstagramLoginError {
    if (error instanceof InstagramLoginError) return error;
    if (axios.isAxiosError(error)) {
        const igError = error.response?.data?.error_message
            ?? error.response?.data?.error?.message
            ?? error.message;
        return new InstagramLoginError(String(igError), fallbackCode);
    }
    return new InstagramLoginError(error instanceof Error ? error.message : String(error), fallbackCode);
}
