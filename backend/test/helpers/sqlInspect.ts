/**
 * Recursively walk a drizzle SQL/AND tree and collect every primitive value (param)
 * so tests can assert which literals were pushed into the WHERE clause without tripping
 * on the circular references inside drizzle's column → table back-pointers.
 */
export function collectSqlValues(node: unknown, seen = new WeakSet<object>()): unknown[] {
    if (node === null || node === undefined) return [];
    if (typeof node !== 'object') return [node];
    if (seen.has(node as object)) return [];
    seen.add(node as object);
    const out: unknown[] = [];
    for (const v of Object.values(node as Record<string, unknown>)) {
        if (Array.isArray(v)) {
            for (const item of v) out.push(...collectSqlValues(item, seen));
        } else if (v && typeof v === 'object') {
            out.push(...collectSqlValues(v, seen));
        } else if (v !== undefined) {
            out.push(v);
        }
    }
    return out;
}
