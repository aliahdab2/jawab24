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
 * Deep-links that open the Business Info editor on /pages (handled there via
 * useOpenOnQueryParam). Single constants so the consumers can't drift if the
 * route/param ever changes. (`openKb` is the legacy-internal name — the
 * user-facing feature is "Business Info".)
 *
 * Two intents, two params:
 * - KB_DEEP_LINK ("add your missing info" — dashboard nudge, setup checklist):
 *   opens the first page that NEEDS info (`needsBusinessInfo`).
 * - KB_DEEP_LINK_ACTIVE ("show me the info my replies use" — the Settings
 *   board's «من معلومات نشاطك التجاري» links): opens the MOST-ACTIVE page, so a
 *   merchant with a filled active page never lands on a dormant page's empty
 *   editor (which reads as their info having vanished).
 */
export const KB_DEEP_LINK = '/pages?openKb=true';
export const KB_DEEP_LINK_ACTIVE = '/pages?openKbActive=true';

/**
 * True once a page carries real, merchant-provided business info: enough text
 * (>= KB_FILLED_MIN_CHARS, trimmed) AND content that differs from the Facebook
 * auto-sync snapshot. Delegates to the shared `isBusinessInfoProvided` so the
 * checklist, the dashboard KB nudge, the /pages "Add info" chip, and the backend
 * `kb_filled` activation milestone can never disagree on what "filled" means.
 */
export function isKbFilled(page: Pick<Page, 'knowledgeBase' | 'suggestedKnowledgeBase' | 'kbFilled'>): boolean {
  // LIST pages (`GET /pages`) carry the server-computed boolean and NOT the text
  // — the text was 48% of that response's bytes and every list-side caller of
  // this helper only wanted the boolean. Single-page reads carry the text, so
  // fall back to computing it locally with the same shared predicate. Both paths
  // therefore agree by construction, and this helper works on either shape.
  if (typeof page.kbFilled === 'boolean') return page.kbFilled;
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
