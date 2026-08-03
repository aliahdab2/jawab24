/**
 * MOVED to @jawab24/shared (packages/shared/src/kbContentClassifier.ts) so the
 * KB editor can run the SAME detector live (pre-save) that this backend uses
 * for `kbWarnings` on `PUT /pages/:id`. This re-export keeps existing backend
 * imports working; new code should import from '@jawab24/shared' directly.
 */
export { detectCatalogLikePatterns } from '@jawab24/shared';
export type { CatalogReason, CatalogDetection } from '@jawab24/shared';
