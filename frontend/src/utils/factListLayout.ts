import { normalizeArabic, isRowLive } from '@jawab24/shared';
import type { FactCollectionWithRows, FactRowDto } from '@/lib/api';
import { SUPPORTED_LOCALES } from './locale';
import type { FactListGroup, GroupedRow } from './factListGrouping';

/**
 * Presentation layout for one entity card: the group's rows bucketed by the
 * collection they belong to, with the display metadata the card needs.
 * Pure functions only — the data model (two separate collections, measured
 * gating/expiry semantics) is untouched; this is how the editor SHOWS it.
 */
export interface FactListSection {
  collection: FactCollectionWithRows;
  rows: GroupedRow[];
  /** Attribute labels in first-seen order across the section's rows, with the
   *  collection's key attribute excluded (the card title already names the
   *  entity). Rows are RAGGED — label order varies row to row on real data —
   *  so display must sort by this list, never by a row's array order. */
  labelOrder: string[];
  /** Pairs carried identically by EVERY row of the section (and the section
   *  has ≥ 2 rows) — hoisted into the section header so «المستوى: مبتدئ» is
   *  said once, not once per row. An exact-equality fold: a hoisted pair can
   *  never be false, only redundant. */
  shared: { label: string; value: string }[];
}

/** Bucket a card's rows by collection, in the page's collection order (stable
 *  across cards). Collections with no rows in this group yield no section. */
export function sectionizeGroup(
  group: FactListGroup,
  collections: FactCollectionWithRows[],
): FactListSection[] {
  const sections: FactListSection[] = [];
  for (const collection of collections) {
    const rows = group.rows.filter((r) => r.collection.id === collection.id);
    if (rows.length === 0) continue;

    const labelOrder: string[] = [];
    for (const { row } of rows) {
      for (const a of row.attributes ?? []) {
        if (collection.keyAttr && a.label === collection.keyAttr) continue;
        if (!labelOrder.includes(a.label)) labelOrder.push(a.label);
      }
    }

    const shared: { label: string; value: string }[] = [];
    if (rows.length >= 2) {
      for (const label of labelOrder) {
        const values = rows.map(({ row }) =>
          row.attributes?.find((a) => a.label === label)?.value.trim() ?? null,
        );
        const first = values[0];
        if (first === null || values.some((v) => v !== first)) continue;
        // Guard: hoisting must not leave any row with nothing to show —
        // a row whose ONLY content is this pair keeps it inline.
        const wouldBlank = rows.some(({ row }) => {
          const rest = (row.attributes ?? []).filter(
            (a) =>
              a.label !== label &&
              !(collection.keyAttr && a.label === collection.keyAttr) &&
              !shared.some((s) => s.label === a.label),
          );
          return rest.length === 0 && !row.price && !row.startsAt;
        });
        if (wouldBlank) continue;
        shared.push({ label, value: first });
      }
    }

    sections.push({ collection, rows, labelOrder, shared });
  }
  return sections;
}

/** The attribute pairs a row displays inside its section: hoisted pairs
 *  dropped, the rest ordered by the section's labelOrder (labels the section
 *  has never seen are appended, stable). The collection's KEY attribute is
 *  dropped by default — an entity card's title already names the entity — but
 *  KEPT (first) in directory mode, where the card titles the LIST and the key
 *  value (the pharmacy's area) is the row's most useful fact. */
export function rowDisplayAttributes(
  section: FactListSection,
  row: FactRowDto,
  opts?: { keepKey?: boolean; dropLabels?: string[] },
): { label: string; value: string }[] {
  const { collection, labelOrder, shared } = section;
  const kept = (row.attributes ?? []).filter(
    (a) =>
      !(collection.keyAttr && a.label === collection.keyAttr) &&
      !opts?.dropLabels?.includes(a.label) &&
      !shared.some((s) => s.label === a.label && s.value === a.value.trim()),
  );
  const sorted = kept
    .slice()
    .sort((a, b) => {
      const ia = labelOrder.indexOf(a.label);
      const ib = labelOrder.indexOf(b.label);
      return (ia === -1 ? labelOrder.length : ia) - (ib === -1 ? labelOrder.length : ib);
    });
  if (opts?.keepKey && collection.keyAttr) {
    const key = (row.attributes ?? []).find((a) => a.label === collection.keyAttr);
    if (key) return [key, ...sorted];
  }
  return sorted;
}

/** One key-value bucket of a directory section: the bucket's display spelling
 *  (first raw occurrence) and its rows. `value === null` is the missing-key
 *  bucket, always rendered LAST. */
export interface SectionKeyGroup {
  value: string | null;
  display: string | null;
  rows: GroupedRow[];
}

/**
 * Group a directory section's rows by the collection's KEY attribute value —
 * the axis the merchant thinks in («which pharmacies are in area X»), and the
 * SAME axis reply-time row gating matches the customer's message against, so
 * the editor shows the data the way the engine reads it. Purely data-driven,
 * no vocabulary: the headers are the merchant's own key values.
 *
 * Returns null (render flat, unchanged) unless the collection HAS a key AND at
 * least one key value is shared by two rows — when every value is unique a
 * header per row is noise, not structure. Key values match through the shared
 * normalizer (spacing/hamza variants are one area), display keeps the first
 * raw spelling. Rows missing the key value land in a trailing null bucket so
 * the gap is VISIBLE — the same rows silently suppress reply-time gating
 * (factCollections.ts rowsMissingKey guard), so surfacing them is the nudge
 * that gets the data fixed.
 */
/**
 * The label a directory section partitions by: the collection's key attribute
 * when it has one, otherwise DISCOVERED from the data — the attribute carried
 * with a value by EVERY row (a partition must cover the list), with ≥2
 * distinct values, at least one of them shared (otherwise nothing
 * compresses), picking the fewest-distinct-values candidate (max
 * compression), ties first-seen. Purely data-driven, no vocabulary: on the
 * pilot's size list this elects «السلسلة» (عادي/جامبو) with nothing naming it
 * anywhere in code.
 */
/**
 * Group a list's rows by the row NAME, for lists that repeat one.
 *
 * A price list carries a course once per tier — «دورة الحلاقة النسائية»
 * three times, at 35/50/75 — and read as a flat list that is the same name
 * three times over, which is the redundancy the entity cards were built to
 * remove (owner, 2026-08-11: «المهم ما نكرر اسم الدورة»).
 *
 * Deliberately NOT the same mechanism as `sectionPartitionLabel`: that one
 * elects an ATTRIBUTE and needs it present on every row, so a level that only
 * multi-tier courses carry disqualifies itself and the list stays flat. Every
 * row has a name, so this always applies — and it returns null when no name
 * repeats, because grouping singletons adds chrome and compresses nothing.
 *
 * Name equality uses the SAME folding as the entity join, so a list and a
 * card can never disagree about which rows are the same thing.
 */
export function sectionNameGroups(rows: GroupedRow[]): SectionKeyGroup[] | null {
  const buckets = new Map<string, SectionKeyGroup>();
  const order: SectionKeyGroup[] = [];
  for (const entry of rows) {
    const id = norm(entry.row.name);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { value: id, display: entry.row.name, rows: [] };
      buckets.set(id, bucket);
      order.push(bucket);
    }
    bucket.rows.push(entry);
  }
  return order.some((g) => g.rows.length > 1) ? order : null;
}

export function sectionPartitionLabel(section: FactListSection): string | null {
  const { collection } = section;
  if (collection.keyAttr) return collection.keyAttr;
  const rows = section.rows;
  if (rows.length < 3) return null;
  let best: { label: string; distinct: number } | null = null;
  for (const label of section.labelOrder) {
    const values = rows.map(
      ({ row }) => row.attributes?.find((a) => norm(a.label) === norm(label))?.value.trim() || null,
    );
    if (values.some((v) => v === null)) continue;
    const counts = new Map<string, number>();
    for (const v of values as string[]) counts.set(norm(v), (counts.get(norm(v)) ?? 0) + 1);
    if (counts.size < 2) continue;
    if (![...counts.values()].some((n) => n >= 2)) continue;
    if (!best || counts.size < best.distinct) best = { label, distinct: counts.size };
  }
  return best?.label ?? null;
}

export function sectionKeyGroups(
  section: FactListSection,
  rows: GroupedRow[],
  partitionLabel?: string | null,
): SectionKeyGroup[] | null {
  const keyAttr = partitionLabel !== undefined ? partitionLabel : section.collection.keyAttr;
  if (!keyAttr) return null;
  const keyLabel = norm(keyAttr);
  const buckets = new Map<string, SectionKeyGroup>();
  const order: SectionKeyGroup[] = [];
  const missing: SectionKeyGroup = { value: null, display: null, rows: [] };
  for (const entry of rows) {
    const raw = entry.row.attributes
      ?.find((a) => norm(a.label) === keyLabel)
      ?.value.trim();
    if (!raw) {
      missing.rows.push(entry);
      continue;
    }
    const id = norm(raw);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { value: id, display: raw, rows: [] };
      buckets.set(id, bucket);
      order.push(bucket);
    }
    bucket.rows.push(entry);
  }
  if (!order.some((b) => b.rows.length >= 2)) return null;
  if (missing.rows.length > 0) order.push(missing);
  return order;
}

/** UNION of attribute labels across ALL of a collection's rows, first-seen
 *  order. The row sheet previously sampled rows[0], and 22 of the pilot's 46
 *  price rows carry attributes = null — a merchant adding a row would get a
 *  form with no attribute fields at all. */
export function collectionAttributeLabels(collection: FactCollectionWithRows): string[] {
  const labels: string[] = [];
  for (const row of collection.rows) {
    for (const a of row.attributes ?? []) {
      if (!labels.includes(a.label)) labels.push(a.label);
    }
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Entity form unit (G1b slice 3b) — the merchant edits ONE item on ONE screen
// ---------------------------------------------------------------------------

const norm = (text: string): string =>
  normalizeArabic(text, { normalizeTaaMarbuta: true }).toLowerCase().trim();

/** The day a row retires on: `startsAt` when it has one, `endsAt` otherwise.
 *  The SAME anchor `isRowLive` keys off, so nothing derived from it can call a
 *  row live that the renderer and the prompt builder have already dropped. */
const retiringAnchor = (row: FactRowDto): string | null => row.startsAt ?? row.endsAt;

/** A collection is "dated" when its rows are PREDOMINANTLY dated — that is
 *  what makes it a schedule-like list whose rows self-expire. Derived from the
 *  merchant's own data, never from vocabulary.
 *
 *  Majority, not `some`: under the old any-row rule, ONE dated promo tier in a
 *  50-row price list reclassified the whole list as a schedule — every price
 *  row became a "session", no card rendered a tier row, and the tier row is
 *  the entity sheet's only door. One row silently removed the edit surface
 *  from an entire page (الدمشقي, 2026-08-06). A real schedule keeps counting
 *  as one even while a few of its rows are still undated drafts — a TIE leans
 *  schedule (a two-row list with one date is a schedule mid-authoring, not a
 *  price list with a promo), and the base-less fallback door in the card
 *  layout guarantees an edit entry either way.
 *
 *  Keyed on `startsAt` ALONE, deliberately — this is the LAYOUT predicate, and
 *  a session slot is a thing that STARTS. An offer row carrying only an end
 *  date («ساري حتى…») self-expires, but it is not a slot, and `ListRowSheet`
 *  writes exactly that shape with no guard requiring a start date. Widening
 *  this to `retiringAnchor` to match `datedListFreshness` was tried and
 *  reverted in review: one end-dated promo row in a four-row price list is
 *  enough to reach the tie, and reclassifying a price list as a schedule
 *  empties `bases`, so no card renders a tier row — the entity sheet's only
 *  door. That is the 2026-08-06 «cannot edit» regression, re-armed. The two
 *  predicates answer DIFFERENT questions and are allowed to differ; see
 *  `isScheduleShaped`. */
export function isDatedCollection(collection: FactCollectionWithRows): boolean {
  const dated = datedShare(collection, (r) => r.startsAt);
  return dated > 0 && dated * 2 >= collection.rows.length;
}

/** How many of a collection's rows carry a date under `anchorOf`. One counter
 *  for both predicates so they can differ in their ANCHOR and their THRESHOLD
 *  without differing in how they count. */
function datedShare(
  collection: FactCollectionWithRows,
  anchorOf: (row: FactRowDto) => string | null,
): number {
  let dated = 0;
  for (const r of collection.rows) if (anchorOf(r) !== null) dated++;
  return dated;
}

/** Whether a list is enough of a SCHEDULE for a sentence to be made about the
 *  list as a whole — the question `datedListFreshness` asks, which is not the
 *  question `isDatedCollection` asks.
 *
 *  Two deliberate differences from the layout predicate:
 *  - the anchor is `retiringAnchor`, because a row that retires by `endsAt`
 *    takes its content with it exactly as a session does, so a list of them
 *    genuinely does run out;
 *  - the majority is STRICT. Layout needs `>=` so a two-row list mid-authoring
 *    still edits as a schedule; a SENTENCE has no such need, and at the tie the
 *    old false wording is still reachable — two promo dates typed onto a
 *    four-row price list would print «انتهت التواريخ المعلنة في «الأسعار»»
 *    once they passed, which is the very claim this rule exists to prevent. */
function isScheduleShaped(collection: FactCollectionWithRows): boolean {
  const dated = datedShare(collection, retiringAnchor);
  return dated > 0 && dated * 2 > collection.rows.length;
}

/**
 * How close to running out counts as "about to". Owner ruling 2026-08-10 —
 * «مو ٧ أيام كتير… خليه ٣ ايام فقط»: a week's notice is so early it reads as
 * noise, and the merchant ignores the one that matters.
 */
const DATED_LIST_WARNING_DAYS = 3;

/** `ended` = every dated row of a SCHEDULE has retired, so the AI no longer
 *  mentions any of them. `ending` = the last one retires within the window,
 *  and `lastDate` is the day it does. `rowsRetired` = this list is not a
 *  schedule, and the named rows — dates a merchant dropped onto individual
 *  rows — have retired on their own. `null` = nothing dated here, or plenty
 *  of runway. */
export type DatedListFreshness =
  | { state: 'ended' }
  | { state: 'ending'; lastDate: string }
  | { state: 'rowsRetired'; names: string[] }
  | null;

/**
 * Whether a list's announced dates have run out, or are about to.
 *
 * Fact rows retire themselves by date (D-057) — correct, and completely
 * silent: on 2026-08-10 the pilot merchant had 26 of 46 announced slots
 * already invisible and the remaining 20 gone by 08-31, with nothing anywhere
 * telling him. The prompt builder even skips the emptied collection outright,
 * so the customer-facing answer degrades honestly while the merchant hears
 * nothing at all. This is the signal that closes that loop.
 *
 * WHAT THE SENTENCE IS ALLOWED TO BE ABOUT is decided by `isScheduleShaped`,
 * not by `some row has a date` (owner catch, 2026-08-19). On the pilot page
 * «أسعار الدورات» held 50 price rows of which exactly ONE carried a date, a
 * stray the merchant had typed onto a tier; when that one date passed, the
 * any-row rule made «every dated row has retired» true and the page announced
 * that the LIST's announced dates had ended — while seven live dates for those
 * very courses sat in «مواعيد الدورات المعلنة» beside it. A statement about a
 * whole list may only be made about a list that IS a schedule; everywhere
 * else a retired date is a fact about its own row, and is reported as one.
 * This is the same majority rule, and the same 50-rows-one-date shape, that
 * `isDatedCollection` was written for.
 *
 * `ending` is NOT gated this way, and that asymmetry is the point. «آخر تاريخ
 * معلن في «{list}» هو {date}» is TRUE of any list holding dated rows, however
 * few — it reports a date, it does not characterise the list — whereas `ended`
 * asserts the list's dates are done and tells the merchant to add new ones.
 * Gating both was tried and reverted in review: it silently dropped the early
 * warning for a nine-cohort block announced inside a mostly-undated list.
 */
export function datedListFreshness(
  collection: FactCollectionWithRows,
  todayIso: string,
): DatedListFreshness {
  const dated = collection.rows.filter((r) => retiringAnchor(r) !== null);
  // An outlet directory has no dates and must never be nagged about them.
  if (dated.length === 0) return null;

  const live: FactRowDto[] = [];
  const retired: FactRowDto[] = [];
  for (const r of dated) (isRowLive(r, todayIso) ? live : retired).push(r);

  // Not a schedule → the dates are strays on individual rows. Name the rows
  // that went dark; never generalise them into a claim about the list.
  // Already-dark outranks about-to-go-dark: the merchant can still act on
  // both, but only one of them has already cost them answers.
  const schedule = isScheduleShaped(collection);
  if (live.length === 0) {
    return schedule
      ? { state: 'ended' }
      : { state: 'rowsRetired', names: retired.map((r) => r.name) };
  }
  if (!schedule && retired.length > 0) {
    return { state: 'rowsRetired', names: retired.map((r) => r.name) };
  }

  const lastDate = live.reduce((latest, r) => {
    const anchor = retiringAnchor(r) as string;
    return anchor > latest ? anchor : latest;
  }, '');
  return lastDate <= isoPlusDays(todayIso, DATED_LIST_WARNING_DAYS)
    ? { state: 'ending', lastDate }
    : null;
}

/**
 * How long after an item's dates run out the page still says so. Thirty days,
 * and the number is a judgement call worth stating: this signal reports a
 * TRANSITION, so it has to stay visible long enough for the merchant to see it
 * at all. The pilot page's whole schedule was authored in ONE sitting and then
 * retires over about five weeks — a fortnight's window can therefore open and
 * close entirely between two visits, which is precisely the silence this
 * exists to break. The cap on rendered lines keeps density constant whatever
 * the window is, so a longer window costs a number in one overflow sentence,
 * not a longer page.
 */
export const DATED_ENTITY_RECENT_DAYS = 30;

/** What a set of rows says about its own dates.
 *
 *  `noRows` — the scope is empty, so there is nothing here to have dates.
 *  `live` — at least one row is still being quoted to customers. `retired` —
 *  rows carried dates, every one has passed, and `lastDate` is the day the last
 *  of them did.
 *
 *  There is deliberately no fourth "has rows but none dated" case: `isRowLive`
 *  keeps an undated row forever, so any non-empty scope holding one is `live`.
 *  A first draft of this type called the empty case `neverDated` and its own
 *  test disproved it — worth keeping in the name, because the distinction the
 *  callers make is «this block never had a session» vs «its sessions expired»,
 *  and the first of those IS the empty scope.
 *
 *  THE POINT OF THIS TYPE is that `neverDated` and `retired` are different
 *  facts, and the codebase kept losing the difference. Three surfaces on
 *  /business decided an item's status by filtering rows to the live ones and
 *  asking whether the result was empty — the list banner (fixed in D-086), the
 *  entity-card date badge, and the card's gap hint — and an empty result cannot
 *  distinguish "never announced" from "announced and expired". So the badge
 *  rendered nothing for a course whose five cohorts had all passed, and the
 *  gap hint told the merchant «لا شيء مضاف بعد» about a list they had filled
 *  with 46 dated rows. Once the retired rows are dropped at the top of a render
 *  site, writing the wrong sentence there is the natural thing to do — three
 *  separate times, it was. Derive the state ONCE, as a value; let each surface
 *  choose its own words. */
export type DatedRowsState =
  | { state: 'noRows' }
  | { state: 'live' }
  | { state: 'retired'; lastDate: string };

/**
 * The one predicate. `rows` is whatever scope the caller cares about — one
 * block's sessions, one entity's rows inside one collection, a whole list —
 * and the answer means the same thing at every scope.
 *
 * An undated row counts as LIVE, not as "never dated": `isRowLive` keeps it
 * forever, so it is still being quoted, and an item holding «تبدأ عند اكتمال
 * العدد» has not gone dark just because its cohorts have.
 */
export function datedRowsState(rows: FactRowDto[], todayIso: string): DatedRowsState {
  if (rows.some((r) => isRowLive(r, todayIso))) return { state: 'live' };
  let lastDate: string | null = null;
  for (const r of rows) {
    const anchor = retiringAnchor(r);
    if (anchor !== null && (lastDate === null || anchor > lastDate)) lastDate = anchor;
  }
  return lastDate === null ? { state: 'noRows' } : { state: 'retired', lastDate };
}

/** Whether a retired item is recent enough to still be worth a page-level line.
 *  Same window for every caller, so the page and the card cannot disagree about
 *  what "recently" means. */
export function retiredRecently(lastDate: string, todayIso: string): boolean {
  return lastDate >= isoPlusDays(todayIso, -DATED_ENTITY_RECENT_DAYS);
}

/** `YYYY-MM-DD` + n days, in UTC so a DST boundary can never shift the result
 *  by a day. Both columns are plain calendar dates, never instants. */
function isoPlusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The label that splits one entity into tiers ACROSS collections («المستوى»
 * on the pilot): it must appear in at least two different collections with
 * textually intersecting values, never be any collection's key attribute, and
 * have more than one distinct value page-wide (a constant cannot split
 * anything). Free-text labels («ملاحظة») self-exclude — two lists never carry
 * the same sentence. Ties break on total carrying rows, then first-seen.
 */
export function discoverFaceLabel(collections: FactCollectionWithRows[]): string | null {
  const keyAttrs = new Set(
    collections.flatMap((c) => (c.keyAttr ? [norm(c.keyAttr)] : [])),
  );
  /** label → collectionId → set of normalized values */
  const byLabel = new Map<string, Map<string, Set<string>>>();
  const firstSeen: string[] = [];
  const rowCount = new Map<string, number>();

  for (const c of collections) {
    for (const row of c.rows) {
      for (const a of row.attributes ?? []) {
        if (keyAttrs.has(norm(a.label))) continue;
        if (!byLabel.has(a.label)) {
          byLabel.set(a.label, new Map());
          firstSeen.push(a.label);
        }
        const per = byLabel.get(a.label) as Map<string, Set<string>>;
        if (!per.has(c.id)) per.set(c.id, new Set());
        (per.get(c.id) as Set<string>).add(norm(a.value));
        rowCount.set(a.label, (rowCount.get(a.label) ?? 0) + 1);
      }
    }
  }

  let best: { label: string; pairs: number; rows: number } | null = null;
  for (const label of firstSeen) {
    const per = byLabel.get(label) as Map<string, Set<string>>;
    if (per.size < 2) continue;
    const all = new Set([...per.values()].flatMap((s) => [...s]));
    if (all.size < 2) continue;
    const sets = [...per.values()];
    let pairs = 0;
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        if ([...sets[i]].some((v) => sets[j].has(v))) pairs += 1;
      }
    }
    if (pairs === 0) continue;
    const rows = rowCount.get(label) ?? 0;
    if (!best || pairs > best.pairs || (pairs === best.pairs && rows > best.rows)) {
      best = { label, pairs, rows };
    }
  }
  return best?.label ?? null;
}

/** Everything one edit screen holds: the permanent (undated) row carrying
 *  price/description, plus the dated session rows that belong to it. */
export interface FactEntityUnit {
  title: string;
  faceLabel: string | null;
  /** The tier value this unit is scoped to (raw form), when the card has
   *  several permanent rows distinguished by the face label. */
  faceValue: string | null;
  base: GroupedRow | null;
  sessions: GroupedRow[];
  /** Where a NEW session row is created — the first dated collection. */
  sessionCollection: FactCollectionWithRows | null;
}

/**
 * Does this entity ACTUALLY carry schedule rows right now?
 *
 * Distinct from `!!unit.sessionCollection`, which asks whether the entity COULD
 * carry them (the page has a dated list at all). Copy tied to real consequences
 * — «delete this item AND ITS DATES», the date-expiry rule — must key off this
 * one, or it promises mechanics an item doesn't have (owner catch, 2026-08-04:
 * a plain price row offered «حذف هذا العنصر ومواعيده»).
 */
export function unitHasSchedules(unit: FactEntityUnit): boolean {
  return unit.sessions.length > 0;
}

const rowFaceValue = (row: FactRowDto, faceLabel: string | null): string | null => {
  if (!faceLabel) return null;
  return row.attributes?.find((a) => norm(a.label) === norm(faceLabel))?.value ?? null;
};

/**
 * Build the unit for the row the merchant tapped.
 *
 * The face value SPLITS only when it has to: with zero or one permanent row in
 * the card there is no ambiguity and every session belongs to it (the real
 * «دورة الأظافر» case — price row with no attributes, slot carrying a level).
 * With several permanent rows (price tiers), sessions attach by normalized
 * face equality, and a session missing the face value attaches to nothing
 * rather than guessing a tier it never named.
 */
export function buildEntityUnit(
  group: FactListGroup,
  collections: FactCollectionWithRows[],
  faceLabel: string | null,
  opened: GroupedRow,
): FactEntityUnit {
  const datedIds = new Set(collections.filter(isDatedCollection).map((c) => c.id));
  const bases = group.rows.filter((r) => !datedIds.has(r.collection.id));
  const sessions = group.rows.filter((r) => datedIds.has(r.collection.id));
  const sessionCollection = collections.find(isDatedCollection) ?? null;

  if (bases.length <= 1) {
    return {
      title: group.title,
      faceLabel,
      faceValue: rowFaceValue((bases[0] ?? opened).row, faceLabel),
      base: bases[0] ?? null,
      sessions,
      sessionCollection,
    };
  }

  const openedFace = rowFaceValue(opened.row, faceLabel);
  const sameFace = (row: FactRowDto): boolean => {
    const v = rowFaceValue(row, faceLabel);
    if (openedFace === null || v === null) return openedFace === v;
    return norm(v) === norm(openedFace);
  };
  const base = datedIds.has(opened.collection.id)
    ? bases.find((b) => sameFace(b.row)) ?? null
    : opened;
  return {
    title: group.title,
    faceLabel,
    faceValue: openedFace ?? (base ? rowFaceValue(base.row, faceLabel) : null),
    base,
    sessions: sessions.filter((s) => sameFace(s.row)),
    sessionCollection,
  };
}

/** One visual block inside an entity card: a permanent row (the tier line —
 *  its face value and price) with the dated session rows that belong to it
 *  nested directly underneath. The owner's model, applied to the CARD too:
 *  «المواعيد لازم تكون مع الدورة وسعرها، مش منفصلين». */
export interface FactTierBlock {
  base: GroupedRow | null;
  sessions: GroupedRow[];
}

/**
 * Arrange a card's rows as tier blocks using the same matching as the entity
 * form (single source of truth for "which dates belong to which price"):
 * zero/one permanent row owns every session; several split by normalized face
 * equality, and sessions claiming no tier are returned as orphans rather than
 * guessed onto one.
 */
export function buildTierBlocks(
  group: FactListGroup,
  collections: FactCollectionWithRows[],
  faceLabel: string | null,
): { blocks: FactTierBlock[]; orphans: GroupedRow[] } {
  const datedIds = new Set(collections.filter(isDatedCollection).map((c) => c.id));
  const bases = group.rows.filter((r) => !datedIds.has(r.collection.id));
  const sessions = group.rows.filter((r) => datedIds.has(r.collection.id));

  if (bases.length === 0) {
    return { blocks: sessions.length ? [{ base: null, sessions }] : [], orphans: [] };
  }
  if (bases.length === 1) {
    return { blocks: [{ base: bases[0], sessions }], orphans: [] };
  }

  const faceOf = (r: GroupedRow): string | null => {
    const v = rowFaceValue(r.row, faceLabel);
    return v === null ? null : norm(v);
  };
  const blocks = bases.map((base) => ({ base, sessions: [] as GroupedRow[] }));
  const orphans: GroupedRow[] = [];
  for (const s of sessions) {
    const f = faceOf(s);
    const home = f === null ? undefined : blocks.find((b) => faceOf(b.base as GroupedRow) === f);
    if (home) home.sessions.push(s);
    else orphans.push(s);
  }
  return { blocks, orphans };
}

// ---------------------------------------------------------------------------
// Session chip adornment (UX round 5, point 3) — days and times get an icon
// ---------------------------------------------------------------------------

/** Weekday names GENERATED from the platform's own locale data (Intl) for
 *  every supported app locale — never a hand-maintained word list. Folded
 *  through the shared normalizer so merchant spelling variants (الإثنين vs
 *  الاثنين, stray tashkeel) still match. */
const WEEKDAY_NAMES: Set<string> = (() => {
  const names = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of ['long', 'short'] as const) {
      const fmt = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' });
      for (let d = 0; d < 7; d++) {
        // 2024-01-07 was a Sunday; +d walks one full week.
        names.add(norm(fmt.format(new Date(Date.UTC(2024, 0, 7 + d)))));
      }
    }
  }
  return names;
})();

const HAS_ARABIC_RE = /[؀-ۿ]/;
/** Digits (post-normalization) plus bare separators — a value made ONLY of
 *  these is time-shaped («1-3», «10:00», «٤–٦»). Any word drops to 'other'. */
const TIME_SHAPE_RE = /^(?=.*\d)[\d\s:.\-–—~/]+$/;

export type SessionValueKind = 'weekday' | 'time' | 'other';

/**
 * Best-effort adornment classifier for session values: 'weekday' when the
 * value carries a platform-known day name (Arabic tokens also match with a
 * fused prefix — «والثلاثاء»), 'time' when the value is purely digits and
 * separators. Everything uncertain is 'other' and renders unadorned — the
 * classifier only ever ADDS an icon, so a miss is cosmetic, never wrong.
 */
export function sessionValueKind(value: string): SessionValueKind {
  const n = norm(value);
  if (!n) return 'other';
  const tokens = n.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const token of tokens) {
    if (WEEKDAY_NAMES.has(token)) return 'weekday';
    // Arabic proclitics (و، ب، ف، ال…) fuse onto the word — endsWith catches
    // them; restricted to Arabic tokens so English substrings can't false-hit.
    if (HAS_ARABIC_RE.test(token)) {
      for (const name of WEEKDAY_NAMES) {
        if (name.length >= 4 && token.endsWith(name)) return 'weekday';
      }
    }
  }
  return TIME_SHAPE_RE.test(n) ? 'time' : 'other';
}
