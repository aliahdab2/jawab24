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

/** The attribute pairs a row displays inside its section: the key attribute
 *  and every hoisted pair dropped, the rest ordered by the section's
 *  labelOrder (labels the section has never seen are appended, stable). */
export function rowDisplayAttributes(
  section: FactListSection,
  row: FactRowDto,
): { label: string; value: string }[] {
  const { collection, labelOrder, shared } = section;
  const kept = (row.attributes ?? []).filter(
    (a) =>
      !(collection.keyAttr && a.label === collection.keyAttr) &&
      !shared.some((s) => s.label === a.label && s.value === a.value.trim()),
  );
  return kept
    .slice()
    .sort((a, b) => {
      const ia = labelOrder.indexOf(a.label);
      const ib = labelOrder.indexOf(b.label);
      return (ia === -1 ? labelOrder.length : ia) - (ib === -1 ? labelOrder.length : ib);
    });
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
