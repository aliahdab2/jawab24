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
