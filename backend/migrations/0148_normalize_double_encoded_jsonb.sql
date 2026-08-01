-- Data-only migration: unwrap jsonb values that were stored as JSON-encoded
-- STRINGS instead of objects/arrays.
--
-- Cause: drizzle-orm 0.29.x pre-stringifies jsonb values and postgres-js then
-- serializes them again (drizzle-orm#724), so every jsonb write through drizzle
-- landed as `jsonb_typeof = 'string'` (~440k rows across 29 columns as of
-- 2026-08-01 — this hid all grounding-verifier shadow flags from the `?`
-- operator). The write path is fixed in backend/src/db/jsonbColumn.ts; this
-- migration repairs the rows already on disk.
--
-- Scope — exactly the defect's signature, nothing wider:
--  * Only rows whose UNWRAPPED text starts with '{' or '[' are rewritten —
--    i.e. a jsonb string holding the JSON text of an object/array, the
--    single-wrap shape drizzle#724 produces. A deliberate bare-string jsonb
--    value (none are known to exist) is left untouched.
--  * Hypothetical double-wrapped rows (string-in-string) are deliberately NOT
--    repaired: drizzle#724 alone cannot produce them, and such rows would
--    already be visibly broken to app reads (drizzle's tolerant read parses
--    one level only) — a symptom never observed. If the post-deploy check
--    below finds residue, repair that column manually.
--  * Per-column exception guard: a poison row (regex-matching text that is not
--    valid JSON — the ::jsonb cast throws) skips that column with a WARNING
--    instead of failing the deploy; the column can then be repaired manually.
--
-- Post-deploy verification (expect 0 rows for every column; any residue means
-- a skipped/poison column — see the WARNING lines in the migration output):
--   SELECT c.table_name, c.column_name
--   FROM information_schema.columns c
--   WHERE c.table_schema = 'public' AND c.data_type = 'jsonb';
--   -- then per column: SELECT count(*) FROM <tbl> WHERE jsonb_typeof(<col>) = 'string';
DO $$
DECLARE
    rec RECORD;
    changed INTEGER;
BEGIN
    FOR rec IN
        SELECT c.table_schema AS sch, c.table_name AS tbl, c.column_name AS col
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.data_type = 'jsonb'
          AND t.table_type = 'BASE TABLE'
    LOOP
        BEGIN
            EXECUTE format(
                'UPDATE %I.%I SET %I = (%I #>> ''{}'')::jsonb '
                || 'WHERE jsonb_typeof(%I) = ''string'' '
                || 'AND (%I #>> ''{}'') ~ ''^[[:space:]]*[\[{]''',
                rec.sch, rec.tbl, rec.col, rec.col, rec.col, rec.col);
            GET DIAGNOSTICS changed = ROW_COUNT;
            IF changed > 0 THEN
                RAISE NOTICE 'jsonb normalize: %.% — % rows', rec.tbl, rec.col, changed;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'jsonb normalize skipped %.%: %', rec.tbl, rec.col, SQLERRM;
        END;
    END LOOP;
END $$;
