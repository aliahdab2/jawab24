// Additive-only dev-DB reconciliation (Rule 18.5): the shared dev DB is
// maintained by drizzle-kit push and drifts behind the code. db:migrate fails
// on it and `push` can propose drops. This script diffs the CODE's schema
// (migrations/meta/0167_snapshot.json — the full current snapshot) against
// information_schema and emits only:
//   - CREATE TABLE IF NOT EXISTS for missing tables (columns + PK + uniques)
//   - ALTER TABLE ADD COLUMN IF NOT EXISTS (nullable) for missing columns
// Never drops, renames, or retypes anything.
import fs from 'node:fs';
import postgres from 'postgres';

const url = process.env.DEV_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/autoreply';
const snapshot = JSON.parse(fs.readFileSync(new URL('../migrations/meta/0167_snapshot.json', import.meta.url), 'utf8'));
const sql = postgres(url, { max: 1 });

const existingCols = {};
for (const row of await sql`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
`) {
    (existingCols[row.table_name] ??= new Set()).add(row.column_name);
}

let addedCols = 0, createdTables = 0;
for (const table of Object.values(snapshot.tables)) {
    const tname = table.name;
    const cols = Object.values(table.columns);
    if (!existingCols[tname]) {
        const colDefs = cols.map(c => {
            let def = `"${c.name}" ${c.type}`;
            if (c.primaryKey) def += ' PRIMARY KEY';
            if (c.default !== undefined) def += ` DEFAULT ${c.default}`;
            return def;
        }).join(', ');
        await sql.unsafe(`CREATE TABLE IF NOT EXISTS "${tname}" (${colDefs})`);
        for (const idx of Object.values(table.indexes ?? {})) {
            if (!idx.isUnique) continue;
            const colList = idx.columns.map(c => c.isExpression ? c.expression : `"${c.expression}"`).join(', ');
            await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "${idx.name}" ON "${tname}" (${colList})`).catch(e =>
                console.log(`  (skip unique ${idx.name}: ${e.message})`));
        }
        console.log(`created table ${tname} (${cols.length} cols)`);
        createdTables++;
        continue;
    }
    for (const c of cols) {
        if (existingCols[tname].has(c.name)) continue;
        // Nullable on purpose: existing rows must not fail a NOT NULL add.
        let def = `"${c.name}" ${c.type}`;
        if (c.default !== undefined) def += ` DEFAULT ${c.default}`;
        await sql.unsafe(`ALTER TABLE "${tname}" ADD COLUMN IF NOT EXISTS ${def}`);
        console.log(`added ${tname}.${c.name}`);
        addedCols++;
        // A later-added unique column may carry a unique index the code upserts
        // against (e.g. users.phone ON CONFLICT) — add it best-effort.
        for (const idx of Object.values(table.indexes ?? {})) {
            if (!idx.isUnique) continue;
            const involves = idx.columns.some(col => col.expression === c.name);
            if (!involves) continue;
            const colList = idx.columns.map(col => col.isExpression ? col.expression : `"${col.expression}"`).join(', ');
            await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "${idx.name}" ON "${tname}" (${colList})`).catch(e =>
                console.log(`  (skip unique ${idx.name}: ${e.message})`));
        }
    }
}
console.log(`done: ${createdTables} tables created, ${addedCols} columns added`);
await sql.end();
