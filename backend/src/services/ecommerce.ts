/**
 * Shared e-commerce service — platform-agnostic functions for Shopify, Salla, Zid, etc.
 *
 * All store CRUD, product summary, KB enrichment, cache invalidation, pending installs,
 * and DTO mapping live here. Platform-specific services (shopify.ts, salla.ts) import
 * from this module and add their own OAuth, API, and sync logic.
 */
import { eq, and, or, lt, gt, sql, desc, isNull, isNotNull, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores, ecommerceProducts, pages, pendingEcommerceInstalls, workspaceMembers, workspaces, customerNotificationsLog } from '../db/schema';
import { encrypt, decrypt, encryptOptional, decryptOptional } from './ecommerceCrypto';
import { isDemoStore } from './demoStore';
import type { EcommerceStore, EcommerceProduct } from '@jawab24/shared';
import { captureError } from '../utils/sentryHelpers';
import { fitVarchar, wasDropped } from '../utils/columnText';
import { redisScanDelete } from '../lib/redis';
import { customerNotificationService } from './customerNotifications';
import { workspaceSettingsService } from './workspaceSettings';

// --- Constants & Types ---

export type EcommercePlatform = 'shopify' | 'salla' | 'zid';

/** Webhook registration result returned by platform-specific registerWebhooks functions */
export interface WebhookRegistrationResult {
    registered: string[];
    failed: Array<{ topic: string; status?: number; error?: string }>;
    lastAttempt: string;
    /**
     * Set to `true` by the retry worker when all retry attempts have been
     * exhausted. The integrations UI reads this flag to decide whether to
     * surface a "Re-register webhooks" CTA to the merchant. Without this,
     * an exhausted retry queue is silently invisible to the merchant: the
     * store appears connected but no webhooks fire on new events.
     */
    exhausted?: boolean;
}

/**
 * Derived health state surfaced to the frontend integrations card.
 * - 'ok'      — every topic registered, nothing pending
 * - 'pending' — some topics failed but retries are still in flight
 * - 'failed'  — retries are exhausted; the merchant must click Re-register
 * - 'unknown' — store row predates the webhookStatus tracking (legacy data)
 */
export type WebhookHealth = 'ok' | 'pending' | 'failed' | 'unknown';

export function deriveWebhookHealth(status: WebhookRegistrationResult | undefined | null): WebhookHealth {
    if (!status) return 'unknown';
    if (status.exhausted) return 'failed';
    if (status.failed.length > 0) return 'pending';
    return 'ok';
}

/**
 * Register webhooks for a freshly-installed store and persist the resulting
 * status atomically with retry-queue scheduling.
 *
 * Replaces fire-and-forget `.catch()` patterns at controller install sites.
 * The merchant install must NOT fail because of webhook hiccups — partial
 * failures are persisted and retried in the background; total failures
 * (registerFn throws) are persisted as a "failed: all" marker so the
 * integrations card has signal immediately, then a retry job is enqueued.
 *
 * Used by Shopify, Salla, and Zid install paths and the manual
 * /:platform/store/webhooks/reregister endpoint.
 */
export async function registerWebhooksWithPersist(
    storeId: string,
    platform: EcommercePlatform,
    registerFn: () => Promise<WebhookRegistrationResult>,
): Promise<WebhookRegistrationResult> {
    // Demo stores hold placeholder tokens — registerFn would throw on decrypt,
    // persist a failed status, and enqueue pointless retries. No-op instead.
    if (isDemoStore(await getStoreById(storeId))) {
        return { registered: [], failed: [], lastAttempt: new Date().toISOString() };
    }
    try {
        const status = await registerFn();
        await saveWebhookStatus(storeId, status);
        if (status.failed.length > 0) {
            try {
                const { enqueueWebhookRetry } = await import('../lib/webhookRetryQueue');
                await enqueueWebhookRetry({ storeId, platform });
            } catch (queueErr) {
                captureError(queueErr, `${platform} webhook retry enqueue failed (partial-failure path)`, {
                    tags: { service: platform, stage: 'webhook-retry-enqueue-failed' },
                    extra: { storeId, failedTopicCount: status.failed.length },
                });
            }
        }
        return status;
    } catch (err) {
        captureError(err, `${platform} webhook registration failed`, {
            tags: { service: platform, stage: 'webhook-registration' },
            extra: { storeId },
        });
        const failedStatus: WebhookRegistrationResult = {
            registered: [],
            failed: [{ topic: 'all', error: err instanceof Error ? err.message : String(err) }],
            lastAttempt: new Date().toISOString(),
        };
        try {
            await saveWebhookStatus(storeId, failedStatus);
        } catch (persistErr) {
            // Surface this — the integrations card depends on this DB write
            // for the Re-register CTA. Without it, merchant has no signal AND
            // no retry job AND no recovery path.
            captureError(persistErr, `${platform} webhook status persist failed`, {
                tags: { service: platform, stage: 'webhook-status-persist-failed' },
                extra: { storeId, originalError: err instanceof Error ? err.message : String(err) },
            });
        }
        try {
            const { enqueueWebhookRetry } = await import('../lib/webhookRetryQueue');
            await enqueueWebhookRetry({ storeId, platform });
        } catch (queueErr) {
            captureError(queueErr, `${platform} webhook retry enqueue failed (throw path)`, {
                tags: { service: platform, stage: 'webhook-retry-enqueue-failed' },
                extra: { storeId, originalError: err instanceof Error ? err.message : String(err) },
            });
        }
        return failedStatus;
    }
}

/**
 * Merge a patch into a store's platformData JSONB, preserving existing keys
 * (merchantId, planName, …). One place for the merge skeleton shared by the
 * webhook-status and token-health writers. Platform-agnostic.
 *
 * Deliberately a read-modify-write rather than an atomic `platformData || patch`
 * jsonb expression: it keeps the merge logic unit-testable (the assertion that we
 * preserve keys + set the right value lives in our code, not the DB engine) and
 * matches the long-standing pattern here. The only concurrent overlap is
 * webhook-status vs token-health writes to the same store within a sub-millisecond
 * window — bidirectional and self-healing (each is re-derived next cycle), blast
 * radius one store. If a higher-frequency writer is ever added, switch this single
 * function to an atomic `coalesce(platform_data,'{}'::jsonb) || $patch::jsonb`.
 */
async function mergeStorePlatformData(storeId: string, patch: Record<string, unknown>): Promise<void> {
    await applySyncedStoreInfo(storeId, {}, patch);
}

/**
 * The four DESCRIPTIVE store columns. Every platform adapter writes them from
 * unvalidated third-party JSON, through the two functions below.
 */
export interface StoreScalars {
    storeName?: string | null;
    storeEmail?: string | null;
    storeCurrency?: string | null;
    storeTimezone?: string | null;
}

/** Declared `unknown` on purpose — see fitStoreScalars. */
export interface RawStoreScalars {
    storeName?: unknown;
    storeEmail?: unknown;
    storeCurrency?: unknown;
    storeTimezone?: unknown;
}

/**
 * Coerce the descriptive store scalars into values their columns can physically
 * hold, and report anything that had to be dropped or truncated.
 *
 * WHY THIS EXISTS — on 2026-08-11 the first live Zid App Market install failed
 * outright: Zid returns `currency` as an object, the adapter's interface claimed
 * `string`, and the object hit `varchar(10)` as Postgres `22001`. The install,
 * the account, and the merchant's whole onboarding were lost to a field we only
 * ever display. Adapters are hardened at their own boundary (see
 * `services/zid.ts#fetchStoreInfo`), but every adapter parses unvalidated JSON,
 * so the class of bug is closed HERE, at the one place all three rails write —
 * prevention over detection. Identity columns (`storeDomain`, `platform`) are
 * deliberately excluded: a malformed identity must still fail loudly.
 *
 * The input is typed `unknown` rather than `string` because a TypeScript
 * annotation over third-party JSON is an assumption, not a guarantee — that
 * assumption is exactly what broke. Semantics are preserved precisely:
 * `undefined` omits the column (Drizzle leaves it untouched), `null` clears it
 * (Shopify's GraphQL scalars send real nulls), and an unreadable shape omits it
 * rather than overwriting a good stored value with junk.
 */
export function fitStoreScalars(
    raw: RawStoreScalars,
    context: { platform?: string; storeDomain?: string; storeId?: string } = {},
): StoreScalars {
    // Resolved at CALL time, never in a module-level constant. Dereferencing
    // schema columns at import would make every transitive importer of this file
    // depend on the whole schema module being materialised before it loads —
    // real load-order coupling, and it breaks partial `vi.mock('db/schema')`
    // factories in suites that have nothing to do with e-commerce.
    const columns = {
        storeName: ecommerceStores.storeName,
        storeEmail: ecommerceStores.storeEmail,
        storeCurrency: ecommerceStores.storeCurrency,
        storeTimezone: ecommerceStores.storeTimezone,
    } as const;

    const fitted: StoreScalars = {};
    const dropped: string[] = [];
    const truncated: string[] = [];

    for (const [field, column] of Object.entries(columns)) {
        const key = field as keyof StoreScalars;
        const value = raw[key];
        const result = fitVarchar(value, column);

        if (wasDropped(value, result)) {
            dropped.push(key);
            continue; // omit — never overwrite a stored value with a shape we cannot read
        }
        // Compared in CODE POINTS, the unit both Postgres and the clamp use — a
        // UTF-16 comparison would misreport every Arabic or emoji value. `result`
        // is only a string here when `value` was representable, so `String(value)`
        // is safe (null/undefined already returned above).
        if (typeof result === 'string'
            && Array.from(result).length < Array.from(String(value).trim()).length) {
            truncated.push(key);
        }
        fitted[key] = result;
    }

    if (dropped.length > 0 || truncated.length > 0) {
        // A warning, not an error: the write succeeds and the merchant is
        // unaffected. It is reported because a silent drop is how the NEXT
        // envelope drift stays invisible until it breaks something that matters.
        // Fingerprinted so a platform-wide shape change groups into one issue
        // instead of one per store.
        captureError(
            new Error(`Store scalars did not fit their columns: ${[...dropped, ...truncated].join(', ')}`),
            'Store scalar coercion',
            {
                level: 'warning',
                fingerprint: ['store-scalar-coercion', context.platform ?? 'unknown', ...dropped, ...truncated],
                tags: { context: 'ecommerce', action: 'fit-store-scalars', platform: context.platform ?? 'unknown' },
                extra: { dropped, truncated, ...context },
            },
        );
    }

    return fitted;
}

/**
 * Persist refreshed store info from a platform sync. `platformData` is MERGED
 * (same read-modify-write as mergeStorePlatformData), never replaced: a full
 * sync must not wipe operational markers written by other flows — webhookStatus
 * (registerWebhooksWithPersist / webhookRetryWorker exhaustion) and tokenHealth
 * (markStoreNeedsReauth). Replacing the column erased the merchant's
 * "Re-register webhooks" CTA and Reconnect banner within one 6h sync cycle.
 */
export async function applySyncedStoreInfo(
    storeId: string,
    info: RawStoreScalars,
    platformDataPatch: Record<string, unknown> = {},
): Promise<void> {
    // `platform` rides along on the SELECT this function already makes (no extra
    // round trip) purely so a coercion warning names the drifting platform — an
    // envelope change is platform-wide, and that is how it should group in Sentry.
    const [store] = await db.select({
        platformData: ecommerceStores.platformData,
        platform: ecommerceStores.platform,
    }).from(ecommerceStores).where(eq(ecommerceStores.id, storeId)).limit(1);
    const existing = (store?.platformData as Record<string, unknown>) || {};
    await db.update(ecommerceStores).set({
        // Same guard as createStore: a 6-hourly sync writes these columns from the
        // same unvalidated payloads, so an envelope drift would otherwise take out
        // every sync for every store on that platform.
        ...fitStoreScalars(info, { storeId, platform: store?.platform }),
        platformData: { ...existing, ...platformDataPatch },
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));
}

/**
 * Save webhook registration status into the store's platformData JSONB field.
 * Platform-agnostic — used by Shopify, Salla, Zid.
 */
export async function saveWebhookStatus(storeId: string, webhookStatus: WebhookRegistrationResult): Promise<void> {
    await mergeStorePlatformData(storeId, { webhookStatus });
}

/**
 * Flag a store as needing re-authorisation: its OAuth token can no longer be
 * refreshed (refresh token consumed/revoked → permanent failure from the platform).
 * Stored in platformData.tokenHealth, surfaced to the merchant as a Reconnect
 * prompt via mapToEcommerceStore's `needsReauth`. End-state idempotent (re-flagging
 * a flagged store is a harmless re-merge).
 *
 * Recovery: the flag clears when the merchant reconnects (createStore's conflict
 * merge resets tokenHealth on every reconnect path). updateStoreTokens also clears
 * it on a successful refresh, but that rarely helps a flagged store — an
 * invalid_grant refresh token never refreshes successfully — so RECONNECT is the
 * real recovery path, which is exactly what the Reconnect CTA drives.
 */
export async function markStoreNeedsReauth(storeId: string): Promise<void> {
    await mergeStorePlatformData(storeId, { tokenHealth: 'invalid' });
}

// Budget for the store-ENRICHED KB string built in getEnrichedKnowledgeBase (store
// summary + policies first, merchant KB truncated to the remainder). An independent
// value — NOT a mirror of ai-worker's KB_MAX_CHARS, which is 16k.
export const KB_MAX_CHARS = 8000;

// Hard ceiling on how many products a single store syncs into the DB. This is an
// abuse/runaway guard, NOT a plan limit — per-plan `plans.maxProducts` is not enforced
// here (see replaceProductsAndRebuildSummary). Platform fetchers derive their page count
// from this so a catalog can't be silently truncated below the cap by pagination limits.
export const PRODUCT_SAFETY_CAP = 5000;

// Rows per multi-row insert. toProductRow has 15 columns; Postgres caps a statement at
// 65535 bind params, so keep batches well under 65535/15 ≈ 4369.
const PRODUCT_INSERT_BATCH_SIZE = 1000;

// --- Store CRUD ---

export async function getStoreById(storeId: string) {
    const result = await db.select().from(ecommerceStores).where(eq(ecommerceStores.id, storeId)).limit(1);
    return result[0] || null;
}

export async function getStoreByDomain(platform: EcommercePlatform, storeDomain: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.storeDomain, storeDomain), eq(ecommerceStores.platform, platform))
    ).limit(1);
    return result[0] || null;
}

export async function getStoreByWorkspace(platform: EcommercePlatform, workspaceId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.workspaceId, workspaceId), eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, platform))
    ).limit(1);
    return result[0] || null;
}

/**
 * Like getStoreByWorkspace but also returns inactive (disconnected) stores.
 * Used by the integrations page to show a Reconnect card after disconnect.
 *
 * Order matters: when a workspace has multiple rows for the same platform
 * (e.g. an old disconnected store + a new active one — happens when a
 * merchant reinstalls on a different shop), the active row must win, and
 * within the same activity status the most recently updated row wins.
 * Without this ORDER BY, Postgres returns whichever row it picks up first
 * which may be the older inactive one, hiding the active store.
 */
export async function getStoreByWorkspaceAny(platform: EcommercePlatform, workspaceId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.workspaceId, workspaceId), eq(ecommerceStores.platform, platform))
    ).orderBy(desc(ecommerceStores.isActive), desc(ecommerceStores.updatedAt)).limit(1);
    return result[0] || null;
}

/**
 * Get all active stores, optionally filtered by platform.
 * Used by the scheduled sync to refresh inventory across all connected stores.
 * Demo-seeded stores are excluded — their placeholder tokens can't be decrypted,
 * so any real-API call against them is guaranteed to fail. The filter runs in
 * JS via isDemoStore() (see services/demoStore.ts for why not SQL).
 */
export async function getAllActiveStores(platform?: EcommercePlatform): Promise<Array<{ id: string; platform: string }>> {
    const conditions = platform
        ? and(eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, platform))
        : eq(ecommerceStores.isActive, true);
    const rows = await db.select({
        id: ecommerceStores.id,
        platform: ecommerceStores.platform,
        platformData: ecommerceStores.platformData,
    })
        .from(ecommerceStores)
        .where(conditions);
    return rows.filter(row => !isDemoStore(row)).map(({ id, platform: p }) => ({ id, platform: p }));
}

/**
 * Look up an active store by merchant ID stored in platformData JSONB.
 * Used as a fallback when a webhook sends a numeric merchant ID instead of a domain.
 * Example: Zid webhooks send { store_id: "12345" } — we match against platformData->>'merchantId'.
 */
export async function getStoreByMerchantId(platform: EcommercePlatform, merchantId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(
            eq(ecommerceStores.platform, platform),
            eq(ecommerceStores.isActive, true),
            sql`${ecommerceStores.platformData}->>'merchantId' = ${merchantId}`,
        )
    ).limit(1);
    return result[0] || null;
}

/**
 * Resolve a store from a webhook's external id, which is either the store domain
 * OR the numeric merchant id depending on the platform/event. Tries domain first,
 * then falls back to the merchant-id lookup. Shared by the Salla + Zid webhook
 * controllers (both resolve stores exactly this way — without the fallback a
 * merchant-id-keyed webhook silently no-ops in prod, including app.uninstalled).
 */
export async function resolveStoreByDomainOrMerchant(platform: EcommercePlatform, externalId: string) {
    const byDomain = await getStoreByDomain(platform, externalId);
    if (byDomain) return byDomain;
    return getStoreByMerchantId(platform, externalId);
}

/** @deprecated Use getStoreByWorkspace — kept for OAuth flows that lack workspace context */
export async function getStoreByUserId(platform: EcommercePlatform, userId: string) {
    const result = await db.select().from(ecommerceStores).where(
        and(eq(ecommerceStores.userId, userId), eq(ecommerceStores.isActive, true), eq(ecommerceStores.platform, platform))
    ).limit(1);
    return result[0] || null;
}

/**
 * Does the billing subject `userId` have an active store on `platform`?
 *
 * "Billing subject" = the identity whose subscription row entitles the work —
 * the workspace OWNER (the D-E rule Shopify billing already follows), because
 * one subscription serves every workspace that owner has. So the question is
 * deliberately NOT "does workspace X have a store": a user who owns a
 * Salla-connected workspace is marketplace-billed for their single
 * subscription, whichever workspace they happen to be looking at. Scoping this
 * per-workspace would let the frontend offer an upgrade that the backend guard
 * then refuses — the dead-end the Shopify review caught as H2.
 *
 * The `userId` leg catches stores connected before workspaces existed (and any
 * row whose `workspace_id` is NULL); the owner join catches the normal case,
 * including a store a non-owner member connected. Both legs hit existing
 * indexes (`idx_ecommerce_stores_user_id`, `idx_ecommerce_stores_workspace_id`).
 *
 * Used by the marketplace billing guards (Salla Article 5 today; Zid's
 * marketplace terms are the same shape and will reuse this).
 */
export async function hasActiveStoreForBillingSubject(
    platform: EcommercePlatform,
    userId: string,
): Promise<boolean> {
    const result = await db
        .select({ id: ecommerceStores.id })
        .from(ecommerceStores)
        .leftJoin(workspaces, eq(ecommerceStores.workspaceId, workspaces.id))
        .where(and(
            eq(ecommerceStores.platform, platform),
            eq(ecommerceStores.isActive, true),
            or(
                eq(ecommerceStores.userId, userId),
                eq(workspaces.ownerId, userId),
            ),
        ))
        .limit(1);
    return result.length > 0;
}

/**
 * Resolve the billing SUBJECT for a store row — the identity whose subscription
 * row a marketplace mirror must land on.
 *
 * The D-E rule: entitlements are resolved against the workspace OWNER's
 * subscription (the `hasWhatsAppPlanAccess` pattern), so a mirror written to
 * the connecting member's row would be invisible to every limit check. Falls
 * back to the store's own `userId` for pre-workspace rows and for a
 * `workspace_id` that no longer resolves.
 *
 * One home for both marketplace rails: `shopifyBilling` and `zidBilling` each
 * ask this exact question at the same point in their sync, and a second copy
 * would be a silent place for the two rails' answers to drift apart.
 */
export async function resolveBillingSubjectUserId(store: {
    userId: string;
    workspaceId?: string | null;
}): Promise<string> {
    if (!store.workspaceId) return store.userId;
    const [ws] = await db
        .select({ ownerId: workspaces.ownerId })
        .from(workspaces)
        .where(eq(workspaces.id, store.workspaceId))
        .limit(1);
    return ws?.ownerId ?? store.userId;
}

export interface CreateStoreOptions {
    userId: string;
    platform: EcommercePlatform;
    storeDomain: string;
    accessToken: string;
    refreshToken?: string;
    /** Zid only — the second credential (`Authorization` Bearer token). See db/schema.ts. */
    authorizationToken?: string;
    tokenExpiresAt?: Date;
    /**
     * Descriptive store info from the platform. Typed `unknown` for the reason
     * given on fitStoreScalars: these values are third-party JSON, and declaring
     * them `string` is an assumption the wire is free to break — it did, and it
     * cost an install. They are coerced, never trusted.
     */
    shopInfo?: {
        shopName?: unknown;
        shopEmail?: unknown;
        shopCurrency?: unknown;
        shopTimezone?: unknown;
    };
    platformData?: Record<string, unknown>;
    workspaceId?: string | null;
}

export async function createStore(opts: CreateStoreOptions) {
    // Coerce ONCE, before either branch: the insert and the conflict-update write
    // the same four columns, and a guard applied to only one of them would leave
    // reinstall (the branch a returning merchant takes) still able to fail.
    const scalars = fitStoreScalars({
        storeName: opts.shopInfo?.shopName,
        storeEmail: opts.shopInfo?.shopEmail,
        storeCurrency: opts.shopInfo?.shopCurrency,
        storeTimezone: opts.shopInfo?.shopTimezone,
    }, { platform: opts.platform, storeDomain: opts.storeDomain });

    const { ciphertext: accessCiphertext, iv: accessIv } = encrypt(opts.accessToken);
    // Refresh token is optional — Salla/Zid have one, Shopify offline tokens don't.
    const { ciphertext: refreshCiphertext, iv: refreshIv } = encryptOptional(opts.refreshToken);
    // Authorization token is Zid-only (dual-header auth); undefined elsewhere.
    const { ciphertext: authCiphertext, iv: authIv } = encryptOptional(opts.authorizationToken);

    const result = await db.insert(ecommerceStores).values({
        userId: opts.userId,
        workspaceId: opts.workspaceId ?? undefined,
        platform: opts.platform,
        storeDomain: opts.storeDomain,
        accessToken: accessCiphertext,
        accessTokenIv: accessIv,
        refreshToken: refreshCiphertext,
        refreshTokenIv: refreshIv,
        authorizationToken: authCiphertext,
        authorizationTokenIv: authIv,
        tokenExpiresAt: opts.tokenExpiresAt,
        ...scalars,
        platformData: opts.platformData,
        installedAt: new Date(),
    }).onConflictDoUpdate({
        target: [ecommerceStores.platform, ecommerceStores.storeDomain],
        set: {
            userId: opts.userId,
            workspaceId: opts.workspaceId ?? undefined,
            accessToken: accessCiphertext,
            accessTokenIv: accessIv,
            refreshToken: refreshCiphertext,
            refreshTokenIv: refreshIv,
            authorizationToken: authCiphertext,
            authorizationTokenIv: authIv,
            tokenExpiresAt: opts.tokenExpiresAt,
            ...scalars,
            // MERGE platformData (don't replace) so existing keys — merchantId,
            // webhookStatus — survive a reconnect, and ALWAYS clear tokenHealth so
            // every reconnect path self-heals the needs-reauth flag. The claim path
            // (claimPendingInstall) passes no platformData; Drizzle would omit an
            // undefined value here, leaving a stale tokenHealth:'invalid' (stuck
            // Reconnect banner). The logged-in callback passes only { merchantId }
            // and would otherwise wipe webhookStatus. The jsonb || merge fixes both.
            platformData: sql`coalesce(${ecommerceStores.platformData}, '{}'::jsonb) || ${JSON.stringify({ ...(opts.platformData ?? {}), tokenHealth: 'ok' })}::jsonb`,
            isActive: true,
            uninstalledAt: null,
            updatedAt: new Date(),
        },
    }).returning();

    // A connected store knows where the BUSINESS is — better than the device
    // that happens to open Settings, and better than the placeholder every
    // workspace inherits. Only adopted when the merchant has never set one
    // (see adoptTimezoneIfUnset); never fatal to a store connect.
    // `scalars`, not the raw shopInfo: this writes the merchant's workspace
    // timezone, so it must be the validated string, never whatever shape the
    // platform happened to send.
    if (opts.workspaceId && scalars.storeTimezone) {
        try {
            await workspaceSettingsService.adoptTimezoneIfUnset(opts.workspaceId, scalars.storeTimezone);
        } catch (err) {
            captureError(err, 'Failed to adopt store timezone', {
                tags: { service: 'ecommerce', action: 'adopt-store-timezone' },
                extra: { workspaceId: opts.workspaceId, platform: opts.platform },
            });
        }
    }

    return result[0];
}

/**
 * How long an embedded-app credential may sit UNUSED before it stops opening
 * sessions. It rides a URL (platform iframe src, and therefore access logs and
 * browser history), so an unbounded lifetime means a single logged value is a
 * permanent merchant session. 30 days is comfortably longer than any real gap
 * between a merchant opening the app from their dashboard, and every successful
 * exchange pushes it out again — an active merchant never notices it.
 * An expired credential is not an error state: the platform re-frames the app,
 * the merchant reinstalls or reopens, and a fresh one is minted.
 */
export const EMBEDDED_TOKEN_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Persist (or clear, with null) the SHA-256 of a store's embedded-app lookup
 * UUID. Zid-only today: the UUID is registered with Zid and comes back as
 * `?token=` on the dashboard-iframe entry — see services/zid.ts
 * registerEmbeddedToken and services/embeddedSession.ts.
 *
 * Setting a hash also starts its idle clock; clearing it clears the clock, so
 * the two can never disagree.
 */
export async function setEmbeddedTokenHash(storeId: string, hash: string | null) {
    await db.update(ecommerceStores).set({
        embeddedTokenHash: hash,
        embeddedTokenLastUsedAt: hash ? new Date() : null,
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));
}

/**
 * Resolve an ACTIVE store from an embedded-token hash (dashboard-iframe entry).
 * Returns null for an unknown hash, an inactive store, or a credential idle
 * past EMBEDDED_TOKEN_IDLE_MS — the caller cannot tell them apart on purpose
 * (it answers a public endpoint), but it logs which one it was.
 */
export async function getStoreByEmbeddedTokenHash(platform: EcommercePlatform, hash: string) {
    const rows = await db.select().from(ecommerceStores)
        .where(and(
            eq(ecommerceStores.platform, platform),
            eq(ecommerceStores.embeddedTokenHash, hash),
            eq(ecommerceStores.isActive, true),
            // A NULL last-used is a credential minted before this column existed;
            // treat it as fresh rather than locking those merchants out on deploy.
            or(
                isNull(ecommerceStores.embeddedTokenLastUsedAt),
                gt(ecommerceStores.embeddedTokenLastUsedAt, new Date(Date.now() - EMBEDDED_TOKEN_IDLE_MS)),
            ),
        ))
        .limit(1);
    return rows[0] ?? null;
}

/** Push out the idle clock after a successful exchange. Never fails the caller. */
export async function touchEmbeddedTokenUse(storeId: string) {
    await db.update(ecommerceStores)
        .set({ embeddedTokenLastUsedAt: new Date() })
        .where(eq(ecommerceStores.id, storeId));
}

export async function updateStoreTokens(storeId: string, tokens: {
    accessToken: string;
    refreshToken?: string;
    /** Zid only — rotated `Authorization` Bearer token, when the refresh response carries one. */
    authorizationToken?: string;
    tokenExpiresAt?: Date;
}) {
    const { ciphertext: accessCiphertext, iv: accessIv } = encrypt(tokens.accessToken);
    const { ciphertext: refreshCiphertext, iv: refreshIv } = encryptOptional(tokens.refreshToken);
    const { ciphertext: authCiphertext, iv: authIv } = encryptOptional(tokens.authorizationToken);

    const updateSet: Record<string, unknown> = {
        accessToken: accessCiphertext,
        accessTokenIv: accessIv,
        updatedAt: new Date(),
    };

    if (tokens.tokenExpiresAt) {
        updateSet.tokenExpiresAt = tokens.tokenExpiresAt;
    }

    // Only overwrite the stored refresh token when a new one was supplied —
    // some refresh responses omit it, and we must not clobber the existing pair.
    if (refreshCiphertext) {
        updateSet.refreshToken = refreshCiphertext;
        updateSet.refreshTokenIv = refreshIv;
    }

    // Same rule for the Zid Authorization token — refresh responses that omit it
    // must not clobber the stored pair.
    if (authCiphertext) {
        updateSet.authorizationToken = authCiphertext;
        updateSet.authorizationTokenIv = authIv;
    }

    // A successful token write means the store is healthy again — clear any prior
    // needs-reauth flag set by markStoreNeedsReauth. Only touch platformData when it
    // was actually flagged, so we never clobber other keys on a routine refresh.
    const [existing] = await db.select({ platformData: ecommerceStores.platformData })
        .from(ecommerceStores).where(eq(ecommerceStores.id, storeId)).limit(1);
    const pd = (existing?.platformData as Record<string, unknown>) || {};
    if (pd.tokenHealth === 'invalid') {
        updateSet.platformData = { ...pd, tokenHealth: 'ok' };
    }

    await db.update(ecommerceStores).set(updateSet)
        .where(eq(ecommerceStores.id, storeId));
}

// Blank the encrypted OAuth tokens the instant a store goes inactive (uninstall or
// merchant disconnect) — defense-in-depth so valid tokens don't sit at rest for the
// 30-day retention window before purgeStore hard-deletes the row. accessToken/IV are
// NOT NULL, so they're set to '' (empty, un-decryptable); refresh token/IV → NULL.
// A reconnect overwrites all four via createStore's onConflictDoUpdate, and no code
// path reads tokens for an inactive store (resolveStoreAccessToken + the sync/refresh
// selectors all gate on isActive), so this is safe.
//
// The embedded-app credential is blanked here TOO, not only by the Zid
// disconnect hook. The lookup already filters on isActive, so a surviving hash
// is not exploitable today — but that makes the safety a property of one
// selector rather than of the data. Clearing it at the single point where a
// store goes inactive makes a live credential on a dead store impossible
// instead of merely unreachable (AI_INSTRUCTIONS Rule 14).
const BLANKED_TOKEN_FIELDS = {
    accessToken: '',
    accessTokenIv: '',
    refreshToken: null,
    refreshTokenIv: null,
    embeddedTokenHash: null,
    embeddedTokenLastUsedAt: null,
} as const;

export async function deactivateStore(platform: EcommercePlatform, storeDomain: string) {
    await db.update(ecommerceStores).set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
        ...BLANKED_TOKEN_FIELDS,
    }).where(and(eq(ecommerceStores.storeDomain, storeDomain), eq(ecommerceStores.platform, platform)));
}

export async function disconnectStore(storeId: string) {
    // Unlink any pages connected to this store
    await db.update(pages).set({ ecommerceStoreId: null, updatedAt: new Date() })
        .where(eq(pages.ecommerceStoreId, storeId));
    // Deactivate the store
    await db.update(ecommerceStores).set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
        ...BLANKED_TOKEN_FIELDS,
    }).where(eq(ecommerceStores.id, storeId));
}

/**
 * Hard-delete a store and everything linked to it (GDPR erasure).
 *
 * Deleting the `ecommerce_stores` row removes its encrypted access/refresh
 * tokens, and FK cascades remove all child data: `ecommerce_products`,
 * `customer_notification_templates`, and `customer_notifications_log` — the last
 * of which holds customer phone + name PII captured from order/cart webhooks.
 * The `pages.ecommerce_store_id` FK is ON DELETE SET NULL, so any linked pages
 * survive (merely unlinked). Unlike `deactivateStore`/`disconnectStore` (which
 * only flip `is_active`), this leaves nothing behind.
 *
 * Used by Shopify's `shop/redact` compliance webhook and the inactive-store purge.
 * Returns true if a store row was found and deleted.
 */
export async function purgeStore(platform: EcommercePlatform, storeDomain: string): Promise<boolean> {
    const store = await getStoreByDomain(platform, storeDomain);
    if (!store) return false;
    await db.delete(ecommerceStores).where(eq(ecommerceStores.id, store.id));
    return true;
}

/**
 * Delete the stored PII for a single customer of a store — the phone + name rows
 * in `customer_notifications_log` (the only customer PII we persist from
 * e-commerce order/cart webhooks). Matched by phone using a last-9-digit
 * comparison so country-code / formatting differences between the redact payload
 * and the stored value don't cause a miss.
 *
 * Used by Shopify's `customers/redact` compliance webhook. Returns the number of
 * rows deleted.
 */
export async function redactCustomerNotifications(
    platform: EcommercePlatform,
    storeDomain: string,
    phone: string,
): Promise<number> {
    const digits = phone.replace(/\D/g, '').slice(-9);
    if (digits.length < 7) return 0; // too short to match safely — avoid over-deleting
    const store = await getStoreByDomain(platform, storeDomain);
    if (!store) return 0;
    const deleted = await db.delete(customerNotificationsLog).where(and(
        eq(customerNotificationsLog.ecommerceStoreId, store.id),
        sql`right(regexp_replace(${customerNotificationsLog.customerPhone}, '[^0-9]', '', 'g'), 9) = ${digits}`,
    )).returning({ id: customerNotificationsLog.id });
    return deleted.length;
}

/**
 * Link an e-commerce store to a Facebook/Instagram page (with ownership validation)
 */
export async function linkStoreToPage(storeId: string, pageId: string, workspaceId: string) {
    await db.transaction(async (tx) => {
        const page = await tx.select().from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);

        if (!page[0]) {
            throw new Error('Page not found or does not belong to workspace');
        }

        await tx.update(pages).set({ ecommerceStoreId: storeId, updatedAt: new Date() })
            .where(eq(pages.id, pageId));
    });
}

/**
 * Unlink a single page from its e-commerce store (with ownership validation)
 */
export async function unlinkStoreFromPage(pageId: string, workspaceId: string) {
    await db.transaction(async (tx) => {
        const page = await tx.select().from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);

        if (!page[0]) {
            throw new Error('Page not found or does not belong to workspace');
        }

        await tx.update(pages).set({ ecommerceStoreId: null, updatedAt: new Date() })
            .where(eq(pages.id, pageId));
    });
}

// --- Product Summary ---

/** Build the public product URL from platform + domain + handle/slug */
export function buildProductUrl(platform: string | undefined, storeDomain: string, handle: string): string {
    if (platform === 'salla') return `https://${storeDomain}/p/${handle}`;
    if (platform === 'zid') return `https://${storeDomain}/products/${handle}`;
    // shopify + default
    return `https://${storeDomain}/products/${handle}`;
}

/**
 * Build a structured product summary for AI consumption (~1200 chars max).
 * Includes store URL and per-product links when handles are available.
 */
export async function buildProductSummary(storeId: string): Promise<string> {
    const [store] = await db.select({
        storeDomain: ecommerceStores.storeDomain,
        platform: ecommerceStores.platform,
    }).from(ecommerceStores).where(eq(ecommerceStores.id, storeId)).limit(1);

    const products = await db.select().from(ecommerceProducts)
        .where(and(eq(ecommerceProducts.ecommerceStoreId, storeId), eq(ecommerceProducts.status, 'active')))
        .orderBy(ecommerceProducts.id)
        .limit(15);

    if (products.length === 0) return '';

    const lines: string[] = [];

    if (store?.storeDomain) {
        lines.push(`Store: https://${store.storeDomain}`);
    }

    lines.push('Top Products:');

    for (const p of products) {
        const parts = [p.title];
        if (p.priceRange) parts.push(p.priceRange);
        if (p.variantSummary) parts.push(p.variantSummary);

        // null = untracked/unlimited → in stock. Checked FIRST because `null <= 5` is true in JS.
        if (p.totalInventory === null) parts.push('in stock');
        else if (p.totalInventory === 0) parts.push('out of stock');
        else if (p.totalInventory <= 5) parts.push('low stock');
        else parts.push('in stock');

        if (p.handle && store?.storeDomain) {
            parts.push(buildProductUrl(store.platform, store.storeDomain, p.handle));
        }

        lines.push(parts.join(' — '));
    }

    let summary = lines.join('\n');
    if (summary.length > 1200) {
        const truncated = summary.slice(0, 1200);
        const lastNewline = truncated.lastIndexOf('\n');
        summary = lastNewline > 0 ? truncated.slice(0, lastNewline) + '\n...' : truncated.slice(0, 1197) + '...';
    }

    return summary;
}

// --- Cache Invalidation ---

/**
 * Invalidate AI reply caches for all pages linked to an e-commerce store.
 *
 *   1. Computes next kbVersion per page (does NOT activate it yet)
 *   2. Flushes Redis exact-match AI cache keys
 *   3. Deletes semantic_cache rows for affected pages
 *   4. Re-ingests KB + products into RAG (ingestFullPage atomically activates the version after chunks are stored)
 */
export async function invalidateCachesForStore(storeId: string): Promise<number> {
    try {
        const linkedPages = await db.select({ id: pages.id })
            .from(pages)
            .where(eq(pages.ecommerceStoreId, storeId));

        if (linkedPages.length === 0) return 0;

        const pageIds = linkedPages.map(p => p.id);

        // 1. Compute next kbVersion for each page (DON'T activate yet — wait for ingestion)
        //    kbActiveVersion is only set by ingestFullPage after ALL chunks are stored,
        //    so retrieval continues using the previous (complete) version until the new one is ready.
        const nextVersionByPage: Record<string, number> = {};
        for (const pageId of pageIds) {
            const [row] = await db.select({ kbActiveVersion: pages.kbActiveVersion })
                .from(pages).where(eq(pages.id, pageId)).limit(1);
            nextVersionByPage[pageId] = (row?.kbActiveVersion ?? 0) + 1;
        }

        // 2. Flush Redis exact AI cache entries
        try {
            await redisScanDelete('cache:ai_reply:*');
        } catch {
            // Redis unavailable — semantic cache version bump is sufficient
        }

        // 3. Delete semantic_cache rows for affected pages
        for (const pageId of pageIds) {
            try {
                await db.execute(sql`DELETE FROM semantic_cache WHERE page_id = ${pageId}`);
            } catch {
                // Table may not exist in test environments
            }
        }

        // 4. Re-ingest linked pages into RAG with KB text + policies + ALL product chunks.
        //    Policies are appended to KB text so they become searchable RAG chunks
        //    (otherwise they're lost when RAG overrides the static KB blob).
        const [storeInfo] = await db.select({
            policiesSummary: ecommerceStores.policiesSummary,
            storeDomain: ecommerceStores.storeDomain,
            platform: ecommerceStores.platform,
        }).from(ecommerceStores).where(eq(ecommerceStores.id, storeId)).limit(1);
        const policiesText = storeInfo?.policiesSummary ?? '';

        const allProducts = await db.select().from(ecommerceProducts)
            .where(and(
                eq(ecommerceProducts.ecommerceStoreId, storeId),
                eq(ecommerceProducts.status, 'active'),
            ));

        const productData = allProducts.map(p => ({
            platformProductId: p.platformProductId,
            handle: p.handle,
            productUrl: (p.handle && storeInfo?.storeDomain)
                ? buildProductUrl(storeInfo.platform, storeInfo.storeDomain, p.handle)
                : null,
            title: p.title,
            description: p.description,
            productType: p.productType,
            vendor: p.vendor,
            status: p.status || 'active',
            priceRange: p.priceRange,
            currency: p.currency,
            totalInventory: p.totalInventory,
            hasVariants: p.hasVariants ?? false,
            variantSummary: p.variantSummary,
            tags: p.tags,
        }));

        for (const pageId of pageIds) {
            try {
                const nextVersion = nextVersionByPage[pageId];
                if (!nextVersion) continue;

                const [page] = await db
                    .select({ knowledgeBase: pages.knowledgeBase })
                    .from(pages)
                    .where(eq(pages.id, pageId))
                    .limit(1);

                const { getIngestionService } = await import('./pages');
                const ingestion = getIngestionService();
                if (ingestion) {
                    // Combine page KB + store policies so both are RAG-indexed
                    const kbWithPolicies = [page?.knowledgeBase, policiesText]
                        .filter(Boolean).join('\n\n') || undefined;
                    await ingestion.ingestFullPage(
                        pageId,
                        kbWithPolicies,
                        productData,
                        nextVersion,
                    );
                }
            } catch (error) {
                captureError(error, 'Page RAG ingestion failed during KB sync', {
                    tags: { service: 'ecommerce' },
                    extra: { storeId, pageId },
                });
            }
        }

        return pageIds.length;
    } catch (error) {
        captureError(error, 'E-commerce cache invalidation failed', {
            tags: { service: 'ecommerce' },
            extra: { storeId },
        });
        return 0;
    }
}

/**
 * Does this store actually contribute policy text (delivery, payment, returns)
 * to replies? THE single definition of "the store answers policy questions":
 * `getStorePolicies` / `getStoreContextForAI` (what the model receives) and
 * `getPages`' `storeAnswersPolicies` page flag (what /business tells the
 * merchant) all derive from it.
 *
 * One definition on purpose. `pages.ecommerce_store_id` alone is NOT proof the
 * store answers anything — it survives a platform-side uninstall
 * (`deactivateStore` keeps the link for reconnect) and a live store can sync
 * with no policy text. The UI once re-expressed this rule separately, drifted,
 * and told merchants «يجيب عنها متجرك المتصل» while the model received nothing.
 * If the rule changes (trimming, a productSummary condition), change it HERE —
 * every claim and every prompt moves together.
 */
export function storeAnswersPolicies(
    store: { isActive?: boolean | null; policiesSummary?: string | null } | null | undefined,
): boolean {
    return !!store?.isActive && !!store.policiesSummary;
}

/** Fetch just the policiesSummary for a store (return, warranty, delivery, payment). */
export async function getStorePolicies(ecommerceStoreId: string): Promise<string | undefined> {
    const store = await getStoreById(ecommerceStoreId);
    if (!store || !storeAnswersPolicies(store)) return undefined;
    return store.policiesSummary || undefined;
}

/** Fetch store policies + product catalog summary in a single DB call for AI context. */
export async function getStoreContextForAI(ecommerceStoreId: string): Promise<{
    storePolicies?: string;
    productCatalog?: string;
}> {
    const store = await getStoreById(ecommerceStoreId);
    if (!store || !store.isActive) return {};
    return {
        storePolicies: storeAnswersPolicies(store) ? store.policiesSummary || undefined : undefined,
        productCatalog: store.productSummary || undefined,
    };
}

// --- KB Enrichment ---

/**
 * Get enriched knowledge base: e-commerce products + policies + page KB
 * Priority: 1) Products (~800 chars)  2) Policies (~200 chars)  3) Page KB (remaining space)
 */
export async function getEnrichedKnowledgeBase(pageKB: string | undefined, ecommerceStoreId: string): Promise<string> {
    const store = await getStoreById(ecommerceStoreId);
    if (!store || !store.isActive) return pageKB || '';

    const productSection = store.productSummary || '';
    const policySection = store.policiesSummary || '';

    const storeSection = [productSection, policySection].filter(Boolean).join('\n');
    const remaining = KB_MAX_CHARS - storeSection.length;
    const pageSection = (pageKB && remaining > 100) ? pageKB.slice(0, remaining) : '';

    return [storeSection, pageSection].filter(Boolean).join('\n\n');
}

// --- List products for frontend ---

export async function getProducts(storeId: string): Promise<EcommerceProduct[]> {
    const rows = await db.select().from(ecommerceProducts)
        .where(eq(ecommerceProducts.ecommerceStoreId, storeId));

    return rows.map(r => ({
        id: r.id,
        ecommerceStoreId: r.ecommerceStoreId,
        platformProductId: r.platformProductId,
        handle: r.handle,
        title: r.title,
        description: r.description,
        productType: r.productType,
        vendor: r.vendor,
        status: r.status || 'active',
        priceRange: r.priceRange,
        currency: r.currency,
        totalInventory: r.totalInventory,
        hasVariants: r.hasVariants || false,
        variantSummary: r.variantSummary,
        tags: r.tags,
        imageUrl: r.imageUrl,
    }));
}

// --- Pending Install Flow ---

/**
 * Create a pending install for unauthenticated users.
 * Encrypts the access token and stores it with a 30-minute TTL.
 * Deletes any older pending records for the same store domain + platform.
 */
export async function createPendingInstall(platform: EcommercePlatform, data: {
    storeDomain: string;
    accessToken: string;
    refreshToken?: string;
    /** Zid only — the second credential (`Authorization` Bearer token). */
    authorizationToken?: string;
    tokenExpiresAt?: Date;
    scopes?: string;
    nonce: string;
    // Salla Easy Mode (app.store.authorize): the install arrives server-to-server with a
    // numeric merchant id and no browser cookie. Persisting it lets a logged-in merchant
    // claim by merchant id. The cookie/OAuth flow passes neither.
    merchantId?: string;
    storeName?: string;
    // Default 30 min (cookie claim, right after login). Easy-Mode installs may not be
    // claimed for hours/days (the merchant lands separately), so they pass a longer TTL.
    ttlMs?: number;
}): Promise<string> {
    // Delete older pending records for same store + platform
    await db.delete(pendingEcommerceInstalls).where(
        and(
            eq(pendingEcommerceInstalls.storeDomain, data.storeDomain),
            eq(pendingEcommerceInstalls.platform, platform),
            eq(pendingEcommerceInstalls.status, 'pending')
        )
    );

    // Easy Mode keys the install by merchant id, not storeDomain. Dedup any prior pending
    // row for the same merchant too, so a token re-fire before the merchant claims
    // REPLACES the row (fresh tokens) rather than duplicating it. Separate statement (not
    // an OR with the storeDomain delete) so we never over-delete an unrelated merchant.
    if (data.merchantId) {
        await db.delete(pendingEcommerceInstalls).where(
            and(
                eq(pendingEcommerceInstalls.merchantId, data.merchantId),
                eq(pendingEcommerceInstalls.platform, platform),
                eq(pendingEcommerceInstalls.status, 'pending')
            )
        );
    }

    const { ciphertext, iv } = encrypt(data.accessToken);
    // Carry the refresh token + expiry through to the claim so the resulting
    // store is refreshable. Without this, app-store (logged-out) installs of
    // Salla/Zid produce stores that silently die when the access token expires.
    const { ciphertext: refreshCiphertext, iv: refreshIv } = encryptOptional(data.refreshToken);
    // Zid dual-header auth: carry the Authorization token through to the claim too,
    // or the claimed store can never call the Zid API.
    const { ciphertext: authCiphertext, iv: authIv } = encryptOptional(data.authorizationToken);

    const result = await db.insert(pendingEcommerceInstalls).values({
        platform,
        storeDomain: data.storeDomain,
        accessToken: ciphertext,
        accessTokenIv: iv,
        refreshToken: refreshCiphertext,
        refreshTokenIv: refreshIv,
        authorizationToken: authCiphertext,
        authorizationTokenIv: authIv,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes || null,
        merchantId: data.merchantId || null,
        // Display-only ("connect your store '<name>'") and platform-sourced, so
        // clamped like the store scalars. merchantId above is NOT clamped — it
        // is the claim-matching identity, and a truncated identity that silently
        // matches nothing is worse than a loud insert failure.
        storeName: fitVarchar(data.storeName, pendingEcommerceInstalls.storeName) || null,
        nonce: data.nonce,
        status: 'pending',
        expiresAt: new Date(Date.now() + (data.ttlMs ?? 30 * 60 * 1000)),
    }).returning();

    return result[0].id;
}

/** Default TTL for a Salla Easy-Mode pending install (the merchant may not open Jawab24
 *  for a while after installing from the App Store). 7 days; the carried refresh token
 *  (30-day life) keeps the claimed store usable even near the end of this window. */
export const EASY_MODE_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Thrown by a claim when the ownership verifier ran and the logged-in user does NOT own
 * the store behind the pending install. Mapped to 403 by the claim handlers.
 */
export class ClaimOwnershipError extends Error {
    constructor() {
        super('Claim rejected: logged-in user does not own this store');
        this.name = 'ClaimOwnershipError';
    }
}

/**
 * Thrown by a claim when ownership could not be VERIFIED (e.g. the platform API call that
 * proves ownership failed) — distinct from a proven mismatch. Mapped to 502 by the claim
 * handlers so the merchant retries (for Salla: "Reauthorize App" re-pushes a fresh token).
 */
export class ClaimVerificationUnavailableError extends Error {
    constructor(cause?: unknown) {
        super('Claim ownership verification unavailable');
        this.name = 'ClaimVerificationUnavailableError';
        this.cause = cause;
    }
}

/**
 * Context passed to a claim's webhook-registration callback beyond the basic
 * (storeDomain, accessToken) pair: the just-created store id (Zid embeds it in each
 * subscription's target_url) and the decrypted Zid Authorization token (dual-header auth).
 */
export interface ClaimWebhookContext {
    storeId: string;
    authorizationToken?: string;
}

/**
 * Claim a pending install: decrypt token, create ecommerce_stores row, mark as claimed.
 * Accepts an optional registerWebhooks callback for platform-specific webhook setup.
 * Returns the new store or null if pending record is invalid/expired.
 *
 * `verifyOwnershipFn` (when provided) receives the DECRYPTED access token and must return
 * true iff the claiming user owns the store — it runs before any store row is written and
 * a false throws ClaimOwnershipError, leaving the pending row untouched.
 */
export async function claimPendingInstall(
    pendingId: string,
    userId: string,
    platform: EcommercePlatform,
    registerWebhooksFn?: (storeDomain: string, accessToken: string, ctx?: ClaimWebhookContext) => Promise<WebhookRegistrationResult | void>,
    saveWebhookStatusFn?: (storeId: string, webhookStatus: WebhookRegistrationResult) => Promise<void>,
    verifyOwnershipFn?: (decryptedAccessToken: string) => Promise<boolean>,
) {
    const result = await db.select().from(pendingEcommerceInstalls)
        .where(eq(pendingEcommerceInstalls.id, pendingId))
        .limit(1);

    const pending = result[0];
    if (!pending) return null;

    // Validate status, expiry, and platform match
    if (pending.status !== 'pending' || pending.expiresAt < new Date()) return null;
    if (pending.platform !== platform) return null;

    return finalizeClaim(pending, userId, platform, registerWebhooksFn, saveWebhookStatusFn, verifyOwnershipFn);
}

/**
 * Claim a Salla Easy-Mode pending install by its merchant id (no cookie). Used after the
 * merchant lands on the post-install page and logs in. Picks the newest pending row for
 * the (platform, merchantId). Returns null if none / expired.
 *
 * SECURITY: the merchant id is CLIENT-SUPPLIED and only *selects* the pending row — it is
 * never proof of ownership. Callers MUST pass `verifyOwnershipFn` (or have otherwise
 * proven ownership); the Salla handler proves it by matching the store's registered email
 * (fetched live with the webhook-pushed token) against the logged-in user's email.
 */
export async function claimPendingInstallByMerchantId(
    merchantId: string,
    userId: string,
    platform: EcommercePlatform,
    registerWebhooksFn?: (storeDomain: string, accessToken: string, ctx?: ClaimWebhookContext) => Promise<WebhookRegistrationResult | void>,
    saveWebhookStatusFn?: (storeId: string, webhookStatus: WebhookRegistrationResult) => Promise<void>,
    verifyOwnershipFn?: (decryptedAccessToken: string) => Promise<boolean>,
) {
    const result = await db.select().from(pendingEcommerceInstalls)
        .where(and(
            eq(pendingEcommerceInstalls.platform, platform),
            eq(pendingEcommerceInstalls.merchantId, merchantId),
            eq(pendingEcommerceInstalls.status, 'pending'),
        ))
        .orderBy(desc(pendingEcommerceInstalls.createdAt))
        .limit(1);

    const pending = result[0];
    if (!pending) return null;
    if (pending.expiresAt < new Date()) return null;

    return finalizeClaim(pending, userId, platform, registerWebhooksFn, saveWebhookStatusFn, verifyOwnershipFn);
}

/** Non-secret summary of a pending install, for the post-install claim screen. */
export interface PendingInstallSummary {
    id: string;
    storeDomain: string;
    storeName: string | null;
    merchantId: string | null;
    createdAt: Date | null;
}

/**
 * List unclaimed, unexpired Easy-Mode pending installs for a platform, optionally scoped
 * to one merchant id. Returns NON-SECRET columns only (never tokens/nonce) and only rows
 * that carry a merchantId (Easy Mode) — cookie-flow rows are never exposed.
 */
export async function listPendingInstalls(
    platform: EcommercePlatform,
    merchantId?: string,
): Promise<PendingInstallSummary[]> {
    const conditions = [
        eq(pendingEcommerceInstalls.platform, platform),
        eq(pendingEcommerceInstalls.status, 'pending'),
        isNotNull(pendingEcommerceInstalls.merchantId),
        gt(pendingEcommerceInstalls.expiresAt, new Date()),
    ];
    if (merchantId) conditions.push(eq(pendingEcommerceInstalls.merchantId, merchantId));

    return db.select({
        id: pendingEcommerceInstalls.id,
        storeDomain: pendingEcommerceInstalls.storeDomain,
        storeName: pendingEcommerceInstalls.storeName,
        merchantId: pendingEcommerceInstalls.merchantId,
        createdAt: pendingEcommerceInstalls.createdAt,
    }).from(pendingEcommerceInstalls)
        .where(and(...conditions))
        .orderBy(desc(pendingEcommerceInstalls.createdAt));
}

/**
 * Shared tail of every pending-install claim (by id or by merchant id): owner-conflict
 * check, token decrypt, workspace resolve, store create/update, template seed, mark
 * claimed, and inline webhook registration. The two public claim entrypoints differ only
 * in how they FIND the pending row.
 */
async function finalizeClaim(
    pending: typeof pendingEcommerceInstalls.$inferSelect,
    userId: string,
    platform: EcommercePlatform,
    registerWebhooksFn?: (storeDomain: string, accessToken: string, ctx?: ClaimWebhookContext) => Promise<WebhookRegistrationResult | void>,
    saveWebhookStatusFn?: (storeId: string, webhookStatus: WebhookRegistrationResult) => Promise<void>,
    verifyOwnershipFn?: (decryptedAccessToken: string) => Promise<boolean>,
) {
    // Check if store is already linked to another user
    const existingStore = await getStoreByDomain(platform, pending.storeDomain);
    if (existingStore && existingStore.userId !== userId && existingStore.isActive) {
        throw new Error(`This ${platform} store is already connected to another account`);
    }

    // Decrypt tokens. Refresh token is optional — absent for Shopify and for
    // pending rows created before refresh-token support — so the store stays
    // refreshable (Salla/Zid) without breaking the no-refresh-token case.
    const accessToken = decrypt(pending.accessToken, pending.accessTokenIv);
    const refreshToken = decryptOptional(pending.refreshToken, pending.refreshTokenIv);
    // Zid dual-header auth (undefined for Shopify/Salla rows).
    const authorizationToken = decryptOptional(pending.authorizationToken, pending.authorizationTokenIv);

    // Ownership proof gate — BEFORE any write. A false is a proven mismatch (403); a
    // verifier that cannot run at all should throw ClaimVerificationUnavailableError
    // itself so the handler can distinguish "retry later" from "not yours".
    if (verifyOwnershipFn) {
        const ownsStore = await verifyOwnershipFn(accessToken);
        if (!ownsStore) throw new ClaimOwnershipError();
    }

    // Resolve user's workspace for store scoping
    const [membership] = await db.select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers).where(eq(workspaceMembers.userId, userId)).limit(1);
    const workspaceId = membership?.workspaceId || null;

    // Create/update store
    const store = await createStore({
        userId,
        platform,
        storeDomain: pending.storeDomain,
        accessToken,
        refreshToken,
        authorizationToken,
        tokenExpiresAt: pending.tokenExpiresAt ?? undefined,
        // Carry the Salla Easy-Mode merchant id so the webhook getStoreByMerchantId
        // fallback can resolve this store. A pending row with a merchantId is, by
        // construction, an Easy-Mode install (app.store.authorize stages it; the
        // cookie/OAuth flow never sets merchantId) — so also stamp tokenSource so the
        // proactive pull-refresh can skip it (see getStoresNeedingTokenRefresh). Null
        // on the cookie/OAuth flow → undefined → createStore's jsonb merge leaves
        // platformData untouched (identical to before).
        platformData: pending.merchantId
            ? { merchantId: pending.merchantId, tokenSource: 'easy_mode' }
            : undefined,
        workspaceId,
    });

    // Seed default notification templates for the new store (non-blocking, safe to retry)
    customerNotificationService.seedDefaults(store.id).catch(err => {
        captureError(err, 'Failed to seed customer notification templates', {
            tags: { service: 'ecommerce' },
            extra: { storeId: store.id, platform },
        });
    });

    // Mark pending as claimed
    await db.update(pendingEcommerceInstalls).set({
        status: 'claimed',
        claimedByUserId: userId,
    }).where(eq(pendingEcommerceInstalls.id, pending.id));

    // Register webhooks INLINE (must complete before we return). The previous
    // fire-and-forget pattern lost registrations whenever the calling process
    // was short-lived (CLI scripts, lambdas, deploy-time restarts) — Shopify
    // never received the request, so no webhooks landed and incremental
    // updates failed silently. Bug A-1.9 in docs/testing/SHOPIFY_TEST_PLAN.md.
    if (registerWebhooksFn) {
        let webhookStatus: WebhookRegistrationResult | void;
        try {
            webhookStatus = await registerWebhooksFn(pending.storeDomain, accessToken, {
                storeId: store.id,
                authorizationToken,
            });
        } catch (err) {
            captureError(err, `${platform} webhook registration after claim failed`, {
                tags: { service: platform, stage: 'webhook-registration' },
                extra: { storeId: store.id },
            });
            // Persist a 'pending' marker so the integrations API surfaces the
            // failure even before retries run. Without this, mapToEcommerceStore
            // returns webhookHealth: 'unknown' and the merchant has no signal.
            if (saveWebhookStatusFn) {
                await saveWebhookStatusFn(store.id, {
                    registered: [],
                    failed: [{ topic: 'all', error: err instanceof Error ? err.message : String(err) }],
                    lastAttempt: new Date().toISOString(),
                }).catch(() => { /* swallowed — error already captured above */ });
            }
            await scheduleWebhookRetry(store.id, platform);
            // Don't fail the install for a webhook hiccup — the retry queue
            // will pick it up. The merchant sees a 'pending' badge until then.
            return store;
        }

        if (saveWebhookStatusFn && webhookStatus) {
            try {
                await saveWebhookStatusFn(store.id, webhookStatus);
            } catch (err) {
                captureError(err, `${platform} webhook status persist failed`, {
                    tags: { service: platform, stage: 'webhook-status-persist' },
                    extra: { storeId: store.id },
                });
            }
            // Partial-failure → schedule a retry so the missing topics get re-attempted.
            if (webhookStatus.failed.length > 0) {
                await scheduleWebhookRetry(store.id, platform);
            }
        }
    }

    return store;
}

/** Enqueue a webhook-registration retry. Failures here are non-fatal: the install
 *  has already succeeded; missing webhooks will be re-attempted by the worker. */
async function scheduleWebhookRetry(storeId: string, platform: EcommercePlatform): Promise<void> {
    try {
        const { enqueueWebhookRetry } = await import('../lib/webhookRetryQueue');
        await enqueueWebhookRetry({ storeId, platform });
    } catch (err) {
        captureError(err, `${platform} webhook retry enqueue failed`, {
            tags: { service: platform, stage: 'webhook-retry-enqueue' },
            extra: { storeId },
        });
    }
}

/**
 * Clean up expired pending installs for a given platform
 */
export async function cleanupExpiredInstalls(platform: EcommercePlatform): Promise<number> {
    const result = await db.delete(pendingEcommerceInstalls).where(
        and(
            eq(pendingEcommerceInstalls.platform, platform),
            eq(pendingEcommerceInstalls.status, 'pending'),
            lt(pendingEcommerceInstalls.expiresAt, new Date())
        )
    ).returning();

    return result.length;
}

// --- Map to shared type ---

/**
 * Map a DB row to the EcommerceStore shared type.
 * Note: `shopDomain` alias kept for backward compat with existing Shopify test assertions.
 */
export function mapToEcommerceStore(row: typeof ecommerceStores.$inferSelect): EcommerceStore & { shopDomain: string } {
    const platformData = (row.platformData as Record<string, unknown> | null) ?? null;
    const webhookStatus = (platformData?.webhookStatus as WebhookRegistrationResult | undefined) ?? null;
    return {
        id: row.id,
        userId: row.userId,
        platform: row.platform as EcommercePlatform,
        storeDomain: row.storeDomain,
        shopDomain: row.storeDomain, // temporary alias — remove next PR
        storeName: row.storeName,
        storeEmail: row.storeEmail,
        storeCurrency: row.storeCurrency,
        tokenExpiresAt: row.tokenExpiresAt,
        productCount: row.productCount || 0,
        productSummary: row.productSummary,
        policiesSummary: row.policiesSummary,
        lastSyncAt: row.lastSyncAt,
        isActive: row.isActive ?? true,
        installedAt: row.installedAt,
        webhookHealth: deriveWebhookHealth(webhookStatus),
        needsReauth: platformData?.tokenHealth === 'invalid',
    };
}

// --- Helpers for product sync (used by platform-specific sync functions) ---

export interface NormalizedProduct {
    platformProductId: string;
    handle?: string | null;
    title: string;
    description?: string | null;
    productType?: string | null;
    vendor?: string | null;
    status: string;
    priceRange: string;
    currency: string;
    /** Units in stock, or `null` for untracked/unlimited. `null` is NOT zero — see EcommerceProduct.totalInventory. */
    totalInventory: number | null;
    hasVariants: boolean;
    variantSummary?: string | null;
    tags?: string | null;
    imageUrl?: string | null;
}

/** Map a NormalizedProduct (caller's shape) to the ecommerce_products row shape. */
function toProductRow(storeId: string, p: NormalizedProduct) {
    return {
        ecommerceStoreId: storeId,
        platformProductId: p.platformProductId,
        handle: p.handle ?? null,
        title: p.title,
        description: p.description ?? null,
        productType: p.productType ?? null,
        vendor: p.vendor ?? null,
        status: p.status,
        priceRange: p.priceRange,
        currency: p.currency,
        totalInventory: p.totalInventory,
        hasVariants: p.hasVariants,
        variantSummary: p.variantSummary ?? null,
        tags: p.tags ?? null,
        imageUrl: p.imageUrl ?? null,
    };
}

/**
 * Single source of truth for the `ON CONFLICT DO UPDATE` set clause used by
 * both `replaceProductsAndRebuildSummary` (full sync) and `upsertSingleProduct`
 * (per-row webhook). When a column is added to `ecommerce_products`, mirror it
 * here once and both paths pick it up.
 */
function productUpsertSetClause() {
    return {
        handle: sql`excluded.handle`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        productType: sql`excluded.product_type`,
        vendor: sql`excluded.vendor`,
        status: sql`excluded.status`,
        priceRange: sql`excluded.price_range`,
        currency: sql`excluded.currency`,
        totalInventory: sql`excluded.total_inventory`,
        hasVariants: sql`excluded.has_variants`,
        variantSummary: sql`excluded.variant_summary`,
        tags: sql`excluded.tags`,
        imageUrl: sql`excluded.image_url`,
        updatedAt: new Date(),
    };
}

/**
 * Refresh `ecommerce_stores` summary fields after a product mutation.
 * Used by both full-sync and single-product paths so the post-write metadata
 * stays consistent (productCount + productSummary + lastSyncAt + cache flush).
 *
 * `productCount` is queried from the table, not passed in, so callers don't
 * have to track it themselves.
 */
async function refreshStoreProductMetadata(storeId: string): Promise<number> {
    const productSummary = await buildProductSummary(storeId);
    const [{ count }] = await db.select({
        count: sql<number>`count(*)::int`,
    }).from(ecommerceProducts).where(eq(ecommerceProducts.ecommerceStoreId, storeId));

    await db.update(ecommerceStores).set({
        productCount: count,
        productSummary,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));

    await invalidateCachesForStore(storeId);
    return count;
}

/**
 * Atomically replace all products for a store and rebuild summary.
 * Platform services call this after fetching products from their API.
 *
 * Products are capped at PRODUCT_SAFETY_CAP as an abuse/runaway guard. Per-plan
 * `plans.maxProducts` is intentionally NOT enforced here — silently hiding a merchant's
 * products is a pricing/product decision, and the AI-prompt side is already bounded
 * separately (buildProductSummary caps the summary that reaches the model). Returns
 * `capped: true` when the catalog exceeded the safety cap so callers can surface it.
 */
export async function replaceProductsAndRebuildSummary(
    storeId: string,
    products: NormalizedProduct[],
): Promise<{ synced: number; capped: boolean }> {
    const capped = products.length > PRODUCT_SAFETY_CAP;
    if (capped) {
        products = products.slice(0, PRODUCT_SAFETY_CAP);
        captureError(
            new Error(`Product catalog exceeded PRODUCT_SAFETY_CAP (${PRODUCT_SAFETY_CAP})`),
            'E-commerce product sync hit the safety cap — catalog truncated',
            { level: 'warning', tags: { service: 'ecommerce-sync' }, extra: { storeId, cap: PRODUCT_SAFETY_CAP } },
        );
    }

    // Per-row UPSERT inside a transaction.
    //
    // Previous implementation deleted all rows then inserted fresh ones —
    // that wiped every `ecommerce_products.id` on every sync and rotated IDs
    // even for products that didn't change. Bug B-3.1 in the test plan.
    //
    // Transaction wrap (A-1.4) still applies: concurrent syncs serialize on
    // the unique index instead of racing.
    await db.transaction(async (tx) => {
        if (products.length > 0) {
            const rows = products.map(p => toProductRow(storeId, p));

            // Chunk the upsert: toProductRow has 15 columns, so a single .values(rows)
            // insert binds 15×N params and would blow past Postgres's 65535-parameter
            // limit once a catalog nears the safety cap. 1000 rows/batch = 15k params.
            for (let i = 0; i < rows.length; i += PRODUCT_INSERT_BATCH_SIZE) {
                await tx.insert(ecommerceProducts).values(rows.slice(i, i + PRODUCT_INSERT_BATCH_SIZE)).onConflictDoUpdate({
                    target: [ecommerceProducts.ecommerceStoreId, ecommerceProducts.platformProductId],
                    set: productUpsertSetClause(),
                });
            }

            // Remove products that no longer exist in the platform catalog.
            const currentIds = rows.map(r => r.platformProductId);
            await tx.delete(ecommerceProducts).where(
                and(
                    eq(ecommerceProducts.ecommerceStoreId, storeId),
                    notInArray(ecommerceProducts.platformProductId, currentIds),
                )
            );
        } else {
            // Empty catalog → drop everything for this store.
            await tx.delete(ecommerceProducts).where(eq(ecommerceProducts.ecommerceStoreId, storeId));
        }
    });

    await refreshStoreProductMetadata(storeId);
    return { synced: products.length, capped };
}

/**
 * Upsert a single product by (storeId, platformProductId). Used by
 * single-product webhook handlers (e.g. Shopify products/create + update)
 * so a one-product edit doesn't rotate every other product's internal id.
 *
 * Bug B-3.1: previously every webhook triggered a full re-sync, which
 * delete+inserted everything. Any future FK on ecommerce_products.id would
 * silently break on every product edit.
 */
export async function upsertSingleProduct(storeId: string, product: NormalizedProduct): Promise<void> {
    await db.insert(ecommerceProducts).values(toProductRow(storeId, product)).onConflictDoUpdate({
        target: [ecommerceProducts.ecommerceStoreId, ecommerceProducts.platformProductId],
        set: productUpsertSetClause(),
    });
    await refreshStoreProductMetadata(storeId);
}

/**
 * Delete a single product by (storeId, platformProductId). Used by
 * platform delete webhooks (e.g. Shopify products/delete). Other rows are
 * untouched.
 */
export async function deleteSingleProduct(storeId: string, platformProductId: string): Promise<void> {
    await db.delete(ecommerceProducts).where(
        and(
            eq(ecommerceProducts.ecommerceStoreId, storeId),
            eq(ecommerceProducts.platformProductId, platformProductId),
        )
    );
    await refreshStoreProductMetadata(storeId);
}
