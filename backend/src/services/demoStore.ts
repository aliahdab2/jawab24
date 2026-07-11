/**
 * Demo-store detection — deliberately its own dependency-light module.
 *
 * Demo-seeded stores (plugins/demo/seedData.ts) carry `platformData.demo: true`
 * and hold placeholder tokens that are NOT real ciphertext — decrypt() throws on
 * them. Every path that talks to a real platform API (scheduled sync, webhook
 * registration/retry, token refresh) must skip demo stores via this predicate
 * (regression: JAWAB24-BACKEND-19).
 *
 * This is a JS predicate on purpose — do NOT rewrite it as a SQL
 * `platformData->>'demo'` condition. drizzle-orm 0.29.x + postgres-js
 * double-serializes jsonb writes, so platform_data rows are stored as jsonb
 * STRING scalars: `->>` returns NULL on them and the SQL filter silently
 * matches nothing. Drizzle's read path parses the string back to an object,
 * so filtering the hydrated row here is reliable for both encodings.
 */
export function isDemoStore(store: { platformData?: unknown } | null | undefined): boolean {
    const platformData = (store?.platformData ?? null) as Record<string, unknown> | null;
    return platformData?.demo === true;
}
