/**
 * Zid app lifecycle — uninstall verification and follow-through (D-114).
 *
 * WHY THIS EXISTS. `app.market.application.uninstall` is configured in the Zid
 * Partner Dashboard, not registered per store, so Zid delivers it with NO
 * `Authorization` header (captured live 2026-08-30 — ZID_TEST_PLAN C11). Until
 * that capture the webhook handler demanded the Basic credential we attach to
 * per-store registrations and answered every real uninstall with 401: the store
 * stayed active, its embedded-app token hash stayed valid, and its billing
 * mirror stayed live. The delivery cannot be authenticated at the edge, so it
 * is treated as a TRIGGER and verified against Zid itself — the D-070 shape the
 * subscription rail already follows ("webhooks are triggers, the API is the
 * authority").
 *
 * THE PROOF. Zid invalidates the store's OAuth tokens when the merchant
 * uninstalls. `verifyZidUninstall` probes a `/v1/managers/*` endpoint with our
 * stored credential: a 401 is the uninstall confirmed by Zid, and only then does
 * `finalizeZidUninstall` run the revoke → cancel-mirror → deactivate chain. A
 * token Zid still honours means either a delivery that outran the invalidation
 * or a spoofed request — in both cases the store is left ACTIVE and an
 * `uninstallSignalAt` marker is written, and `sweepZidUninstallSignals` re-asks
 * Zid on the reconcile cadence and finishes the job once the token is provably
 * dead. A spoof therefore costs an attacker one throttled API call and changes
 * nothing; a genuine uninstall is never lost.
 *
 * Lives in its own module (not controllers/zid.ts) because the sweep is a cron
 * and the billing reconciler is its sibling: a service that a cron imports must
 * not live in a controller, and `zidBilling` must stay importable from here
 * without a cycle (this module imports zidBilling; zidBilling never imports it).
 */
import * as zidService from './zid';
import { applySyncedStoreInfo, deactivateStore, setEmbeddedTokenHash } from './ecommerce';
import { cancelZidSubscriptionLocal } from './zidBilling';
import { captureError } from '../utils/sentryHelpers';
import { noopLinkLogger, type LinkLogger } from '../types/linkLogger';
import { db } from '../db';
import { ecommerceStores } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { isDemoStore } from './demoStore';

/** `platformData` key holding the ISO timestamp of the last unconfirmed uninstall delivery. */
export const ZID_UNINSTALL_SIGNAL_KEY = 'uninstallSignalAt';

/**
 * A signal this old whose token Zid STILL honours is stale — a spoof, or an
 * uninstall Zid never followed through on. It is cleared so the sweep stops
 * probing a healthy store forever; a genuine later uninstall writes a fresh one.
 */
export const ZID_UNINSTALL_SIGNAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ZidUninstallVerdict = 'confirmed' | 'token_still_valid' | 'unverifiable';

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Revoke a store's embedded-app token — at Zid (best-effort) and locally
 * (always). Called on uninstall and on merchant-initiated disconnect.
 */
export async function revokeEmbeddedToken(
    storeId: string,
    log: LinkLogger,
    reason: 'uninstall' | 'disconnect' = 'uninstall',
): Promise<void> {
    try {
        const creds = await zidService.resolveZidCredentials(storeId);
        if (creds) await zidService.deleteEmbeddedToken(creds);
    } catch (error) {
        // On UNINSTALL this is expected — Zid invalidates our OAuth tokens as
        // part of the uninstall, so the DELETE has nothing to authenticate with.
        // On DISCONNECT the tokens are still live, so a failure means a usable
        // credential survives at Zid's side and is worth a Sentry event.
        if (reason === 'disconnect') {
            captureError(error, 'Zid embedded-token revocation failed on merchant disconnect', {
                tags: { service: 'zid', action: 'revoke-embedded-token' },
                extra: { storeId },
            });
        }
        log.warn({ err: error, storeId, reason }, 'Zid embedded-token revocation at Zid failed — clearing local hash anyway');
    }
    try {
        await setEmbeddedTokenHash(storeId, null);
    } catch (error) {
        // THIS one matters: a surviving hash keeps the session path open.
        captureError(error, 'Failed to clear Zid embedded token hash', {
            tags: { service: 'zid', action: 'clear-embedded-token' },
            extra: { storeId },
        });
    }
}

/**
 * Is this uninstall real? Asks Zid (see module header). Never throws — a
 * credential we cannot even load (pre-dual-token rows) is `unverifiable`, not
 * an error, because the caller's answer to every non-confirmation is the same:
 * keep the store, keep the marker, ask again later.
 */
export async function verifyZidUninstall(storeId: string, log: LinkLogger): Promise<ZidUninstallVerdict> {
    let creds: zidService.ZidCredentials | null;
    try {
        creds = await zidService.resolveZidCredentials(storeId);
    } catch (err) {
        log.warn({ storeId, err: errorMessage(err) }, 'Zid uninstall cannot be verified: no usable credential for this store');
        return 'unverifiable';
    }
    if (!creds) return 'unverifiable';

    const probe = await zidService.probeZidToken(creds);
    if (probe === 'revoked') return 'confirmed';
    if (probe === 'valid') return 'token_still_valid';
    return 'unverifiable';
}

/**
 * The uninstall itself, in the one order that works: revoke the in-dashboard
 * entry BEFORE deactivating (deactivateStore blanks the OAuth tokens the Zid
 * DELETE needs — best-effort there, but clearing OUR hash is what closes the
 * session path); cancel the billing mirror before deactivating too, so no paid
 * local subscription outlives the app (§H-6).
 */
export async function finalizeZidUninstall(
    store: { id: string; storeDomain: string },
    log: LinkLogger,
): Promise<void> {
    await revokeEmbeddedToken(store.id, log);
    await cancelZidSubscriptionLocal(store.id, 'zid_app_uninstalled', log);
    await deactivateStore('zid', store.storeDomain);
}

/** Record an uninstall delivery Zid has not (yet) confirmed. Idempotent — the newest delivery wins. */
export async function markZidUninstallSignal(storeId: string, at: Date = new Date()): Promise<void> {
    await applySyncedStoreInfo(storeId, {}, { [ZID_UNINSTALL_SIGNAL_KEY]: at.toISOString() });
}

export async function clearZidUninstallSignal(storeId: string): Promise<void> {
    await applySyncedStoreInfo(storeId, {}, { [ZID_UNINSTALL_SIGNAL_KEY]: null });
}

/** Read the marker back off a store row; anything unparseable reads as "no signal". */
export function readZidUninstallSignal(platformData: unknown): Date | null {
    const raw = (platformData as Record<string, unknown> | null | undefined)?.[ZID_UNINSTALL_SIGNAL_KEY];
    if (typeof raw !== 'string') return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
}

export interface ZidUninstallSweepResult {
    /** active zid stores carrying an unconfirmed uninstall signal */
    scanned: number;
    /** uninstalls Zid has since confirmed (token dead) and that were finalized here */
    finalized: number;
    /** stale signals cleared because Zid still honours the token after the TTL */
    cleared: number;
    /** per-store failures, isolated so one bad store cannot stall the sweep */
    errors: number;
}

/**
 * Finish uninstalls whose delivery could not be confirmed at the time. Cheap by
 * construction: only stores with a marker are probed, and a healthy fleet has
 * none. Runs on the reconcile cadence (index.ts `ZidUninstallSweep`).
 */
export async function sweepZidUninstallSignals(options?: {
    log?: LinkLogger;
    now?: Date;
}): Promise<ZidUninstallSweepResult> {
    const log = options?.log ?? noopLinkLogger;
    const now = options?.now ?? new Date();
    const result: ZidUninstallSweepResult = { scanned: 0, finalized: 0, cleared: 0, errors: 0 };

    const rows = await db
        .select({
            id: ecommerceStores.id,
            storeDomain: ecommerceStores.storeDomain,
            platformData: ecommerceStores.platformData,
        })
        .from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.platform, 'zid'),
            eq(ecommerceStores.isActive, true),
        ));

    for (const row of rows) {
        const signalAt = readZidUninstallSignal(row.platformData);
        // Demo-seeded stores hold placeholder tokens that decrypt() rejects —
        // every real-API path must skip them (services/demoStore.ts).
        if (!signalAt || isDemoStore(row)) continue;
        result.scanned++;
        try {
            const verdict = await verifyZidUninstall(row.id, log);
            if (verdict === 'confirmed') {
                await finalizeZidUninstall(row, log);
                result.finalized++;
                log.info({ storeId: row.id, signalAt: signalAt.toISOString() }, 'Zid uninstall confirmed by a dead token — store deactivated');
            } else if (verdict === 'token_still_valid' && now.getTime() - signalAt.getTime() > ZID_UNINSTALL_SIGNAL_TTL_MS) {
                await clearZidUninstallSignal(row.id);
                result.cleared++;
                log.warn({ storeId: row.id, signalAt: signalAt.toISOString() }, 'Zid uninstall signal expired with the token still valid — cleared (spoof, or Zid never followed through)');
            }
            // Still fresh, or Zid unreachable: keep the marker; the next tick asks again.
        } catch (err) {
            result.errors++;
            log.warn({ storeId: row.id, err: errorMessage(err) }, 'Zid uninstall sweep failed for one store');
        }
    }

    return result;
}
