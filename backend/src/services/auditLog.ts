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
    | 'shopify.connected'
    | 'shopify.disconnected'
    | 'shopify.synced'
    | 'account.deleted'
    | 'account.fb_data_deletion'
    | 'kb.updated'
    | 'cleanup.ran';

export interface AuditEntry {
    userId: string;
    action: AuditAction;
    entityType?: string;       // 'template', 'rule', 'page', 'settings', etc.
    entityId?: string;         // The specific entity affected
    metadata?: Record<string, unknown>; // Structured context (no PII)
}

/**
 * Record an audit log entry. Fire-and-forget — never throws.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
    try {
        await db.insert(logs).values({
            userId: entry.userId,
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
