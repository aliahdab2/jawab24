import { beforeAll, beforeEach, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

const connectionString =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/autoreply_test';

// Set DATABASE_URL so that any module importing from ../../src/db uses the test database.
// This must happen before any app module is imported.
process.env.DATABASE_URL = connectionString;

// Dedicated connection for integration test helpers (direct DB reads/writes in assertions).
const testClient = postgres(connectionString, { prepare: false, max: 3 });
export const testDb = drizzle(testClient, { schema });

beforeAll(async () => {
    // Push schema to the test database using the non-strict test config.
    // This avoids interactive prompts that would hang in CI.
    const { execSync } = await import('child_process');
    execSync(
        `DATABASE_URL="${connectionString}" npx drizzle-kit push:pg --config=drizzle.config.integration.ts`,
        { cwd: process.cwd(), stdio: 'pipe' },
    );
});

beforeEach(async () => {
    // Truncate all tables that integration tests touch (CASCADE handles FK deps).
    await testDb.execute(sql`
        TRUNCATE TABLE messages, pages, users, settings, conversation_pauses CASCADE
    `);
});

afterAll(async () => {
    // Close our test helper connection
    await testClient.end();

    // Close the app's DB connection pool (created by src/db/index.ts on import)
    // to prevent the process from hanging after tests complete.
    try {
        const { client } = await import('../../src/db');
        await client.end();
    } catch {
        // App module may not have been imported in all test files; ignore
    }
});

// ===================== Helpers =====================

export async function createTestUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
    const [user] = await testDb
        .insert(schema.users)
        .values({
            facebookId: overrides.facebookId ?? `test-fb-${Date.now()}`,
            name: overrides.name ?? 'Test User',
            email: overrides.email ?? 'test@example.com',
            ...overrides,
        })
        .returning();
    return user;
}

export async function createTestPage(
    userId: string,
    overrides: Partial<typeof schema.pages.$inferInsert> = {},
) {
    const [page] = await testDb
        .insert(schema.pages)
        .values({
            userId,
            facebookPageId: overrides.facebookPageId ?? `page-${Date.now()}`,
            name: overrides.name ?? 'Test Page',
            accessToken: overrides.accessToken ?? 'test-access-token',
            autoReplyEnabled: overrides.autoReplyEnabled ?? true,
            ...overrides,
        })
        .returning();
    return page;
}

export async function insertMessage(
    pageId: string,
    senderId: string,
    overrides: Partial<typeof schema.messages.$inferInsert> = {},
) {
    const [msg] = await testDb
        .insert(schema.messages)
        .values({
            pageId,
            senderId,
            facebookMessageId: overrides.facebookMessageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test message',
            direction: overrides.direction ?? 'incoming',
            replied: overrides.replied ?? false,
            platform: overrides.platform ?? 'facebook',
            ...overrides,
        })
        .returning();
    return msg;
}

export async function insertPause(pageId: string, senderId: string, pausedUntil: Date) {
    const [pause] = await testDb
        .insert(schema.conversationPauses)
        .values({ pageId, senderId, pausedUntil })
        .returning();
    return pause;
}
