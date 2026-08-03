import { customType } from 'drizzle-orm/pg-core';

/**
 * Drop-in replacement for drizzle's `jsonb()` column that actually stores jsonb
 * OBJECTS, not JSON-encoded strings.
 *
 * Why this exists (verified against prod 2026-08-01): drizzle-orm 0.29.x
 * `PgJsonb.mapToDriverValue` pre-stringifies the value, and the postgres-js
 * driver then serializes it AGAIN, so every jsonb value written through
 * drizzle lands as a jsonb *string* (`jsonb_typeof = 'string'`) — ~440k rows
 * across 29 columns did. App code never noticed because reads double-decode
 * symmetrically, but every SQL-side consumer is silently broken against such
 * rows: the `?` / `->` operators match nothing (this hid ALL grounding-verifier
 * shadow flags), GIN indexing is useless, and analytics need `#>>'{}'` tricks.
 * Upstream: https://github.com/drizzle-team/drizzle-orm/issues/724
 *
 * - `toDriver` hands postgres-js the RAW value: the driver serializes exactly
 *   once and the server stores a real jsonb object.
 * - `fromDriver` keeps drizzle's tolerant read: rows written before the
 *   migration `0148_normalize_double_encoded_jsonb` (or restored from an old
 *   backup) come back as strings and are parsed here, so readers see the same
 *   objects either way.
 *
 * Remove this shim (switch back to drizzle's `jsonb`) only after upgrading
 * drizzle-orm to a version whose postgres-js driver passes this repo's
 * round-trip regression test: backend/test/integration/jsonbRoundTrip.test.ts.
 *
 * String-scalar caveat (drizzle >=0.30 + restoreRawParamSerializers): JS strings
 * pass to the wire RAW — valid-JSON text is stored as its parsed structure and
 * non-JSON text errors server-side. Never write a bare string intending a JSON
 * string scalar; build it server-side (`to_jsonb(...::text)`) like the
 * round-trip test does. No production column stores string scalars (0148
 * normalized the legacy rows away).
 */
export const jsonb = customType<{ data: unknown; driverData: unknown }>({
    dataType() {
        return 'jsonb';
    },
    toDriver(value) {
        return value as never;
    },
    fromDriver(value) {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }
        return value;
    },
});
