import crypto from 'crypto';

/**
 * SHA-256 hex digest — the canonical helper for hashing opaque secrets
 * (refresh tokens, invite tokens, FCM tokens) before storage or lookup,
 * so the raw value never lands in the database.
 *
 * Shared here (Rule 10.8) instead of per-service copies in refreshToken /
 * workspaceInvite / notifications.
 */
export function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}
