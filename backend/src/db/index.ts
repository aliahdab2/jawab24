import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/autoreply';
// Note: Connection string contains credentials - never log in production

// Configure connection pool for production
const isProduction = process.env.NODE_ENV === 'production';
export const client = postgres(connectionString, {
    prepare: false, // Required for "Transaction" pool mode
    max: isProduction ? 30 : 5, // Connection pool size (30 for production to handle concurrent reply workers)
    idle_timeout: 20, // Close idle connections after 20 seconds
    connect_timeout: 10, // Timeout for new connections
});

// Dev: Drizzle console logger for SQL debugging.
// Prod: Sentry auto-instruments postgres queries via @sentry/node (tracesSampleRate: 0.1).
export const db = drizzle(client, {
    schema,
    logger: !isProduction,
});

// drizzle-orm >=0.30 replaces the client's date/timestamp/json SERIALIZERS with identity
// functions (drizzle(client) mutates client.options.serializers) so that its column
// mappers control all value conversion. Column-bound writes are unaffected — but a raw
// sql`...${someDate}` / db.execute fragment bypasses column mappers, and the identity
// serializer then feeds a bare Date/Object/Array to the wire encoder, which throws
// ERR_INVALID_ARG_TYPE (postgres-js Bind → bytes.str). This restores 0.29-era behavior
// for raw params while passing drizzle's pre-stringified column values through untouched.
// Parsers are deliberately NOT restored: drizzle's transparent parsers +
// mapFromDriverValue own the read direction (incl. timezone handling).
// Must run AFTER drizzle(client) — construct() overwrites these entries. Any other
// drizzle(client) instance (e.g. the integration-test client) needs the same call.
export function restoreRawParamSerializers(pgClient: ReturnType<typeof postgres>): void {
    // OIDs: 1184 timestamptz, 1114 timestamp, 1082 date.
    for (const oid of [1184, 1114, 1082]) {
        pgClient.options.serializers[oid] = (value: unknown) =>
            value instanceof Date ? value.toISOString() : value;
    }
    // OIDs: 114 json, 3802 jsonb.
    for (const oid of [114, 3802]) {
        pgClient.options.serializers[oid] = (value: unknown) =>
            typeof value === 'string' ? value : JSON.stringify(value);
    }
}
restoreRawParamSerializers(client);
