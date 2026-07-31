import { normalizeArabic } from '@jawab24/shared';
import type { FactCollectionWithRows, FactRowDto } from '@/lib/api';

/** One row inside a group, still carrying the collection it belongs to —
 *  every edit/add API call needs the collection id. */
export interface GroupedRow {
  collection: FactCollectionWithRows;
  row: FactRowDto;
}

/** One entity card: everything the page's collections say about one thing
 *  (a course's prices AND its cohort dates, an outlet's rows, …). */
export interface FactListGroup {
  /** Stable key for React lists — the normalized form the group was joined on. */
  key: string;
  /** Display title — the first raw name seen for the entity. */
  title: string;
  rows: GroupedRow[];
}

/**
 * Group rows from ALL of a page's collections by the entity they describe, so
 * the editor can show ONE card per course/outlet/item instead of repeating the
 * same name once per list. The lists stay separate in the data — they have
 * opposite gating and expiry semantics — this is a presentation join only.
 *
 * Join rules, in priority order (all comparisons through the SAME normalizer
 * the reply-time matcher uses, so the editor's idea of "same entity" cannot
 * drift from the engine's):
 *
 * 1. Un-keyed collections seed the groups: rows sharing a normalized name are
 *    one entity (that is how price levels already share a name).
 * 2. A keyed row joins the group whose title equals its own name — the
 *    extraction writes full names on both sides, so this catches most rows
 *    and is immune to shared-stem ambiguity («الأمين للمحاسبة» vs «الأمين تصنيع»).
 * 3. Otherwise its KEY VALUE (the word customers find it by) is tried as a
 *    containment needle against group titles — matcher semantics, needle ≥ 2
 *    chars. Only a UNIQUE match joins; an ambiguous needle must not guess.
 * 4. Anything still unmatched becomes its own group (by normalized name), so
 *    a course that has slots but no price row still gets exactly one card.
 */
export function groupFactCollections(collections: FactCollectionWithRows[]): FactListGroup[] {
  const groups: FactListGroup[] = [];
  const byKey = new Map<string, FactListGroup>();

  const add = (key: string, title: string, entry: GroupedRow) => {
    let g = byKey.get(key);
    if (!g) {
      g = { key, title, rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(entry);
  };

  const unkeyed = collections.filter((c) => !c.keyAttr);
  const keyed = collections.filter((c) => c.keyAttr);

  for (const collection of unkeyed) {
    for (const row of collection.rows) {
      const norm = normalizeForGrouping(row.name);
      add(norm || row.id, row.name, { collection, row });
    }
  }

  for (const collection of keyed) {
    for (const row of collection.rows) {
      const nameNorm = normalizeForGrouping(row.name);
      if (byKey.has(nameNorm)) {
        add(nameNorm, row.name, { collection, row });
        continue;
      }
      const needle = normalizeForGrouping(rowKeyValue(collection, row) ?? '');
      const matches = needle.length >= 2 ? groups.filter((g) => g.key.includes(needle)) : [];
      if (matches.length === 1) {
        add(matches[0].key, matches[0].title, { collection, row });
      } else {
        add(nameNorm || row.id, row.name, { collection, row });
      }
    }
  }

  return groups;
}

/** The row's value for its collection's key attribute («الدورة» → «انكليزي»). */
export function rowKeyValue(collection: FactCollectionWithRows, row: FactRowDto): string | null {
  if (!collection.keyAttr) return null;
  return row.attributes?.find((a) => a.label === collection.keyAttr)?.value ?? null;
}

/** Same folding as the reply-time matcher (`normalizeForMatch`): shared Arabic
 *  normalization with taa-marbuta folding, then case folding. */
function normalizeForGrouping(text: string): string {
  return normalizeArabic(text, { normalizeTaaMarbuta: true }).toLowerCase().trim();
}
