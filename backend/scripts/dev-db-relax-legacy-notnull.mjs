// Dev-DB only (Rule 18.5): the shared dev DB carries columns the CODE has
// since dropped/replaced (e.g. notifications.title_en → titles jsonb), still
// marked NOT NULL. Inserts from current code then fail with
// "null value in column ... violates not-null constraint".
//
// This relaxes NOT NULL on columns that exist in the DB but NOT in the code's
// schema snapshot. It never drops, renames, or retypes — the stale column and
// its data stay; only the constraint that blocks current code is lifted.
import fs from 'node:fs';
import postgres from 'postgres';

const url = process.env.DEV_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/autoreply';
const snapshot = JSON.parse(fs.readFileSync(new URL('../migrations/meta/0167_snapshot.json', import.meta.url), 'utf8'));
const sql = postgres(url, { max: 1 });

const codeCols = {};
for (const t of Object.values(snapshot.tables)) {
    codeCols[t.name] = new Set(Object.values(t.columns).map(c => c.name));
}

const dbCols = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND is_nullable = 'NO' AND column_default IS NULL
`;

let relaxed = 0;
for (const { table_name, column_name } of dbCols) {
    const known = codeCols[table_name];
    if (!known || known.has(column_name)) continue;   // table unknown, or column still in code
    await sql.unsafe(`ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" DROP NOT NULL`);
    console.log(`relaxed ${table_name}.${column_name} (stale — not in code schema)`);
    relaxed++;
}
console.log(`done: ${relaxed} stale NOT NULL constraints relaxed`);
await sql.end();
