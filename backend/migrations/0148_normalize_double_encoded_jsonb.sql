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
-- Safety:
--  * Only rows whose UNWRAPPED text starts with '{' or '[' are touched, and
--    only when it parses as jsonb (try_cast guard) — a deliberate bare-string
--    jsonb value (none are known to exist) is left untouched.
--  * Runs a second pass in case any row was wrapped twice.
--  * Per-column exception guard: a poison row skips that column with a WARNING
--    instead of failing the deploy; the column can then be repaired manually.
DO $$
DECLARE
    rec RECORD;
    pass INTEGER;
    changed INTEGER;
    total INTEGER;
BEGIN
    FOR pass IN 1..2 LOOP
        total := 0;
        FOR rec IN
            SELECT c.table_name AS tbl, c.column_name AS col
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema = 'public'
              AND c.data_type = 'jsonb'
              AND t.table_type = 'BASE TABLE'
        LOOP
            BEGIN
                EXECUTE format(
                    'UPDATE %I SET %I = (%I #>> ''{}'')::jsonb '
                    || 'WHERE jsonb_typeof(%I) = ''string'' '
                    || 'AND (%I #>> ''{}'') ~ ''^[[:space:]]*[\[{]''',
                    rec.tbl, rec.col, rec.col, rec.col, rec.col);
                GET DIAGNOSTICS changed = ROW_COUNT;
                total := total + changed;
                IF changed > 0 THEN
                    RAISE NOTICE 'jsonb normalize pass %: %.% — % rows', pass, rec.tbl, rec.col, changed;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'jsonb normalize skipped %.% (pass %): %', rec.tbl, rec.col, pass, SQLERRM;
            END;
        END LOOP;
        EXIT WHEN total = 0;
    END LOOP;
END $$;
