import { unwrapBusinessProfile, whatsappNumbers, businessPhoneEntries, isFieldAuthoritative } from '@jawab24/shared';
import type { BusinessPhoneEntry } from '@jawab24/shared';
import type { Page, BusinessProfile } from '@jawab24/shared';

/**
 * «نشاطك التجاري» coverage — THE single answer to "can Jawab answer about X?".
 *
 * `/business` reports coverage twice on one screen: the readiness ring (a
 * percentage over the scored areas) and a مكتمل/ناقص badge on every fact row.
 * Both read this module, because two independent computations on one screen is a
 * trust bug: a merchant who fills a field and watches one surface ignore it
 * stops believing either. The mock that started this work showed a 60% ring
 * above a list where 4 of 6 rows read "complete" — two scoreboards disagreeing.
 *
 * It returns the extracted VALUES alongside the coverage booleans on purpose:
 * `covered.hours` is *defined* as `values.hours !== null` and the row renders
 * from that same `values.hours`, so display and badge cannot drift apart. A
 * predicate that re-derives "is this set?" from the profile a second time is
 * exactly how the two surfaces disagreed in the first place.
 *
 * Reads only the CONFIRMED `merchant` half of the business profile — the same
 * authority rule as the reply pipeline (suggestions never count as covered).
 */

/** Facts with a row in `BusinessFactRows`. */
export type BusinessFactKey = 'hours' | 'address' | 'phone' | 'delivery' | 'payment' | 'website' | 'email';

/**
 * The areas the readiness score is computed over.
 *
 * Deliberately NOT the same set as the fact rows:
 *  - `products` has a chip but no row — a store-linked page cannot type items
 *    (the catalog API rejects manual writes with 409 PAGE_HAS_STORE).
 *  - `phone`, `website` and `email` have a row but are not scored — nobody
 *    messages a shop to ask whether it has a website, so a missing one is not a
 *    gap that makes Jawab fail a customer.
 * The card names its own denominator («{covered} من {total}» plus a sentence
 * listing exactly which areas are missing), so the ring is reconcilable without
 * the reader having to count rows.
 */
export type ReadinessAreaKey = 'products' | 'hours' | 'address' | 'delivery' | 'payment';

/** Score order = chip render order. One array so the two cannot diverge. */
export const READINESS_AREAS: readonly ReadinessAreaKey[] = [
  'products', 'hours', 'address', 'delivery', 'payment',
];

export type CoverageKey = BusinessFactKey | ReadinessAreaKey;

/** Policy facts a connected store can answer on the merchant's behalf. */
export type StorePolicyKey = 'delivery' | 'payment';

/** One list, so "which facts can a store answer?" is asked in one place — the
 *  fact rows, the readiness areas and the fact sheet's hint all read it. */
export const STORE_POLICY_KEYS: readonly StorePolicyKey[] = ['delivery', 'payment'];

export function isStorePolicyKey(key: string): key is StorePolicyKey {
  return (STORE_POLICY_KEYS as readonly string[]).includes(key);
}

/**
 * Is this fact part of the readiness score? Unscored facts (`phone`,
 * `website`) must not badge themselves «ناقص» — the counter says they don't
 * gate readiness, so an amber "missing" on the row would contradict it. The
 * rows render unscored gaps as a neutral «اختياري» instead. Derived from
 * `READINESS_AREAS` so adding an area to the score automatically upgrades its
 * row badge — never a second hand-kept list.
 */
export function isScoredFactKey(key: BusinessFactKey): boolean {
  return (READINESS_AREAS as readonly string[]).includes(key);
}

export interface BusinessFactValues {
  /** The stored week, unformatted — the row summarizes it with its own locale
   *  day labels. null when the merchant confirmed no working day. */
  hours: Record<string, string[]> | null;
  /** Address and city joined for display; null when neither is set. */
  address: string | null;
  /** Non-blank contact lines, in the merchant's order, each with the purpose
   *  they gave it (if any). */
  phones: BusinessPhoneEntry[];
  /** The NUMBERS that are also on WhatsApp — any subset of `phones` numbers
   *  (legacy single-string values are normalized to a one-entry list). Compare
   *  against `entry.number`, never the entry itself. */
  whatsapp: string[];
  delivery: string | null;
  payment: string | null;
  website: string | null;
  email: string | null;
}

export interface ReadinessScore {
  /** How many of `READINESS_AREAS` Jawab can answer about. */
  covered: number;
  total: number;
  /** Floored, so it only reads 100% when nothing is missing. */
  percent: number;
  missing: ReadinessAreaKey[];
}

/** Unconfirmed values present in the profile — same shapes as
 *  `BusinessFactValues`, but these are Facebook-synced (or legacy-unreviewed)
 *  values the reply pipeline refuses to use. They exist so the rows can SHOW
 *  the merchant what is waiting for review instead of hiding it: the hidden
 *  «+971556087128» UAE phone (MES, 2026-08-08) sat invisible in the profile
 *  until an unrelated save laundered it into replies. */
export type SuggestedFactValues = Partial<
  Pick<BusinessFactValues, 'hours' | 'address' | 'phones' | 'delivery' | 'payment' | 'website' | 'email'>
>;

export interface BusinessFactCoverage {
  values: BusinessFactValues;
  /** Facebook-synced / unreviewed values for rows to surface as «راجعه» —
   *  never counted as covered (the reply pipeline won't answer from them). */
  suggested: SuggestedFactValues;
  /** Can Jawab answer about this today — from the merchant's own value or a
   *  connected store? */
  covered: Record<BusinessFactKey, boolean>;
  /** The store is what answers this, and the merchant wrote nothing. Drives the
   *  row's «يجيب عنها متجرك المتصل» note; such a fact still counts as covered. */
  storeAnswered: Record<StorePolicyKey, boolean>;
}

export interface BusinessReadiness extends Omit<BusinessFactCoverage, 'covered'> {
  /** Widened with `products`, which is scored but has no row. */
  covered: Record<CoverageKey, boolean>;
  /** null until `productsCount` lands — see `computeReadiness`. */
  score: ReadinessScore | null;
}

/** Trimmed value, or null when there is nothing there. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Coverage of the facts that have a ROW — everything `BusinessFactRows` needs and
 * nothing it doesn't. Kept separate from `computeReadiness` so the rows never
 * have to invent a `productsCount` to ask a question that has no products in it.
 */
export function computeFactCoverage(page: Page): BusinessFactCoverage {
  const { merchant = {}, merchantProvenance } = unwrapBusinessProfile(page.businessProfile);

  // The docstring's contract, now actually enforced: values/covered read the
  // AUTHORITATIVE merchant half only — the exact predicate the reply pipeline's
  // BUSINESS_INFO gate uses (imported, never re-derived). An unconfirmed
  // fb_sync value is NOT covered (the pipeline won't answer from it); it goes
  // into `suggested` so the row shows it as needing review instead of either
  // hiding it or dressing it up as a settled fact.
  const authoritative = (field: keyof BusinessProfile) => isFieldAuthoritative(merchantProvenance, field);

  const week = (h: BusinessProfile['hours']) =>
    h && Object.values(h).some((v) => Array.isArray(v) && v.length > 0) ? h : null;
  // Entries, not bare numbers: the row prints each number WITH the purpose the
  // merchant gave it. Read through the shared reader — a local re-derivation
  // here used to silently ignore the legacy singular `phone` that the prompt
  // publishes, and would now also have to re-learn the entry shape.
  const phoneEntries = (p: BusinessProfile) =>
    authoritative('phones') ? businessPhoneEntries(p) : [];
  // City counts. `formatBusinessInfoPrompt` joins address/city/country into
  // one "Address" line, so a merchant who gave only «دمشق» HAS given Jawab an
  // answer to «وين محلكم؟» — and the row displays it. Calling that ناقص would
  // contradict the value printed right next to the badge.
  // (Deliberately looser than shared `presentFieldsFromProfile`, which gates
  // KB-line REMOVAL and is strict on purpose: a false positive there deletes a
  // fact. Do not "unify" the two — they answer different questions.)
  // Address components gate independently, mirroring joinAddress in the prompt.
  const joinedAddress = (fields: Array<string | null | undefined>) =>
    text(fields.filter((v) => v?.trim()).join('، '));

  const values: BusinessFactValues = {
    hours: authoritative('hours') ? week(merchant.hours) : null,
    address: joinedAddress([
      authoritative('address') ? merchant.address : null,
      authoritative('city') ? merchant.city : null,
    ]),
    phones: phoneEntries(merchant),
    whatsapp: authoritative('channels') ? whatsappNumbers(merchant) : [],
    email: authoritative('email') ? text(merchant.email) : null,
    delivery: authoritative('policies') ? text(merchant.policies?.shipping) : null,
    payment: authoritative('policies') ? text(merchant.policies?.payment) : null,
    website: authoritative('website') ? text(merchant.website) : null,
  };

  // What remains once the authoritative half is taken: values that exist in the
  // profile but failed the authority gate. Only populated where the row would
  // otherwise show nothing — a confirmed value beats a lingering suggestion.
  const suggested: SuggestedFactValues = {};
  if (!values.hours && !authoritative('hours')) {
    const w = week(merchant.hours);
    if (w) suggested.hours = w;
  }
  if (!values.address) {
    const addr = joinedAddress([merchant.address, merchant.city]);
    if (addr) suggested.address = addr;
  }
  if (values.phones.length === 0) {
    const p = businessPhoneEntries(merchant);
    if (p.length && !authoritative('phones')) suggested.phones = p;
  }
  if (!values.delivery && !authoritative('policies')) {
    const d = text(merchant.policies?.shipping);
    if (d) suggested.delivery = d;
  }
  if (!values.payment && !authoritative('policies')) {
    const p = text(merchant.policies?.payment);
    if (p) suggested.payment = p;
  }
  if (!values.website && !authoritative('website')) {
    const w = text(merchant.website);
    if (w) suggested.website = w;
  }
  if (!values.email && !authoritative('email')) {
    const e = text(merchant.email);
    if (e) suggested.email = e;
  }

  // `storeAnswersPolicies` is server-derived (store is active AND synced policy
  // text) and is the ONLY sanctioned proof — see `storeAnswersPolicies` in
  // backend/src/services/ecommerce.ts. `ecommerceStoreId` alone is NOT proof: it
  // survives a platform-side uninstall and is set on a live store that synced no
  // policy text, and in both cases the model receives nothing. The readiness
  // chips used to key on the id, so a store page with no policy text scored the
  // delivery area green while the row beneath it said «أضف معلومات التوصيل».
  const storeAnswered: Record<StorePolicyKey, boolean> = {
    delivery: !values.delivery && !!page.storeAnswersPolicies,
    payment: !values.payment && !!page.storeAnswersPolicies,
  };

  // Every entry is defined AS "the value is there", never re-derived from the
  // profile — that is what makes a badge unable to contradict the value printed
  // beside it.
  const covered: Record<BusinessFactKey, boolean> = {
    hours: values.hours !== null,
    address: values.address !== null,
    phone: values.phones.length > 0,
    delivery: values.delivery !== null || storeAnswered.delivery,
    payment: values.payment !== null || storeAnswered.payment,
    website: values.website !== null,
    email: values.email !== null,
  };

  return { values, suggested, covered, storeAnswered };
}

/**
 * Fact coverage plus the scored `products` area and the readiness percentage —
 * what `BusinessReadinessCard` renders.
 *
 * @param productsCount catalog item count. `undefined` = still loading, which
 *   suppresses `score` entirely: `productsCount ?? 0` would publish a confident
 *   "40% ready" and jump to 60% a tick later, and a NUMBER that corrects itself
 *   reads as a wrong number (a chip flipping is merely noise).
 */
export function computeReadiness(
  page: Page,
  productsCount: number | undefined,
  /** LIVE fact-collection rows (G1b lists). undefined = still loading. */
  factRowsCount: number | undefined,
): BusinessReadiness {
  const { values, suggested, covered: factCovered, storeAnswered } = computeFactCoverage(page);

  const covered: Record<CoverageKey, boolean> = {
    ...factCovered,
    // A store's product summary reaches every reply via getStoreContextForAI, and
    // the merchant cannot add catalog items to a store-linked page (the catalog
    // API rejects manual writes with 409 PAGE_HAS_STORE) — so the link itself is
    // what covers products here. Unlike policies there is no server-side proof
    // flag for the product summary; if one is ever added, key this on it too.
    //
    // Fact-collection rows count too: a page whose products live in the G1b
    // lists (BAMBO: 245 rows) was greeted with «جاهز بنسبة 0٪ — لا منتجات بعد»
    // right above them — the readiness card contradicting the page it sits on
    // (owner catch, 2026-08-04). The card asks what Jawab CAN ANSWER, and it
    // answers from the lists (renderer D-050) exactly as it does from the catalog.
    products: !!page.ecommerceStoreId || (productsCount ?? 0) > 0 || (factRowsCount ?? 0) > 0,
  };

  // No score until BOTH product sources have landed — scoring from the catalog
  // count alone briefly branded a lists-only page «0%» on every load.
  const score = productsCount === undefined || factRowsCount === undefined ? null : (() => {
    const missing = READINESS_AREAS.filter((area) => !covered[area]);
    const coveredCount = READINESS_AREAS.length - missing.length;
    return {
      covered: coveredCount,
      total: READINESS_AREAS.length,
      percent: Math.floor((coveredCount / READINESS_AREAS.length) * 100),
      missing,
    };
  })();

  return { values, suggested, covered, storeAnswered, score };
}

/**
 * Should `/business` render the «المنتجات والخدمات» (catalog) section at all?
 *
 * When the page's products live in the fact lists (BAMBO: 245 rows across three
 * lists; الدمشقي: the whole surface), the catalog is empty BY DESIGN — and its
 * «أضف ما تبيعه» pitch rendered directly under a readiness card saying
 * «منتجاتك — في قوائم النشاط ✓». Same data, opposite messages (owner ruling
 * 2026-08-05: one home for products). Carve-outs, in order:
 *  - a store-linked page always shows the section (the store box IS its content);
 *  - a failed catalog fetch must surface CatalogManager's retry state — hiding
 *    it would disguise an outage as "this page has no products section";
 *  - the ?import=1 deep link (the Business Info price-list CTA) must still land
 *    on the import sheet, lists or not;
 *  - both counts hold the section back until they resolve: appearing and then
 *    vanishing (or the reverse) reads as a glitch, the same rule `score` follows.
 */
export function shouldShowProductsSection(input: {
  hasStore: boolean;
  catalogError: boolean;
  importRequested: boolean;
  /** Catalog item count; undefined = still loading. */
  productsCount: number | undefined;
  /** Live fact-collection rows (G1b lists); undefined = still loading. */
  factRowsCount: number | undefined;
}): boolean {
  if (input.hasStore || input.catalogError || input.importRequested) return true;
  if (input.productsCount === undefined || input.factRowsCount === undefined) return false;
  return input.productsCount > 0 || input.factRowsCount === 0;
}
