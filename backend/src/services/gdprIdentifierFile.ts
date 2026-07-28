/**
 * Parser for Meta's "Download user identifiers" batch file (GDPR / Platform Terms
 * 3(d)(i)) — the list of end-customer IDs whose data we must delete.
 *
 * Lives apart from `scripts/gdpr-batch-delete.ts` because that script runs `main()`
 * at module scope: importing it to test the parser would execute a real purge.
 * This module is pure, so the rule deciding WHOSE data gets deleted is testable.
 *
 * Format is not documented by Meta and has varied between exports, so the parser is
 * deliberately permissive: JSON (array of strings, array of objects, or `{data:[…]}`)
 * and CSV/TXT (one id per line or comma-separated). Meta user IDs are long numeric
 * strings, so tokens matching /^\d{5,}$/ are kept — which also skips CSV headers.
 */

/** Meta app-/page-scoped ids are long numeric strings; 5+ digits excludes headers. */
const ID_RE = /^\d{5,}$/;

/**
 * Normalize one raw cell into a candidate id.
 *
 * `trim()` matters more than it looks: Meta's exports are UTF-8 **with a BOM**, so
 * the first id of every file arrives prefixed by U+FEFF. JS treats U+FEFF as
 * whitespace, so trim() removes it and the first deletion request is not silently
 * dropped. Do not replace trim() with a manual space strip.
 */
function normalizeCell(cell: string): string {
    return cell.trim().replace(/^["']|["']$/g, '');
}

/**
 * Parse ONE identifier file's contents into a deduped list of Meta IDs.
 *
 * Always parse each file separately. Concatenating them first (`cat a.csv b.csv`)
 * corrupts the batch — see the regression test — because the files carry no
 * trailing newline.
 */
export function parseMetaIdentifierIds(raw: string): string[] {
    const ids = new Set<string>();
    const trimmed = raw.trim();
    let handledAsJson = false;

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed);
            const arr: unknown[] = Array.isArray(json)
                ? json
                : Array.isArray((json as Record<string, unknown>).data)
                    ? (json as { data: unknown[] }).data
                    : [];
            for (const item of arr) {
                if (typeof item === 'string' || typeof item === 'number') {
                    const v = normalizeCell(String(item));
                    if (ID_RE.test(v)) ids.add(v);
                } else if (item && typeof item === 'object') {
                    const o = item as Record<string, unknown>;
                    const cand = o.id ?? o.user_id ?? o.asid ?? o.psid ?? o.identifier;
                    if (cand !== null && cand !== undefined) {
                        const v = normalizeCell(String(cand));
                        if (ID_RE.test(v)) ids.add(v);
                    }
                }
            }
            handledAsJson = true;
        } catch {
            // Not valid JSON despite the leading bracket — fall through to CSV.
            handledAsJson = false;
        }
    }

    if (!handledAsJson) {
        for (const line of raw.split(/\r?\n/)) {
            for (const cell of line.split(',')) {
                const v = normalizeCell(cell);
                if (ID_RE.test(v)) ids.add(v);
            }
        }
    }

    return [...ids];
}
