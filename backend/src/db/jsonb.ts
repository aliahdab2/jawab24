import { customType } from 'drizzle-orm/pg-core';

// Drizzle 0.29's built-in `jsonb` calls JSON.stringify(value) and binds the result
// as a TEXT parameter. With `prepare: false` (Transaction pool mode), postgres-js
// then treats that string as a JSON string scalar and stores it as `"\"{...}\""`,
// breaking every `col ? 'key'` query. Confirmed via wire-protocol probe on
// 2026-04-25 against drizzle-orm 0.29.5 + postgres 3.x.
//
// This replacement hands postgres-js the raw JS value, which postgres-js
// serializes correctly for jsonb columns.
//
// Drop-in for `jsonb` from 'drizzle-orm/pg-core'. Supports the full builder
// chain: .$type<X>().default(...).notNull().
export const jsonb = customType<{ data: unknown; driverData: unknown }>({
    dataType() { return 'jsonb'; },
    toDriver(value) { return value; },
    fromDriver(value) { return value; },
});
