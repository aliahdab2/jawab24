import type { Page } from '@jawab24/shared';
import { KB_FILLED_MIN_CHARS, isBusinessInfoProvided } from '@jawab24/shared';

/**
 * Minimum knowledge-base length (trimmed chars) for a page to count as
 * "business info filled". Single source of truth in @jawab24/shared — the same
 * constant the backend activation funnel uses for its `kb_filled` milestone, so
 * the dashboard checklist and the funnel can never disagree. Re-exported here as
 * a convenience for frontend call sites.
 */
export { KB_FILLED_MIN_CHARS };

/**
 * True once a page carries real, merchant-provided business info: enough text
 * (>= KB_FILLED_MIN_CHARS, trimmed) AND content that differs from the Facebook
 * auto-sync snapshot. Delegates to the shared `isBusinessInfoProvided` so the
 * checklist, the dashboard KB nudge, the /pages "Add info" chip, and the backend
 * `kb_filled` activation milestone can never disagree on what "filled" means.
 */
export function isKbFilled(page: Pick<Page, 'knowledgeBase' | 'suggestedKnowledgeBase'>): boolean {
  return isBusinessInfoProvided(page.knowledgeBase, page.suggestedKnowledgeBase);
}

/**
 * A connected, non-ecommerce page with no answer source should be nudged to add
 * business info. An answer source is EITHER a filled free-text KB OR at least one
 * native catalog item — a merchant who structured their products in the catalog
 * has given the AI what it needs, so don't nag them to also fill the KB text.
 * Ecommerce pages are excluded (their products come from the store integration).
 */
export function needsBusinessInfo(page: Page): boolean {
  return page.isConnected !== false
    && !page.ecommerceStoreId
    && !isKbFilled(page)
    && (page.catalogItemsCount ?? 0) === 0;
}
