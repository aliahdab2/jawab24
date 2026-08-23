/**
 * Audit Trail Service
 *
 * Logs user and system operations for governance, compliance, and debugging.
 * Uses the existing `logs` table with structured metadata for queryability.
 *
 * Key design decisions:
 *   - Fire-and-forget: never blocks the caller on audit write failure
 *   - Structured: action + entity + metadata for easy querying
 *   - PII-aware: never logs message/comment text, only IDs and counts
 */
import { db } from '../db';
import { logs } from '../db/schema';
import { captureError } from '../utils/sentryHelpers';

export type AuditAction =
    | 'settings.updated'
    | 'template.created'
    | 'template.updated'
    | 'template.deleted'
    | 'rule.created'
    | 'rule.updated'
    | 'rule.deleted'
    | 'page.connected'
    | 'page.disconnected'
    | 'page.auto_reply_toggled'
    | 'page.archived'
    | 'page.unarchived'
    | 'page.reply_mode_changed'
    | 'shopify.connected'
    | 'shopify.disconnected'
    | 'shopify.synced'
    | 'account.deleted'
    | 'account.fb_data_deletion'
    | 'kb.updated'
    | 'cleanup.ran';

export interface AuditEntry {
    // The acting user. Omitted for system-initiated events with no clear actor
    // (e.g. an auto-pause fired by the reply pipeline); the `logs.user_id` column
    // is nullable, and such events are keyed by workspaceId / entityId instead.
    userId?: string;
    workspaceId?: string;      // Workspace context (when available)
    action: AuditAction;
    entityType?: string;       // 'template', 'rule', 'page', 'settings', etc.
    entityId?: string;         // The specific entity affected
    // The page a page-scoped event concerns. Written to the DEDICATED, typed
    // `logs.page_id` column — NOT metadata: it is indexed and type-safe, so it
    // stays the sanctioned filter for page-scoped audit queries. (Historically
    // `metadata->>'entityId'` also returned NULL because jsonb values were
    // double-encoded as strings; fixed by db/jsonbColumn.ts + migration 0148,
    // pinned by test/integration/flagMeta.test.ts and auditAutoReplyToggle.)
    pageId?: string;
    metadata?: Record<string, unknown>; // Structured context (no PII) — READ-only:
    // do not build SQL filters on its sub-keys; see the pageId note above.
}

/** Why a page's auto-reply switch changed. */
export type AutoReplyToggleReason =
    | 'user'         // merchant flipped it in the dashboard
    | 'auto_pause'   // system paused the page after repeated send failures
    | 'trial_block'  // channel already used its one free trial → kept off at connect
    | 'fb_sync';     // Facebook (re)connect / deselect drove the state

export interface AutoReplyToggleEvent {
    pageId: string;
    workspaceId?: string;
    /** The acting user. Pass it for user-initiated changes; OMIT for purely
     *  system-initiated ones (auto-pause) — `actor` is derived from its presence. */
    userId?: string;
    /** The new auto-reply state. */
    enabled: boolean;
    /** Prior state when known (null = birth / unknown). Lets a reader tell a real
     *  transition from a no-op re-save. */
    previous?: boolean | null;
    reason: AutoReplyToggleReason;
    /** Which surface's switch: the FB page (default), Instagram, or WhatsApp. */
    channel?: 'page' | 'instagram' | 'whatsapp';
    /** Extra structured context (no PII), merged into metadata. */
    extra?: Record<string, unknown>;
}

/**
 * Single choke point for auditing a change to a page's auto-reply switch.
 *
 * Every on/off transition — merchant toggle, system auto-pause, Facebook sync —
 * funnels through here so the logged shape never drifts between call sites, and
 * so support can answer "who turned this page on/off, and when?" with one query:
 *
 *   SELECT created_at, user_id, metadata FROM logs
 *   WHERE action = 'page.auto_reply_toggled' AND page_id = '<page-id>'
 *   ORDER BY created_at DESC;
 *
 * The filter is on the typed `page_id` column, NOT `metadata->>` — metadata is
 * stored double-encoded (see the AuditEntry.pageId note). `actor` is derived: a
 * known userId ⇒ a user did it, absence ⇒ system.
 *
 * Fire-and-forget (delegates to {@link auditLog}) — never blocks or throws.
 */
/**
 * Returns the insert's promise. Production callers let it run in the
 * background (`auditLog` never throws); the integration test awaits it
 * instead of sleeping a guessed 100 ms — which lost a race on 2026-08-23
 * under a 10-minute suite and reddened a deploy for nothing.
 */
export function logAutoReplyToggle(event: AutoReplyToggleEvent): Promise<void> {
    return auditLog({
        userId: event.userId,
        workspaceId: event.workspaceId,
        pageId: event.pageId,
        action: 'page.auto_reply_toggled',
        entityType: 'page',
        entityId: event.pageId,
        metadata: {
            enabled: event.enabled,
            previous: event.previous ?? null,
            reason: event.reason,
            actor: event.userId ? 'user' : 'system',
            channel: event.channel ?? 'page',
            ...event.extra,
        },
    });
}

/**
 * Record an audit log entry. Fire-and-forget — never throws.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
    try {
        await db.insert(logs).values({
            userId: entry.userId,
            workspaceId: entry.workspaceId,
            pageId: entry.pageId,
            action: entry.action,
            status: 'audit',
            metadata: {
                entityType: entry.entityType,
                entityId: entry.entityId,
                ...entry.metadata,
            },
        });
    } catch (error) {
        // Never block the caller — audit failures are logged to Sentry
        captureError(error, 'Audit log write failed', {
            tags: { service: 'audit' },
            extra: { action: entry.action, userId: entry.userId },
        });
    }
}
