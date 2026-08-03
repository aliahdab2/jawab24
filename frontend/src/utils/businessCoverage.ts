import { unwrapBusinessProfile, whatsappNumbers } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';

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
export type BusinessFactKey = 'hours' | 'address' | 'phone' | 'delivery' | 'payment' | 'website';

/**
 * The areas the readiness score is computed over.
 *
 * Deliberately NOT the same set as the fact rows:
 *  - `products` has a chip but no row — a store-linked page cannot type items
 *    (the catalog API rejects manual writes with 409 PAGE_HAS_STORE).
 *  - `phone` and `website` have a row but are not scored — nobody messages a
 *    shop to ask whether it has a website, so a missing one is not a gap that
 *    makes Jawab fail a customer.
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
  /** Non-blank contact numbers, in the merchant's order. */
  phones: string[];
  /** The numbers that are also on WhatsApp — any subset of `phones` (legacy
   *  single-string values are normalized to a one-entry list). */
  whatsapp: string[];
  delivery: string | null;
  payment: string | null;
  website: string | null;
}

export interface ReadinessScore {
  /** How many of `READINESS_AREAS` Jawab can answer about. */
  covered: number;
  total: number;
  /** Floored, so it only reads 100% when nothing is missing. */
  percent: number;
  missing: ReadinessAreaKey[];
}

export interface BusinessFactCoverage {
  values: BusinessFactValues;
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
  const { merchant = {} } = unwrapBusinessProfile(page.businessProfile);

  const hasHours = !!merchant.hours
    && Object.values(merchant.hours).some((v) => Array.isArray(v) && v.length > 0);

  const values: BusinessFactValues = {
    hours: hasHours ? merchant.hours! : null,
    // City counts. `formatBusinessInfoPrompt` joins address/city/country into
    // one "Address" line, so a merchant who gave only «دمشق» HAS given Jawab an
    // answer to «وين محلكم؟» — and the row displays it. Calling that ناقص would
    // contradict the value printed right next to the badge.
    // (Deliberately looser than shared `presentFieldsFromProfile`, which gates
    // KB-line REMOVAL and is strict on purpose: a false positive there deletes a
    // fact. Do not "unify" the two — they answer different questions.)
    address: text([merchant.address, merchant.city].filter((v) => v?.trim()).join('، ')),
    phones: (merchant.phones ?? []).filter((p): p is string => !!p?.trim()).map((p) => p.trim()),
    whatsapp: whatsappNumbers(merchant),
    delivery: text(merchant.policies?.shipping),
    payment: text(merchant.policies?.payment),
    website: text(merchant.website),
  };

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
  };

  return { values, covered, storeAnswered };
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
export function computeReadiness(page: Page, productsCount: number | undefined): BusinessReadiness {
  const { values, covered: factCovered, storeAnswered } = computeFactCoverage(page);

  const covered: Record<CoverageKey, boolean> = {
    ...factCovered,
    // A store's product summary reaches every reply via getStoreContextForAI, and
    // the merchant cannot add catalog items to a store-linked page (the catalog
    // API rejects manual writes with 409 PAGE_HAS_STORE) — so the link itself is
    // what covers products here. Unlike policies there is no server-side proof
    // flag for the product summary; if one is ever added, key this on it too.
    products: !!page.ecommerceStoreId || (productsCount ?? 0) > 0,
  };

  const score = productsCount === undefined ? null : (() => {
    const missing = READINESS_AREAS.filter((area) => !covered[area]);
    const coveredCount = READINESS_AREAS.length - missing.length;
    return {
      covered: coveredCount,
      total: READINESS_AREAS.length,
      percent: Math.floor((coveredCount / READINESS_AREAS.length) * 100),
      missing,
    };
  })();

  return { values, covered, storeAnswered, score };
}
