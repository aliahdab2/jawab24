import { normalizeArabic } from '@jawab24/shared';
import type { FactCollectionWithRows, FactRowDto } from '@/lib/api';
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
  opts?: { keepKey?: boolean },
): { label: string; value: string }[] {
  const { collection, labelOrder, shared } = section;
  const kept = (row.attributes ?? []).filter(
    (a) =>
      !(collection.keyAttr && a.label === collection.keyAttr) &&
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

/** A collection is "dated" when any of its rows carries a start date — that is
 *  what makes it a schedule-like list whose rows self-expire. Derived from the
 *  merchant's own data, never from vocabulary. */
export function isDatedCollection(collection: FactCollectionWithRows): boolean {
  return collection.rows.some((r) => r.startsAt !== null);
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
