/**
 * Embedded-app sessions — trading a platform-issued credential for a Jawab24
 * session inside the platform's own dashboard iframe.
 *
 * Platform-agnostic on purpose. Zid is the only caller today (docs.zid.sa/
 * embedded-apps), but Salla's review has the same "direct merchant access, no
 * sign-in prompt" requirement and must adopt this rather than grow a parallel
 * copy — the split between backend and ai-worker error classes is the standing
 * example in this repo of what happens when it doesn't (AI_INSTRUCTIONS §13c).
 *
 * THREAT MODEL — read before changing anything here.
 *
 * The credential is a UUID the platform hands to whoever opens the app from the
 * merchant dashboard. It proves "this request concerns THIS STORE". It does not
 * prove who the person is: a store collaborator, an agency that installed on the
 * merchant's behalf, or anyone who read the UUID out of a URL can present it.
 * Everything below follows from that:
 *
 * - Only the SHA-256 is stored, so a database leak is not a set of live sessions.
 * - The minted session is SCOPED to the store's workspace and stripped of admin
 *   (TokenScope). Authenticating as the owner is unavoidable — the store belongs
 *   to them — but the session must not reach their OTHER workspaces, pages,
 *   stores or billing, which is what an unscoped token would hand over.
 * - The token is the same short-lived access token a normal login issues. The
 *   page re-exchanges when it expires; no long-lived bearer token is minted.
 * - The credential expires when idle (EMBEDDED_TOKEN_IDLE_MS) and is rotated on
 *   every (re)install, so a value that leaked into a log has a bounded life.
 */

import crypto from 'crypto';
import type { FastifyRequest } from 'fastify';
import { authService } from './auth';
import { workspaceService } from './workspace';
import {
    getStoreByEmbeddedTokenHash,
    touchEmbeddedTokenUse,
} from './ecommerce';
import { captureError } from '../utils/sentryHelpers';
import type { EmbeddedPlatform } from '../types';

/** SHA-256 hex of an embedded-app credential — only the digest is ever persisted. */
export function hashEmbeddedToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Why an exchange was refused. The CALLER always answers with one opaque 401 —
 * a public endpoint must not tell an unknown caller which of these it hit — but
 * the reason is logged, because "the app doesn't open" with nothing to grep is
 * how this integration lost eight days once already.
 */
export type EmbeddedSessionFailure =
    | 'missing-token'
    | 'unknown-or-expired-credential'
    | 'owner-missing'
    | 'no-workspace';

export interface EmbeddedSessionResult {
    accessToken: string;
    workspaceId: string;
    storeId: string;
}

/**
 * Exchange a platform embedded credential for a scoped Jawab24 session.
 * Returns a discriminated result — never throws for an ordinary refusal, so the
 * caller cannot accidentally leak a stack trace to a public endpoint.
 */
export async function exchangeEmbeddedCredential(
    platform: EmbeddedPlatform,
    credential: string | undefined,
    log: FastifyRequest['log'],
): Promise<{ ok: true; session: EmbeddedSessionResult } | { ok: false; reason: EmbeddedSessionFailure }> {
    if (!credential || typeof credential !== 'string') {
        log.warn({ platform }, 'Embedded session refused: no credential in request');
        return { ok: false, reason: 'missing-token' };
    }

    const store = await getStoreByEmbeddedTokenHash(platform, hashEmbeddedToken(credential));
    if (!store) {
        // Unknown, rotated by a reinstall, revoked at uninstall, or idle past
        // EMBEDDED_TOKEN_IDLE_MS. Never log the credential itself — that is the
        // exact leak the hashing exists to prevent.
        log.warn({ platform }, 'Embedded session refused: unknown, rotated, revoked or idle-expired credential');
        return { ok: false, reason: 'unknown-or-expired-credential' };
    }

    const user = await authService.getUserById(store.userId);
    if (!user) {
        // Owner deleted while the store row survived — nothing to open a session
        // as. Genuinely anomalous (a GDPR erasure should have taken the store
        // too), so this one is worth a Sentry event, not just a log line.
        captureError(new Error('Embedded session store has no owner'), 'Embedded session owner missing', {
            tags: { service: 'embedded-session', platform },
            extra: { storeId: store.id, userId: store.userId },
        });
        return { ok: false, reason: 'owner-missing' };
    }

    // The session is pinned to a workspace, so one must exist. The store's own
    // workspace is the right answer; the resolver covers legacy rows installed
    // before stores carried a workspace. With neither we FAIL rather than mint
    // an unscoped token — an unpinned embedded session is the vulnerability
    // this function exists to prevent.
    const workspaceId = store.workspaceId
        ?? await workspaceService.resolveDefaultWorkspaceId(user.id);
    if (!workspaceId) {
        captureError(new Error('Embedded session has no workspace to scope to'), 'Embedded session unscopable', {
            tags: { service: 'embedded-session', platform },
            extra: { storeId: store.id, userId: user.id },
        });
        return { ok: false, reason: 'no-workspace' };
    }

    // Second argument omitted deliberately: the DEFAULT access-token expiry is
    // the point. Naming a longer one here would hand the iframe a durable token.
    const accessToken = authService.generateToken(user, undefined, {
        embeddedPlatform: platform,
        workspaceId,
    });

    // Idle clock is per successful exchange. Fire-and-forget: a merchant must
    // never be locked out of their dashboard by a bookkeeping write failing.
    touchEmbeddedTokenUse(store.id).catch((err) => {
        log.error({ err, storeId: store.id }, 'Failed to stamp embedded token use');
    });

    log.info({
        platform,
        storeId: store.id,
        userId: user.id,
        workspaceId,
    }, 'Embedded session established');

    return { ok: true, session: { accessToken, workspaceId, storeId: store.id } };
}
