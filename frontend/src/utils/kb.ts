import type { Page } from '@jawab24/shared';
import { KB_FILLED_MIN_CHARS } from '@jawab24/shared';

/**
 * Minimum knowledge-base length (trimmed chars) for a page to count as
 * "business info filled". Single source of truth in @jawab24/shared — the same
 * constant the backend activation funnel uses for its `kb_filled` milestone, so
 * the dashboard checklist and the funnel can never disagree. Re-exported here as
 * a convenience for frontend call sites.
 */
export { KB_FILLED_MIN_CHARS };

/** True once a page carries real business-info text (>= KB_FILLED_MIN_CHARS, trimmed). */
export function isKbFilled(page: Pick<Page, 'knowledgeBase'>): boolean {
  return (page.knowledgeBase ?? '').trim().length >= KB_FILLED_MIN_CHARS;
}

/**
 * A connected, non-ecommerce page whose KB is empty/short should be nudged to
 * add business info. Ecommerce pages get their product data from the store
 * integration, so they're excluded (mirrors the existing /pages "Add info" chip).
 */
export function needsBusinessInfo(page: Page): boolean {
  return page.isConnected !== false && !page.ecommerceStoreId && !isKbFilled(page);
}
